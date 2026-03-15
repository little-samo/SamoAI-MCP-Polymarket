import { z } from 'zod';

import { Side } from '../polymarket/client';
import {
  getMarketByConditionId,
  getMarketsByConditionIds,
  getPositions,
} from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { GammaMarket, GammaPosition } from '../polymarket/gamma';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const RESOLUTION_PRICE_EPSILON = 1e-6;

function normalizeConditionIds(
  conditionId?: string,
  conditionIds?: string[]
): string[] {
  return [
    ...new Set(
      [conditionId, ...(conditionIds ?? [])]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    ),
  ];
}

function parseTokenIds(market: GammaMarket): string[] {
  const tokenIds = JSON.parse(market.clobTokenIds);
  if (
    !Array.isArray(tokenIds) ||
    tokenIds.some((tokenId) => typeof tokenId !== 'string')
  ) {
    throw new Error('Could not parse token IDs from market data');
  }

  return tokenIds;
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => toFiniteNumber(item));
  }

  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => toFiniteNumber(item))
      : [];
  } catch {
    return [];
  }
}

function getSettlementPrice(
  position: GammaPosition,
  market?: GammaMarket
): number | null {
  if (!market) return null;

  const outcomePrices = parseNumberArray(market.outcomePrices);
  if (outcomePrices.length === 0) return null;

  const outcomeIndex = Number.isInteger(position.outcomeIndex)
    ? position.outcomeIndex
    : parseStringArray(market.outcomes).findIndex(
        (outcome) => outcome === position.outcome
      );

  if (outcomeIndex < 0 || outcomeIndex >= outcomePrices.length) {
    return null;
  }

  return outcomePrices[outcomeIndex];
}

async function loadMarketsByConditionIds(
  conditionIds: string[]
): Promise<Map<string, GammaMarket>> {
  const normalizedConditionIds = [...new Set(conditionIds.filter(Boolean))];
  if (normalizedConditionIds.length === 0) {
    return new Map();
  }

  const markets = await getMarketsByConditionIds(normalizedConditionIds);
  const marketsByConditionId = new Map(
    markets.map((market) => [market.conditionId, market])
  );
  const missingConditionIds = normalizedConditionIds.filter(
    (conditionId) => !marketsByConditionId.has(conditionId)
  );

  if (missingConditionIds.length > 0) {
    const fallbackMarkets = await Promise.all(
      missingConditionIds.map((conditionId) =>
        getMarketByConditionId(conditionId)
      )
    );

    fallbackMarkets.forEach((market) => {
      if (market) {
        marketsByConditionId.set(market.conditionId, market);
      }
    });
  }

  return marketsByConditionId;
}

async function getAllPositions(
  userAddress: string,
  params?: { market?: string; pageSize?: number }
): Promise<GammaPosition[]> {
  const pageSize = params?.pageSize ?? 100;
  const positions: GammaPosition[] = [];
  let offset = 0;

  while (true) {
    const page = await getPositions(userAddress, {
      market: params?.market,
      limit: pageSize,
      offset,
    });

    positions.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return positions;
}

async function getRedeemableSettledLossConditionIds(
  userAddress: string
): Promise<string[]> {
  const positions = await getAllPositions(userAddress);
  const marketsByConditionId = await loadMarketsByConditionIds(
    positions.map((position) => position.conditionId)
  );

  return [
    ...new Set(
      positions
        .filter((position) => {
          if (!position.redeemable) {
            return false;
          }

          const size = toFiniteNumber(position.size);
          if (size <= RESOLUTION_PRICE_EPSILON) {
            return false;
          }

          const settlementPrice = getSettlementPrice(
            position,
            marketsByConditionId.get(position.conditionId)
          );

          return (
            settlementPrice !== null &&
            settlementPrice <= RESOLUTION_PRICE_EPSILON
          );
        })
        .map((position) => position.conditionId)
    ),
  ];
}

async function settleRedeemTasks<T>(
  tasks: Array<() => Promise<T>>,
  sequential: boolean
): Promise<PromiseSettledResult<T>[]> {
  if (!sequential) {
    return Promise.allSettled(tasks.map((task) => task()));
  }

  const settled: PromiseSettledResult<T>[] = [];
  for (const task of tasks) {
    try {
      settled.push({
        status: 'fulfilled',
        value: await task(),
      });
    } catch (error) {
      settled.push({
        status: 'rejected',
        reason: error,
      });
    }
  }
  return settled;
}

export function registerTradingTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'place_order',
    {
      description:
        'Place a limit (GTC) or market (FOK) order. For limit: set price (0-1) and size (shares). For market buy: set amount in USDC. For market sell: set amount in shares.',
      inputSchema: z.object({
        token_id: z
          .string()
          .min(1)
          .describe('Token ID of the outcome to trade'),
        side: z.enum(['BUY', 'SELL']).describe('Order side'),
        type: z
          .enum(['limit', 'market'])
          .default('limit')
          .describe('Order type'),
        price: z
          .number()
          .gt(0)
          .lt(1)
          .optional()
          .describe('Limit price (required for limit orders)'),
        size: z
          .number()
          .gt(0)
          .optional()
          .describe('Share count (required for limit orders)'),
        amount: z
          .number()
          .gt(0)
          .optional()
          .describe('USDC for market buy, shares for market sell'),
      }),
    },
    async ({ token_id, side, type, price, size, amount }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const orderSide = side === 'BUY' ? Side.BUY : Side.SELL;
        if (type === 'limit') {
          if (price === undefined || size === undefined) {
            return formatError('Limit orders require both price and size');
          }
          return formatResult(
            await client.createLimitOrder(token_id, orderSide, price, size)
          );
        }
        if (amount === undefined) {
          return formatError('Market orders require amount');
        }
        return formatResult(
          await client.createMarketOrder(token_id, orderSide, amount)
        );
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'cancel_orders',
    {
      description:
        'Cancel orders. Provide order_ids for specific orders, market/asset_id to cancel by market, or all=true to cancel everything.',
      inputSchema: z.object({
        order_ids: z
          .array(z.string())
          .optional()
          .describe('Specific order IDs to cancel'),
        market: z
          .string()
          .optional()
          .describe('Cancel all orders in this market (condition ID)'),
        asset_id: z
          .string()
          .optional()
          .describe('Cancel all orders for this token'),
        all: z.boolean().default(false).describe('Cancel ALL open orders'),
      }),
    },
    async ({ order_ids, market, asset_id, all }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        if (all) {
          return formatResult(await client.cancelAll());
        }
        if (order_ids?.length) {
          if (order_ids.length === 1) {
            return formatResult(await client.cancelOrder(order_ids[0]));
          }
          return formatResult(await client.cancelOrders(order_ids));
        }
        if (market || asset_id) {
          return formatResult(
            await client.cancelMarketOrders({ market, asset_id })
          );
        }
        return formatError(
          'Provide order_ids, market, asset_id, or set all=true'
        );
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'redeem_positions',
    {
      description:
        'Redeem one or more resolved positions after market settlement. Supports explicit market IDs or automatic cleanup of redeemable settled losses. Uses Polymarket builder relayer for gasless claim when configured, otherwise falls back to an on-chain transaction.',
      inputSchema: z
        .object({
          condition_id: z
            .string()
            .min(1)
            .optional()
            .describe('Single market condition ID to redeem'),
          condition_ids: z
            .array(z.string().min(1))
            .optional()
            .describe('Multiple market condition IDs to redeem in one call'),
          redeem_settled_losses: z
            .boolean()
            .default(false)
            .describe(
              'Automatically redeem all resolved losing positions that are still redeemable, so they no longer linger as stale dust'
            ),
          method: z
            .enum(['auto', 'gasless', 'onchain'])
            .default('auto')
            .describe(
              'Claim method: gasless (builder relayer), onchain (direct tx), or auto (gasless with onchain fallback)'
            ),
        })
        .refine(
          (value) =>
            Boolean(value.condition_id?.trim()) ||
            value.redeem_settled_losses ||
            Boolean(
              value.condition_ids?.some((conditionId) => conditionId.trim())
            ),
          {
            message:
              'Provide condition_id, condition_ids, or set redeem_settled_losses=true',
            path: ['condition_id'],
          }
        ),
    },
    async ({ condition_id, condition_ids, redeem_settled_losses, method }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        if (redeem_settled_losses && !client.hasBuilderRelayer) {
          return formatError(
            'redeem_settled_losses requires builder relayer credentials because settled-loss cleanup is gasless only'
          );
        }

        const explicitConditionIds = normalizeConditionIds(
          condition_id,
          condition_ids
        );
        const autoSelectedConditionIds = redeem_settled_losses
          ? await getRedeemableSettledLossConditionIds(
              client.proxyAddress ?? ''
            )
          : [];
        const requestedConditionIds = [
          ...new Set([...explicitConditionIds, ...autoSelectedConditionIds]),
        ];
        const effectiveMethod = redeem_settled_losses ? 'gasless' : method;
        const runSequentially =
          effectiveMethod === 'onchain' ||
          (effectiveMethod === 'auto' && !client.hasBuilderRelayer) ||
          ((effectiveMethod === 'gasless' ||
            (effectiveMethod === 'auto' && client.hasBuilderRelayer)) &&
            client.usesSafeSigning);

        if (requestedConditionIds.length === 0) {
          return formatResult({
            success: true,
            requestedCount: 0,
            redeemedCount: 0,
            failedCount: 0,
            autoSelectedConditionIds,
            effectiveMethod,
            results: [],
            failures: [],
            message: 'No redeemable settled-loss positions found',
          });
        }

        const marketsByConditionId = await loadMarketsByConditionIds(
          requestedConditionIds
        );

        if (requestedConditionIds.length === 1) {
          const market = marketsByConditionId.get(requestedConditionIds[0]);
          if (!market) return formatError('Market not found');

          const result = await client.redeemPositions(
            market.conditionId,
            parseTokenIds(market),
            market.negRisk,
            effectiveMethod
          );
          return formatResult({
            success: true,
            conditionId: market.conditionId,
            autoSelected: autoSelectedConditionIds.includes(market.conditionId),
            effectiveMethod,
            ...result,
          });
        }

        const redeemTasks = requestedConditionIds.map(
          (requestedConditionId) => async () => {
            const market = marketsByConditionId.get(requestedConditionId);
            if (!market) {
              throw new Error('Market not found');
            }

            const result = await client.redeemPositions(
              market.conditionId,
              parseTokenIds(market),
              market.negRisk,
              effectiveMethod
            );

            return {
              success: true,
              conditionId: market.conditionId,
              autoSelected: autoSelectedConditionIds.includes(
                market.conditionId
              ),
              ...result,
            };
          }
        );
        const settled = await settleRedeemTasks(redeemTasks, runSequentially);

        const results: Array<Record<string, unknown>> = [];
        const failures: Array<{ conditionId: string; error: string }> = [];

        settled.forEach((entry, index) => {
          const requestedConditionId = requestedConditionIds[index];
          if (entry.status === 'fulfilled') {
            results.push(entry.value);
            return;
          }

          const error =
            entry.reason instanceof Error
              ? entry.reason.message
              : String(entry.reason);
          failures.push({
            conditionId: requestedConditionId,
            error,
          });
        });

        return formatResult({
          success: failures.length === 0,
          requestedCount: requestedConditionIds.length,
          autoSelectedConditionIds,
          effectiveMethod,
          sequential: runSequentially,
          redeemedCount: results.length,
          failedCount: failures.length,
          results,
          failures,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
