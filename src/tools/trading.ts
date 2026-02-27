import { z } from 'zod';

import { Side } from '../polymarket/client';

import { formatResult, formatError, requireAuth } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerTradingTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'create_order',
    {
      description:
        'Place a limit order (GTC). Specify the token_id, side (BUY/SELL), price, and size. Tick size and neg_risk are auto-detected. Price must be between 0 and 1. Size is the number of shares.',
      inputSchema: z.object({
        token_id: z
          .string()
          .min(1)
          .describe('Token ID of the outcome to trade'),
        side: z.enum(['BUY', 'SELL']).describe('Order side'),
        price: z
          .number()
          .gt(0)
          .lt(1)
          .describe('Limit price (between 0 and 1 exclusive)'),
        size: z.number().gt(0).describe('Number of shares'),
      }),
    },
    async ({ token_id, side, price, size }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const orderSide = side === 'BUY' ? Side.BUY : Side.SELL;
        const result = await client.createLimitOrder(
          token_id,
          orderSide,
          price,
          size
        );
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'create_market_order',
    {
      description:
        'Place a market order (FOK). For BUY: amount is in USDC. For SELL: amount is in shares.',
      inputSchema: z.object({
        token_id: z
          .string()
          .min(1)
          .describe('Token ID of the outcome to trade'),
        side: z.enum(['BUY', 'SELL']).describe('Order side'),
        amount: z
          .number()
          .gt(0)
          .describe('For BUY: USDC amount. For SELL: number of shares'),
      }),
    },
    async ({ token_id, side, amount }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const orderSide = side === 'BUY' ? Side.BUY : Side.SELL;
        const result = await client.createMarketOrder(
          token_id,
          orderSide,
          amount
        );
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'cancel_order',
    {
      description: 'Cancel a specific open order by order ID.',
      inputSchema: z.object({
        order_id: z.string().min(1).describe('Order ID to cancel'),
      }),
    },
    async ({ order_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const result = await client.cancelOrder(order_id);
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'cancel_orders',
    {
      description: 'Cancel multiple open orders by their order IDs.',
      inputSchema: z.object({
        order_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(3000)
          .describe('Array of order IDs to cancel'),
      }),
    },
    async ({ order_ids }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const result = await client.cancelOrders(order_ids);
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'cancel_all_orders',
    {
      description:
        'Cancel ALL open orders for the authenticated user. Use with caution.',
      inputSchema: z.object({}),
    },
    async () => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const result = await client.cancelAll();
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'cancel_market_orders',
    {
      description: 'Cancel all open orders for a specific market or token.',
      inputSchema: z.object({
        market: z
          .string()
          .optional()
          .describe('Market condition ID to cancel orders for'),
        asset_id: z
          .string()
          .optional()
          .describe('Token ID to cancel orders for'),
      }),
    },
    async ({ market, asset_id }) => {
      const authErr = requireAuth(client.isReadOnly);
      if (authErr) return formatError(authErr);
      try {
        const result = await client.cancelMarketOrders({
          market,
          asset_id,
        });
        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
