import { z } from 'zod';

import { Side } from '../polymarket/client';
import { getMarketsByConditionIds } from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { GammaMarket } from '../polymarket/gamma';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
        'Redeem (claim) one or more winning positions after market resolution. Uses Polymarket builder relayer for gasless claim when configured, otherwise falls back to an on-chain transaction.',
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
            Boolean(
              value.condition_ids?.some((conditionId) => conditionId.trim())
            ),
          {
            message: 'Provide condition_id or condition_ids',
            path: ['condition_id'],
          }
        ),
    },
    async ({ condition_id, condition_ids, method }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const requestedConditionIds = normalizeConditionIds(
          condition_id,
          condition_ids
        );
        const markets = await getMarketsByConditionIds(requestedConditionIds);
        const marketsByConditionId = new Map(
          markets.map((market) => [market.conditionId, market])
        );

        if (requestedConditionIds.length === 1) {
          const market = marketsByConditionId.get(requestedConditionIds[0]);
          if (!market) return formatError('Market not found');

          const result = await client.redeemPositions(
            market.conditionId,
            parseTokenIds(market),
            market.negRisk,
            method
          );
          return formatResult({
            success: true,
            conditionId: market.conditionId,
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
              method
            );

            return {
              success: true,
              conditionId: market.conditionId,
              ...result,
            };
          }
        );
        const settled = await settleRedeemTasks(
          redeemTasks,
          method === 'onchain' ||
            (method === 'auto' && !client.hasBuilderRelayer)
        );

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
