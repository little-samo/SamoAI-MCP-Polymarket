import { z } from 'zod';

import { getPositions } from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const USDC_DECIMALS = 6;

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

export function registerAccountTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'get_account',
    {
      description:
        'Get account overview: USDC balance, open positions, pending orders, and/or trade history. Combine multiple sections in one call to minimize round-trips.',
      inputSchema: z.object({
        sections: z
          .array(z.enum(['balance', 'positions', 'orders', 'trades']))
          .default(['balance', 'positions', 'orders'])
          .describe('Data sections to include'),
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
    async ({ sections, market, order_id }) => {
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
            getPositions(proxyAddr, { market, limit: 100 }).then(
              (positions) => {
                totalCurrentValue = roundDecimal(
                  positions.reduce(
                    (sum, position) =>
                      sum + toFiniteNumber(position.currentValue),
                    0
                  )
                );
                totalInitialValue = roundDecimal(
                  positions.reduce(
                    (sum, position) =>
                      sum + toFiniteNumber(position.initialValue),
                    0
                  )
                );
                totalCashPnl = roundDecimal(
                  positions.reduce(
                    (sum, position) => sum + toFiniteNumber(position.cashPnl),
                    0
                  )
                );
                positionCount = positions.length;

                if (!includePositions) {
                  return;
                }

                result.positions = {
                  count: positionCount,
                  totalCurrentValue,
                  totalInitialValue,
                  totalCashPnl,
                  items: positions.map((p) => ({
                    title: p.title,
                    outcome: p.outcome,
                    size: roundDecimal(toFiniteNumber(p.size)),
                    avgPrice: roundDecimal(toFiniteNumber(p.avgPrice)),
                    curPrice: roundDecimal(toFiniteNumber(p.curPrice)),
                    currentValue: roundDecimal(toFiniteNumber(p.currentValue)),
                    cashPnl: roundDecimal(toFiniteNumber(p.cashPnl)),
                    percentPnl: roundDecimal(toFiniteNumber(p.percentPnl)),
                    conditionId: p.conditionId,
                    endDate: p.endDate,
                    redeemable: p.redeemable,
                  })),
                };
              }
            )
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
          };
        }

        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
