const GAMMA_API = 'https://gamma-api.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';

export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  startDate: string;
  endDate: string;
  image: string;
  icon: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  liquidity: string;
  volume: string;
  markets: GammaMarket[];
  tags: GammaTag[];
  cyom?: boolean;
  commentCount: number;
  [key: string]: unknown;
}

export interface GammaTag {
  id: string;
  label: string;
  slug: string;
  [key: string]: unknown;
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  description: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  image: string;
  icon: string;
  clobTokenIds: string;
  acceptingOrders: boolean;
  negRisk: boolean;
  [key: string]: unknown;
}

export interface SearchResult {
  events: GammaEvent[];
  markets: GammaMarket[];
}

export interface GammaPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
  negativeRisk: boolean;
  [key: string]: unknown;
}

async function gammaGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = new URL(`${GAMMA_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `Gamma API error ${res.status}: ${await res.text().catch(() => res.statusText)}`
    );
  }
  return res.json() as Promise<T>;
}

async function dataGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const url = new URL(`${DATA_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `Data API error ${res.status}: ${await res.text().catch(() => res.statusText)}`
    );
  }
  return res.json() as Promise<T>;
}

export async function searchMarkets(
  query: string,
  limit: number = 10
): Promise<SearchResult> {
  const raw = await gammaGet<{
    events?: GammaEvent[];
    markets?: GammaMarket[];
  }>('/public-search', {
    q: query,
    limit_per_type: limit,
    events_status: 'active',
  });
  return {
    events: raw.events ?? [],
    markets: raw.markets ?? [],
  };
}

export interface ListEventsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
  tag_id?: number;
  end_date_min?: string;
  end_date_max?: string;
}

export async function listEvents(
  params: ListEventsParams = {}
): Promise<GammaEvent[]> {
  return gammaGet<GammaEvent[]>('/events', {
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    active: params.active ?? true,
    closed: params.closed ?? false,
    order: params.order ?? 'volume',
    ascending: params.ascending ?? false,
    tag_id: params.tag_id,
    end_date_min: params.end_date_min,
    end_date_max: params.end_date_max,
  });
}

export async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
  const results = await gammaGet<GammaEvent[]>('/events', { slug });
  return results[0] ?? null;
}

export async function getEventById(id: string): Promise<GammaEvent | null> {
  try {
    return await gammaGet<GammaEvent>(`/events/${id}`);
  } catch {
    return null;
  }
}

export async function getMarketByConditionId(
  conditionId: string
): Promise<GammaMarket | null> {
  const results = await gammaGet<GammaMarket[]>('/markets', {
    condition_ids: conditionId,
  });
  return results[0] ?? null;
}

export async function getMarketBySlug(
  slug: string
): Promise<GammaMarket | null> {
  const results = await gammaGet<GammaMarket[]>('/markets', { slug });
  return results[0] ?? null;
}

export async function listMarkets(params: {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  order?: string;
  ascending?: boolean;
  end_date_min?: string;
  end_date_max?: string;
  tag_id?: number;
}): Promise<GammaMarket[]> {
  return gammaGet<GammaMarket[]>('/markets', {
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    active: params.active,
    closed: params.closed,
    order: params.order,
    ascending: params.ascending,
    end_date_min: params.end_date_min,
    end_date_max: params.end_date_max,
    tag_id: params.tag_id,
  });
}

export async function listTags(): Promise<GammaTag[]> {
  return gammaGet<GammaTag[]>('/tags');
}

export interface DataTrade {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  name: string;
  pseudonym: string;
  transactionHash: string;
  [key: string]: unknown;
}

export interface OpenInterest {
  market: string;
  value: number;
}

export async function getMarketTrades(params: {
  market?: string;
  eventId?: string;
  user?: string;
  side?: string;
  limit?: number;
  offset?: number;
}): Promise<DataTrade[]> {
  return dataGet<DataTrade[]>('/trades', {
    market: params.market,
    eventId: params.eventId,
    user: params.user,
    side: params.side,
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  });
}

export async function getOpenInterest(
  conditionIds: string[]
): Promise<OpenInterest[]> {
  return dataGet<OpenInterest[]>('/oi', {
    market: conditionIds.join(','),
  });
}

export async function getPositions(
  userAddress: string,
  params?: {
    market?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortDirection?: string;
    sizeThreshold?: number;
  }
): Promise<GammaPosition[]> {
  return dataGet<GammaPosition[]>('/positions', {
    user: userAddress,
    market: params?.market,
    limit: params?.limit ?? 100,
    offset: params?.offset ?? 0,
    sortBy: params?.sortBy ?? 'CURRENT',
    sortDirection: params?.sortDirection ?? 'DESC',
    sizeThreshold: params?.sizeThreshold ?? 0.01,
  });
}
