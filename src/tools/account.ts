import { z } from 'zod';

import {
  getMarketByConditionId,
  getMarketsByConditionIds,
  getPositions,
} from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { GammaMarket, GammaPosition } from '../polymarket/gamma';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const USDC_DECIMALS = 6;
const RESOLUTION_PRICE_EPSILON = 1e-6;

type PositionStatus =
  | 'open'
  | 'claimable'
  | 'redeemable'
  | 'settled_loss'
  | 'closed';

interface AccountPositionView {
  position: GammaPosition;
  status: PositionStatus;
  settlementPrice: number | null;
  claimableValue: number;
  effectiveCurrentValue: number;
  effectiveCashPnl: number;
  effectivePercentPnl: number;
}

function formatUsdcAmount(value: unknown): string {
  if (value === null || value === undefined) return '0';

  const normalized = String(value).trim();
  if (!normalized) return '0';

  if (normalized.includes('.')) {
    return normalized;
  }

  const negative = normalized.startsWith('-');
  const digits = negative ? normalized.slice(1) : normalized;

  if (!/^\d+$/.test(digits)) {
    return normalized;
  }

  const padded = digits.padStart(USDC_DECIMALS + 1, '0');
  const whole = padded.slice(0, -USDC_DECIMALS) || '0';
  const fraction = padded.slice(-USDC_DECIMALS).replace(/0+$/, '');
  const sign = negative ? '-' : '';

  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseUsdcAmount(value: unknown): number {
  return toFiniteNumber(formatUsdcAmount(value));
}

function roundDecimal(value: number, decimals: number = 6): number {
  if (!Number.isFinite(value)) return 0;

  return Number(value.toFixed(decimals));
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

function buildPositionView(
  position: GammaPosition,
  market?: GammaMarket
): AccountPositionView {
  const settlementPrice = getSettlementPrice(position, market);
  const initialValue = toFiniteNumber(position.initialValue);
  const size = toFiniteNumber(position.size);
  const currentValue = toFiniteNumber(position.currentValue);
  const rawCashPnl = toFiniteNumber(position.cashPnl);

  let status: PositionStatus = 'open';
  if (position.redeemable) {
    if (size <= RESOLUTION_PRICE_EPSILON) {
      status = 'closed';
    } else if (settlementPrice !== null) {
      status =
        settlementPrice <= RESOLUTION_PRICE_EPSILON
          ? 'settled_loss'
          : 'claimable';
    } else {
      status = 'redeemable';
    }
  } else if (market?.closed && currentValue <= RESOLUTION_PRICE_EPSILON) {
    status = 'closed';
  }

  const claimableValue =
    status === 'claimable' && settlementPrice !== null
      ? roundDecimal(size * settlementPrice)
      : 0;
  const effectiveCurrentValue =
    status === 'claimable' ? claimableValue : roundDecimal(currentValue);
  const effectiveCashPnl =
    status === 'claimable'
      ? roundDecimal(effectiveCurrentValue - initialValue)
      : roundDecimal(rawCashPnl);
  const effectivePercentPnl =
    initialValue > 0
      ? roundDecimal((effectiveCashPnl / initialValue) * 100)
      : 0;

  return {
    position,
    status,
    settlementPrice,
    claimableValue,
    effectiveCurrentValue,
    effectiveCashPnl,
    effectivePercentPnl,
  };
}

export function registerAccountTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'get_account',
    {
      description:
        'Get account overview: USDC balance, economically active positions, pending orders, and/or trade history. Resolved losses are broken out separately so stale dust does not look like an open holding.',
      inputSchema: z.object({
        sections: z
          .array(z.enum(['balance', 'positions', 'orders', 'trades']))
          .default(['balance', 'positions', 'orders'])
          .describe('Data sections to include'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe('Page size for the positions section'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset for the positions section'),
        market: z
          .string()
          .optional()
          .describe('Filter positions/orders/trades by market condition ID'),
        order_id: z
          .string()
          .optional()
          .describe(
            'Get status of a specific order (overrides orders section filter)'
          ),
      }),
    },
    async ({ sections, limit, offset, market, order_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      const proxyAddr = client.proxyAddress;
      if (!proxyAddr) return formatError('No wallet address');

      try {
        const result: Record<string, unknown> = { wallet: proxyAddr };
        const tasks: Promise<void>[] = [];
        const includeBalance = sections.includes('balance');
        const includePositions = sections.includes('positions');
        const includePortfolioSummary = includeBalance || includePositions;
        const requestedLimit = limit;
        const requestedOffset = offset;
        let cashUsd = 0;
        let totalCurrentValue = 0;
        let totalInitialValue = 0;
        let totalCashPnl = 0;
        let positionCount = 0;

        if (includePortfolioSummary) {
          tasks.push(
            client.getBalance().then((bal) => {
              cashUsd = parseUsdcAmount(bal.balance);

              if (!includeBalance) {
                return;
              }

              result.balance = {
                usdc: bal.balance,
                usd: formatUsdcAmount(bal.balance),
              };
            })
          );
        }

        if (includePortfolioSummary) {
          tasks.push(
            getPositions(proxyAddr, {
              market,
              limit: requestedLimit,
              offset: requestedOffset,
            }).then(async (positions) => {
              const hasMoreProbe =
                positions.length === requestedLimit
                  ? await getPositions(proxyAddr, {
                      market,
                      limit: 1,
                      offset: requestedOffset + requestedLimit,
                    })
                  : [];
              const hasMore = hasMoreProbe.length > 0;
              const markets = await getMarketsByConditionIds(
                positions.map((position) => position.conditionId)
              );
              const marketsByConditionId = new Map(
                markets.map((positionMarket) => [
                  positionMarket.conditionId,
                  positionMarket,
                ])
              );
              const missingConditionIds = [
                ...new Set(
                  positions
                    .map((position) => position.conditionId)
                    .filter(
                      (conditionId) => !marketsByConditionId.has(conditionId)
                    )
                ),
              ];

              if (missingConditionIds.length > 0) {
                const fallbackMarkets = await Promise.all(
                  missingConditionIds.map((conditionId) =>
                    getMarketByConditionId(conditionId)
                  )
                );

                fallbackMarkets.forEach((fallbackMarket) => {
                  if (fallbackMarket) {
                    marketsByConditionId.set(
                      fallbackMarket.conditionId,
                      fallbackMarket
                    );
                  }
                });
              }

              const positionViews = positions.map((position) =>
                buildPositionView(
                  position,
                  marketsByConditionId.get(position.conditionId)
                )
              );
              const activePositionViews = positionViews.filter(
                (view) => view.status !== 'settled_loss'
              );
              const settledLossViews = positionViews.filter(
                (view) => view.status === 'settled_loss'
              );
              const claimableViews = positionViews.filter(
                (view) => view.status === 'claimable'
              );
              const settledLossInitialValue = roundDecimal(
                settledLossViews.reduce(
                  (sum, view) =>
                    sum + toFiniteNumber(view.position.initialValue),
                  0
                )
              );

              totalCurrentValue = roundDecimal(
                activePositionViews.reduce(
                  (sum, view) => sum + view.effectiveCurrentValue,
                  0
                )
              );
              totalInitialValue = roundDecimal(
                activePositionViews.reduce(
                  (sum, view) =>
                    sum + toFiniteNumber(view.position.initialValue),
                  0
                )
              );
              totalCashPnl = roundDecimal(
                activePositionViews.reduce(
                  (sum, view) => sum + view.effectiveCashPnl,
                  0
                )
              );
              positionCount = activePositionViews.length;

              if (!includePositions) {
                return;
              }

              result.positions = {
                count: positionCount,
                limit: requestedLimit,
                offset: requestedOffset,
                hasMore,
                claimableCount: claimableViews.length,
                settledLossCount: settledLossViews.length,
                totalCurrentValue,
                totalInitialValue,
                totalCashPnl,
                settledLossInitialValue,
                items: activePositionViews.map((view) => ({
                  title: view.position.title,
                  outcome: view.position.outcome,
                  status: view.status,
                  size: roundDecimal(toFiniteNumber(view.position.size)),
                  avgPrice: roundDecimal(
                    toFiniteNumber(view.position.avgPrice)
                  ),
                  curPrice: roundDecimal(
                    toFiniteNumber(view.position.curPrice)
                  ),
                  currentValue: view.effectiveCurrentValue,
                  cashPnl: view.effectiveCashPnl,
                  percentPnl: view.effectivePercentPnl,
                  rawCurrentValue: roundDecimal(
                    toFiniteNumber(view.position.currentValue)
                  ),
                  rawCashPnl: roundDecimal(
                    toFiniteNumber(view.position.cashPnl)
                  ),
                  settlementPrice:
                    view.settlementPrice === null
                      ? null
                      : roundDecimal(view.settlementPrice),
                  claimableValue: view.claimableValue,
                  conditionId: view.position.conditionId,
                  endDate: view.position.endDate,
                  redeemable: view.position.redeemable,
                })),
                settledLosses: settledLossViews.map((view) => ({
                  title: view.position.title,
                  outcome: view.position.outcome,
                  status: view.status,
                  size: roundDecimal(toFiniteNumber(view.position.size)),
                  avgPrice: roundDecimal(
                    toFiniteNumber(view.position.avgPrice)
                  ),
                  settlementPrice:
                    view.settlementPrice === null
                      ? null
                      : roundDecimal(view.settlementPrice),
                  currentValue: 0,
                  cashPnl: roundDecimal(
                    -toFiniteNumber(view.position.initialValue)
                  ),
                  percentPnl: -100,
                  conditionId: view.position.conditionId,
                  endDate: view.position.endDate,
                  redeemable: view.position.redeemable,
                })),
              };
            })
          );
        }

        if (sections.includes('orders')) {
          if (order_id) {
            tasks.push(
              client.getOrder(order_id).then((order) => {
                result.orders = { count: 1, items: [order] };
              })
            );
          } else {
            tasks.push(
              client.getOpenOrders({ market }).then((orders) => {
                result.orders = { count: orders.length, items: orders };
              })
            );
          }
        }

        if (sections.includes('trades')) {
          tasks.push(
            client.getTrades({ market }).then((trades) => {
              result.trades = { count: trades.length, items: trades };
            })
          );
        }

        await Promise.all(tasks);

        if (includePortfolioSummary) {
          result.summary = {
            cashUsd: roundDecimal(cashUsd),
            positionsUsd: totalCurrentValue,
            totalEstimatedUsd: roundDecimal(cashUsd + totalCurrentValue),
            totalInitialValue,
            totalCashPnl,
            positionCount,
            settledLossCount:
              typeof result.positions === 'object' &&
              result.positions !== null &&
              'settledLossCount' in result.positions
                ? result.positions.settledLossCount
                : 0,
          };
        }

        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
