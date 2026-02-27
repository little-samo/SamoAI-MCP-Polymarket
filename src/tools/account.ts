import { z } from 'zod';

import { AssetType } from '../polymarket/client';
import { getPositions } from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerAccountTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'get_balance',
    {
      description:
        'Get USDC collateral balance and allowance. Optionally check conditional token balance for a specific token_id.',
      inputSchema: z.object({
        asset_type: z
          .enum(['COLLATERAL', 'CONDITIONAL'])
          .default('COLLATERAL')
          .describe(
            'Asset type: COLLATERAL for USDC, CONDITIONAL for outcome tokens'
          ),
        token_id: z
          .string()
          .optional()
          .describe('Token ID (required when asset_type is CONDITIONAL)'),
      }),
    },
    async ({ asset_type, token_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const assetEnum =
          asset_type === 'COLLATERAL'
            ? AssetType.COLLATERAL
            : AssetType.CONDITIONAL;
        const result = await client.getBalance(assetEnum, token_id);
        return formatResult({
          asset_type,
          token_id: token_id ?? null,
          balance: result.balance,
          allowance: result.allowance,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_positions',
    {
      description:
        'Get current open positions for the authenticated wallet. Shows P&L, sizes, and current prices via the Data API.',
      inputSchema: z.object({
        market: z.string().optional().describe('Filter by market condition ID'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe('Max results'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset'),
        sort_by: z
          .enum([
            'CURRENT',
            'INITIAL',
            'TOKENS',
            'CASHPNL',
            'PERCENTPNL',
            'TITLE',
            'RESOLVING',
            'PRICE',
            'AVGPRICE',
          ])
          .default('CURRENT')
          .describe('Sort field'),
        sort_direction: z
          .enum(['ASC', 'DESC'])
          .default('DESC')
          .describe('Sort direction'),
      }),
    },
    async ({ market, limit, offset, sort_by, sort_direction }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      const addr = client.funderAddress ?? client.walletAddress;
      if (!addr) return formatError('No wallet address available');
      try {
        const positions = await getPositions(addr, {
          market,
          limit,
          offset,
          sortBy: sort_by,
          sortDirection: sort_direction,
        });
        const summary = positions.map((p) => ({
          title: p.title,
          outcome: p.outcome,
          size: p.size,
          avgPrice: p.avgPrice,
          curPrice: p.curPrice,
          currentValue: p.currentValue,
          initialValue: p.initialValue,
          cashPnl: p.cashPnl,
          percentPnl: p.percentPnl,
          realizedPnl: p.realizedPnl,
          conditionId: p.conditionId,
          endDate: p.endDate,
          redeemable: p.redeemable,
          mergeable: p.mergeable,
        }));
        return formatResult({
          wallet: addr,
          count: summary.length,
          positions: summary,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_open_orders',
    {
      description:
        'List all open orders for the authenticated user. Optionally filter by market or token.',
      inputSchema: z.object({
        market: z.string().optional().describe('Filter by market condition ID'),
        asset_id: z.string().optional().describe('Filter by token ID'),
      }),
    },
    async ({ market, asset_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const orders = await client.getOpenOrders({ market, asset_id });
        return formatResult({
          count: orders.length,
          orders,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_order',
    {
      description: 'Get details of a specific order by order ID.',
      inputSchema: z.object({
        order_id: z.string().min(1).describe('Order ID (hash)'),
      }),
    },
    async ({ order_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const order = await client.getOrder(order_id);
        return formatResult(order);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_trades',
    {
      description:
        'Get trade history for the authenticated user. Filter by market, token, or time range.',
      inputSchema: z.object({
        market: z.string().optional().describe('Filter by market condition ID'),
        asset_id: z.string().optional().describe('Filter by token ID'),
        before: z.string().optional().describe('Trades before this timestamp'),
        after: z.string().optional().describe('Trades after this timestamp'),
      }),
    },
    async ({ market, asset_id, before, after }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const trades = await client.getTrades({
          market,
          asset_id,
          before,
          after,
        });
        return formatResult({
          count: trades.length,
          trades,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
