import { z } from 'zod';

import { PriceHistoryInterval } from '../polymarket/client';
import {
  searchMarkets,
  listMarkets,
  getMarketByConditionId,
  getMarketBySlug,
  getMarketTrades,
} from '../polymarket/gamma';

import { formatResult, formatError } from './utils';

import type { PolymarketClient } from '../polymarket/client';
import type { GammaMarket } from '../polymarket/gamma';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function parseMarketFields(market: GammaMarket) {
  let outcomes: string[] = [];
  let prices: number[] = [];
  let tokenIds: string[] = [];
  try {
    outcomes = JSON.parse(market.outcomes);
  } catch {
    /* empty */
  }
  try {
    prices = JSON.parse(market.outcomePrices);
  } catch {
    /* empty */
  }
  try {
    tokenIds = JSON.parse(market.clobTokenIds);
  } catch {
    /* empty */
  }
  return { outcomes, prices, tokenIds };
}

export function registerMarketTools(
  server: McpServer,
  client: PolymarketClient
): void {
  server.registerTool(
    'find_markets',
    {
      description:
        'Find Polymarket markets by keyword, time-to-expiry range, and/or outcome price range. Combines search, browse, and filtering in one call. Returns compact market list with token IDs ready for trading.',
      inputSchema: z.object({
        query: z.string().optional().describe('Keyword search'),
        hours_min: z
          .number()
          .min(0)
          .optional()
          .describe('Min hours until market closes'),
        hours_max: z
          .number()
          .min(0)
          .optional()
          .describe('Max hours until market closes'),
        price_min: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Min outcome price (0-1)'),
        price_max: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Max outcome price (0-1)'),
        liquidity_min: z
          .number()
          .min(0)
          .optional()
          .describe('Min liquidity in USD (e.g. 1000)'),
        volume_min: z
          .number()
          .min(0)
          .optional()
          .describe('Min volume in USD (e.g. 500)'),
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
        order: z
          .enum(['volume', 'liquidity', 'competitive'])
          .default('volume')
          .describe('Sort field'),
      }),
    },
    async ({
      query,
      hours_min,
      hours_max,
      price_min,
      price_max,
      liquidity_min,
      volume_min,
      limit,
      offset,
      order,
    }) => {
      try {
        const now = Date.now();
        const endDateMin =
          hours_min !== undefined
            ? new Date(now + hours_min * 3_600_000).toISOString()
            : hours_max !== undefined
              ? new Date(now).toISOString()
              : undefined;
        const endDateMax =
          hours_max !== undefined
            ? new Date(now + hours_max * 3_600_000).toISOString()
            : undefined;

        let markets: GammaMarket[];

        if (query) {
          const results = await searchMarkets(query, 100);
          markets = [...results.markets];
          for (const event of results.events) {
            if (event.markets) markets.push(...event.markets);
          }
          const seen = new Set<string>();
          markets = markets.filter((m) => {
            if (seen.has(m.conditionId)) return false;
            seen.add(m.conditionId);
            return true;
          });
          if (endDateMin || endDateMax) {
            markets = markets.filter((m) => {
              const end = new Date(m.endDate).getTime();
              if (endDateMin && end < new Date(endDateMin).getTime())
                return false;
              if (endDateMax && end > new Date(endDateMax).getTime())
                return false;
              return true;
            });
          }
        } else {
          markets = await listMarkets({
            limit: 100,
            offset: 0,
            active: true,
            closed: false,
            order,
            ascending: false,
            end_date_min: endDateMin,
            end_date_max: endDateMax,
          });
        }

        markets = markets.filter((m) => m.active && !m.closed);

        if (price_min !== undefined || price_max !== undefined) {
          markets = markets.filter((m) => {
            const { prices } = parseMarketFields(m);
            return prices.some((p) => {
              if (price_min !== undefined && p < price_min) return false;
              if (price_max !== undefined && p > price_max) return false;
              return true;
            });
          });
        }

        if (liquidity_min !== undefined) {
          markets = markets.filter((m) => Number(m.liquidity) >= liquidity_min);
        }
        if (volume_min !== undefined) {
          markets = markets.filter((m) => Number(m.volume) >= volume_min);
        }

        if (query) {
          markets.sort((a, b) => Number(b.volume) - Number(a.volume));
        }

        const paged = markets.slice(offset, offset + limit);

        const result = paged.map((m) => {
          const { outcomes, prices, tokenIds } = parseMarketFields(m);
          return {
            question: m.question,
            conditionId: m.conditionId,
            slug: m.slug,
            endDate: m.endDate,
            outcomes: outcomes.map((o, i) => ({
              name: o,
              price: prices[i],
              tokenId: tokenIds[i],
            })),
            volume: m.volume,
            liquidity: m.liquidity,
          };
        });

        return formatResult({
          total_found: markets.length,
          count: result.length,
          markets: result,
        });
      } catch (e) {
        return formatError(e);
      }
    }
  );

  server.registerTool(
    'get_market',
    {
      description:
        'Get detailed market info with optional orderbook, recent trades, and price history. Orderbook included by default for trading decisions.',
      inputSchema: z.object({
        condition_id: z.string().optional().describe('Market condition ID'),
        slug: z.string().optional().describe('Market slug'),
        include_orderbook: z
          .boolean()
          .default(true)
          .describe('Include orderbook depth (top 5 levels)'),
        include_trades: z
          .boolean()
          .default(false)
          .describe('Include recent public trades'),
        include_history: z
          .boolean()
          .default(false)
          .describe('Include price history'),
        history_interval: z
          .enum(['1h', '6h', '1d', '1w', 'max'])
          .default('1d')
          .describe('Price history interval'),
      }),
    },
    async ({
      condition_id,
      slug,
      include_orderbook,
      include_trades,
      include_history,
      history_interval,
    }) => {
      try {
        if (!condition_id && !slug) {
          return formatError('Provide condition_id or slug');
        }

        const market = condition_id
          ? await getMarketByConditionId(condition_id)
          : await getMarketBySlug(slug!);
        if (!market) return formatError('Market not found');

        const { outcomes, prices, tokenIds } = parseMarketFields(market);

        const result: Record<string, unknown> = {
          question: market.question,
          conditionId: market.conditionId,
          slug: market.slug,
          endDate: market.endDate,
          description: market.description,
          active: market.active,
          closed: market.closed,
          volume: market.volume,
          liquidity: market.liquidity,
          outcomes: outcomes.map((o, i) => ({
            name: o,
            price: prices[i],
            tokenId: tokenIds[i],
          })),
        };

        if (include_orderbook && tokenIds.length > 0) {
          const books = await Promise.all(
            tokenIds.map(async (tid, i) => {
              const [book, mid, spread] = await Promise.all([
                client.getOrderBook(tid),
                client.getMidpoint(tid),
                client.getSpread(tid),
              ]);
              const sortedBids = [...(book.bids ?? [])].sort(
                (a, b) => Number(b.price) - Number(a.price)
              );
              const sortedAsks = [...(book.asks ?? [])].sort(
                (a, b) => Number(a.price) - Number(b.price)
              );
              return {
                outcome: outcomes[i],
                tokenId: tid,
                midpoint: mid,
                spread,
                bids: sortedBids.slice(0, 5),
                asks: sortedAsks.slice(0, 5),
              };
            })
          );
          result.orderbooks = books;
        }

        if (include_trades) {
          const trades = await getMarketTrades({
            market: market.conditionId,
            limit: 20,
          });
          result.recent_trades = trades.map((t) => ({
            side: t.side,
            outcome: t.outcome,
            size: t.size,
            price: t.price,
            timestamp: t.timestamp,
          }));
        }

        if (include_history && tokenIds.length > 0) {
          const intervalMap: Record<string, PriceHistoryInterval> = {
            max: PriceHistoryInterval.MAX,
            '1w': PriceHistoryInterval.ONE_WEEK,
            '1d': PriceHistoryInterval.ONE_DAY,
            '6h': PriceHistoryInterval.SIX_HOURS,
            '1h': PriceHistoryInterval.ONE_HOUR,
          };
          const raw = await client.getPricesHistory({
            market: tokenIds[0],
            interval: intervalMap[history_interval],
            fidelity: 1,
          });
          const history = Array.isArray(raw)
            ? raw
            : ((raw as unknown as { history: unknown[] }).history ?? []);
          result.price_history = {
            outcome: outcomes[0],
            data_points: history.length,
            history,
          };
        }

        return formatResult(result);
      } catch (e) {
        return formatError(e);
      }
    }
  );
}
