import { z } from 'zod';

import { getPositions } from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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

        if (sections.includes('balance')) {
          tasks.push(
            client.getBalance().then((bal) => {
              result.balance = {
                usdc: bal.balance,
                allowance: bal.allowance,
              };
            })
          );
        }

        if (sections.includes('positions')) {
          tasks.push(
            getPositions(proxyAddr, { market, limit: 100 }).then(
              (positions) => {
                result.positions = {
                  count: positions.length,
                  items: positions.map((p) => ({
                    title: p.title,
                    outcome: p.outcome,
                    size: p.size,
                    avgPrice: p.avgPrice,
                    curPrice: p.curPrice,
                    currentValue: p.currentValue,
                    cashPnl: p.cashPnl,
                    percentPnl: p.percentPnl,
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
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
