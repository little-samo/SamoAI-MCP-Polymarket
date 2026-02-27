import { z } from 'zod';

import { Side, PriceHistoryInterval } from '../polymarket/client';
import {
  searchMarkets,
  listEvents,
  listMarkets,
  listTags,
  getEventBySlug,
  getEventById,
  getMarketByConditionId,
  getMarketBySlug,
  getMarketTrades,
  getOpenInterest,
} from '../polymarket/gamma';

import { formatResult, formatError } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerMarketTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'search_markets',
    {
      description:
        'Search Polymarket markets and events by keyword. Returns matching events and markets with prices, volumes, and slugs.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query string'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Max results per type'),
      }),
    },
    async ({ query, limit }) => {
      try {
        const results = await searchMarkets(query, limit);
        return formatResult(results);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'list_events',
    {
      description:
        'Browse active Polymarket events with pagination and sorting. Use order param to sort by volume_24hr, volume, liquidity, end_date, start_date, or competitive. Supports end_date_min/end_date_max to find markets ending within a specific timeframe (ISO 8601 date strings).',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Results per page'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset'),
        order: z
          .enum(['volume', 'liquidity', 'competitive'])
          .default('volume')
          .describe('Sort field'),
        ascending: z.boolean().default(false).describe('Sort ascending'),
        active: z.boolean().default(true).describe('Only active events'),
        closed: z.boolean().default(false).describe('Include closed events'),
        tag_id: z.number().int().optional().describe('Filter by tag ID'),
        end_date_min: z
          .string()
          .optional()
          .describe(
            'Min end date (ISO 8601) — use to find markets ending after this date'
          ),
        end_date_max: z
          .string()
          .optional()
          .describe(
            'Max end date (ISO 8601) — use to find markets ending before this date (e.g. to find soon-ending markets)'
          ),
      }),
    },
    async ({
      limit,
      offset,
      order,
      ascending,
      active,
      closed,
      tag_id,
      end_date_min,
      end_date_max,
    }) => {
      try {
        const events = await listEvents({
          limit,
          offset,
          order,
          ascending,
          active,
          closed,
          tag_id,
          end_date_min,
          end_date_max,
        });
        const summary = events.map((e) => ({
          id: e.id,
          title: e.title,
          slug: e.slug,
          endDate: e.endDate,
          active: e.active,
          closed: e.closed,
          volume: e.volume,
          liquidity: e.liquidity,
          markets: (e.markets ?? []).map((m) => ({
            question: m.question,
            conditionId: m.conditionId,
            slug: m.slug,
            endDate: m.endDate,
            outcomes: m.outcomes,
            outcomePrices: m.outcomePrices,
            volume: m.volume,
            active: m.active,
            closed: m.closed,
          })),
        }));
        return formatResult(summary);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'find_ending_soon',
    {
      description:
        'Find markets that are ending soon within the next N hours. Useful for finding markets approaching resolution.',
      inputSchema: z.object({
        hours: z
          .number()
          .min(0.5)
          .max(720)
          .default(24)
          .describe('Find markets ending within this many hours'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Max results'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset'),
      }),
    },
    async ({ hours, limit, offset }) => {
      try {
        const now = new Date();
        const maxEnd = new Date(now.getTime() + hours * 60 * 60 * 1000);
        const events = await listEvents({
          limit,
          offset,
          active: true,
          closed: false,
          order: 'volume',
          ascending: false,
          end_date_min: now.toISOString(),
          end_date_max: maxEnd.toISOString(),
        });
        const summary = events.map((e) => ({
          id: e.id,
          title: e.title,
          slug: e.slug,
          endDate: e.endDate,
          volume: e.volume,
          markets: (e.markets ?? []).map((m) => ({
            question: m.question,
            conditionId: m.conditionId,
            endDate: m.endDate,
            outcomePrices: m.outcomePrices,
            volume: m.volume,
          })),
        }));
        return formatResult({
          count: summary.length,
          endingBefore: maxEnd.toISOString(),
          events: summary,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_event',
    {
      description:
        'Get detailed information about a Polymarket event by ID or slug.',
      inputSchema: z.object({
        id: z.string().optional().describe('Event ID'),
        slug: z.string().optional().describe('Event slug (from URL)'),
      }),
    },
    async ({ id, slug }) => {
      try {
        if (!id && !slug) {
          return formatError('Provide either id or slug');
        }
        const event = id ? await getEventById(id) : await getEventBySlug(slug!);
        if (!event) return formatError('Event not found');
        return formatResult(event);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_market',
    {
      description:
        'Get detailed market info by condition ID or slug. Returns outcomes, token IDs, prices, and resolution details.',
      inputSchema: z.object({
        condition_id: z
          .string()
          .optional()
          .describe('Market condition ID (hex string)'),
        slug: z.string().optional().describe('Market slug'),
      }),
    },
    async ({ condition_id, slug }) => {
      try {
        if (!condition_id && !slug) {
          return formatError('Provide either condition_id or slug');
        }
        const market = condition_id
          ? await getMarketByConditionId(condition_id)
          : await getMarketBySlug(slug!);
        if (!market) return formatError('Market not found');
        return formatResult(market);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'list_markets',
    {
      description:
        'List Polymarket markets with filters. Supports filtering by end date, active/closed status, and sorting.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Results per page'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset'),
        active: z.boolean().optional().describe('Filter by active status'),
        closed: z.boolean().optional().describe('Filter by closed status'),
        order: z.string().optional().describe('Sort field'),
        ascending: z.boolean().optional().describe('Sort ascending'),
        end_date_min: z.string().optional().describe('Min end date (ISO 8601)'),
        end_date_max: z.string().optional().describe('Max end date (ISO 8601)'),
        tag_id: z.number().int().optional().describe('Filter by tag ID'),
      }),
    },
    async ({
      limit,
      offset,
      active,
      closed,
      order,
      ascending,
      end_date_min,
      end_date_max,
      tag_id,
    }) => {
      try {
        const markets = await listMarkets({
          limit,
          offset,
          active,
          closed,
          order,
          ascending,
          end_date_min,
          end_date_max,
          tag_id,
        });
        return formatResult(markets);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_orderbook',
    {
      description:
        'Get the full order book (bids and asks) for a specific token ID.',
      inputSchema: z.object({
        token_id: z.string().min(1).describe('Token ID'),
      }),
    },
    async ({ token_id }) => {
      try {
        const book = await client.getOrderBook(token_id);
        return formatResult(book);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_price',
    {
      description:
        'Get the midpoint price, best bid, best ask, spread, and last trade price for a token.',
      inputSchema: z.object({
        token_id: z.string().min(1).describe('Token ID'),
      }),
    },
    async ({ token_id }) => {
      try {
        const [midpoint, bid, ask, spread, lastTrade] = await Promise.all([
          client.getMidpoint(token_id),
          client.getPrice(token_id, Side.BUY),
          client.getPrice(token_id, Side.SELL),
          client.getSpread(token_id),
          client.getLastTradePrice(token_id),
        ]);
        return formatResult({
          token_id,
          midpoint,
          best_bid: bid,
          best_ask: ask,
          spread,
          last_trade: lastTrade,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_prices_history',
    {
      description:
        'Get historical price data for a token. Useful for analyzing price trends.',
      inputSchema: z.object({
        token_id: z.string().min(1).describe('Token ID'),
        interval: z
          .enum(['max', '1w', '1d', '6h', '1h'])
          .default('1d')
          .describe('Time interval for price data'),
        start_ts: z
          .number()
          .optional()
          .describe('Start timestamp (Unix seconds)'),
        end_ts: z.number().optional().describe('End timestamp (Unix seconds)'),
        fidelity: z
          .number()
          .optional()
          .describe('Resolution/fidelity of data points'),
      }),
    },
    async ({ token_id, interval, start_ts, end_ts, fidelity }) => {
      try {
        const intervalMap: Record<string, PriceHistoryInterval> = {
          max: PriceHistoryInterval.MAX,
          '1w': PriceHistoryInterval.ONE_WEEK,
          '1d': PriceHistoryInterval.ONE_DAY,
          '6h': PriceHistoryInterval.SIX_HOURS,
          '1h': PriceHistoryInterval.ONE_HOUR,
        };
        const raw = await client.getPricesHistory({
          market: token_id,
          interval: intervalMap[interval],
          startTs: start_ts,
          endTs: end_ts,
          fidelity,
        });
        const history = Array.isArray(raw)
          ? raw
          : ((raw as unknown as { history: unknown[] }).history ?? []);
        return formatResult({
          token_id,
          interval,
          data_points: history.length,
          history,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_market_trades',
    {
      description:
        'Get recent trades for a market or event. Returns trader info, side, size, price, outcome, and timestamps. No auth required.',
      inputSchema: z.object({
        market: z
          .string()
          .optional()
          .describe(
            'Market condition ID (hex). Mutually exclusive with event_id.'
          ),
        event_id: z
          .string()
          .optional()
          .describe('Event ID (numeric). Mutually exclusive with market.'),
        side: z.enum(['BUY', 'SELL']).optional().describe('Filter by side'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .default(50)
          .describe('Max results'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset'),
      }),
    },
    async ({ market, event_id, side, limit, offset }) => {
      try {
        if (!market && !event_id) {
          return formatError(
            'Provide either market (condition ID) or event_id'
          );
        }
        const trades = await getMarketTrades({
          market,
          eventId: event_id,
          side,
          limit,
          offset,
        });
        return formatResult({
          count: trades.length,
          trades: trades.map((t) => ({
            side: t.side,
            outcome: t.outcome,
            size: t.size,
            price: t.price,
            timestamp: t.timestamp,
            title: t.title,
            pseudonym: t.pseudonym || t.name,
            transactionHash: t.transactionHash,
          })),
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_open_interest',
    {
      description:
        'Get the open interest (total value locked in positions) for one or more markets. Useful for gauging market activity and liquidity depth.',
      inputSchema: z.object({
        condition_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(50)
          .describe('Array of market condition IDs'),
      }),
    },
    async ({ condition_ids }) => {
      try {
        const oi = await getOpenInterest(condition_ids);
        return formatResult(oi);
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'list_tags',
    {
      description:
        'List available market tags/categories. Use tag IDs to filter events and markets by category.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Max results'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset'),
      }),
    },
    async ({ limit, offset }) => {
      try {
        const tags = await listTags();
        const paged = tags.slice(offset, offset + limit);
        return formatResult({
          total: tags.length,
          count: paged.length,
          tags: paged.map((t) => ({
            id: t.id,
            label: t.label,
            slug: t.slug,
          })),
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
