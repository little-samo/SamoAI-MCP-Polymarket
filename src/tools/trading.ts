import { z } from 'zod';

import { Side } from '../polymarket/client';
import { getMarketByConditionId } from '../polymarket/gamma';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
        'Redeem (claim) winning positions after market resolution. Executes an on-chain transaction through the Gnosis Safe proxy. Requires POL for gas. Use get_account with positions section to find redeemable positions.',
      inputSchema: z.object({
        condition_id: z
          .string()
          .min(1)
          .describe('Market condition ID to redeem'),
      }),
    },
    async ({ condition_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const market = await getMarketByConditionId(condition_id);
        if (!market) return formatError('Market not found');

        let tokenIds: string[] = [];
        try {
          tokenIds = JSON.parse(market.clobTokenIds);
        } catch {
          return formatError('Could not parse token IDs from market data');
        }

        const result = await client.redeemPositions(
          condition_id,
          tokenIds,
          market.negRisk
        );
        return formatResult({
          success: true,
          ...result,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
