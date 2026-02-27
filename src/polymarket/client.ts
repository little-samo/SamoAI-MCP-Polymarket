import {
  ClobClient,
  Chain,
  Side,
  OrderType,
  AssetType,
  PriceHistoryInterval,
} from '@polymarket/clob-client';
import { Wallet } from 'ethers';

import { isReadOnly } from '../config';

import type { PolymarketConfig } from '../config';
import type {
  ApiKeyCreds,
  BalanceAllowanceResponse,
  OpenOrder,
  OrderBookSummary,
  Trade,
  UserOrder,
  UserMarketOrder,
  TradeParams,
  OpenOrderParams,
  OrderMarketCancelParams,
  MarketPrice,
  PriceHistoryFilterParams,
} from '@polymarket/clob-client';

const CLOB_HOST = 'https://clob.polymarket.com';
const POLYGON_CHAIN_ID = Chain.POLYGON;

export { Side, OrderType, AssetType, PriceHistoryInterval };
export type {
  ApiKeyCreds,
  BalanceAllowanceResponse,
  OpenOrder,
  OrderBookSummary,
  Trade,
  UserOrder,
  UserMarketOrder,
  TradeParams,
  OpenOrderParams,
  OrderMarketCancelParams,
  MarketPrice,
  PriceHistoryFilterParams,
};

export class PolymarketClient {
  private readonly readonlyClob: ClobClient;
  private tradingClob: ClobClient | null = null;
  private wallet: Wallet | null = null;
  private readonly config: PolymarketConfig;

  public constructor(config: PolymarketConfig) {
    this.config = config;
    this.readonlyClob = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID);

    if (config.privateKey) {
      this.wallet = new Wallet(config.privateKey);
    }
  }

  public get isReadOnly(): boolean {
    return isReadOnly(this.config);
  }

  public get walletAddress(): string | null {
    return this.wallet?.address ?? null;
  }

  public get funderAddress(): string | undefined {
    return this.config.funderAddress;
  }

  public async initTrading(): Promise<void> {
    if (!this.wallet) {
      throw new Error('No private key configured — running in read-only mode');
    }

    const l1Client = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, this.wallet);
    const creds = await l1Client.createOrDeriveApiKey();
    console.error(
      `[polymarket] API credentials derived from private key for ${this.wallet.address}`
    );

    this.tradingClob = new ClobClient(
      CLOB_HOST,
      POLYGON_CHAIN_ID,
      this.wallet,
      creds,
      this.config.signatureType,
      this.config.funderAddress
    );
  }

  private requireTrading(): ClobClient {
    if (!this.tradingClob) {
      throw new Error(
        'Trading is not available. Provide POLYMARKET_PRIVATE_KEY to enable.'
      );
    }
    return this.tradingClob;
  }

  // ─── Public (no auth) ────────────────────────────────────────

  public async getOrderBook(tokenId: string): Promise<OrderBookSummary> {
    return this.readonlyClob.getOrderBook(tokenId);
  }

  public async getMidpoint(tokenId: string): Promise<string> {
    const res = await this.readonlyClob.getMidpoint(tokenId);
    return typeof res === 'object' && res.mid !== undefined
      ? String(res.mid)
      : String(res);
  }

  public async getPrice(tokenId: string, side: Side): Promise<string> {
    const res = await this.readonlyClob.getPrice(tokenId, side);
    return typeof res === 'object' && res.price !== undefined
      ? String(res.price)
      : String(res);
  }

  public async getSpread(tokenId: string): Promise<string> {
    const res = await this.readonlyClob.getSpread(tokenId);
    return typeof res === 'object' && res.spread !== undefined
      ? String(res.spread)
      : String(res);
  }

  public async getLastTradePrice(
    tokenId: string
  ): Promise<{ price: string; side: string }> {
    const res = await this.readonlyClob.getLastTradePrice(tokenId);
    return {
      price: String(res.price ?? '0'),
      side: String(res.side ?? ''),
    };
  }

  public async getTickSize(tokenId: string): Promise<string> {
    return this.readonlyClob.getTickSize(tokenId);
  }

  public async getNegRisk(tokenId: string): Promise<boolean> {
    return this.readonlyClob.getNegRisk(tokenId);
  }

  public async getPricesHistory(
    params: PriceHistoryFilterParams
  ): Promise<MarketPrice[]> {
    return this.readonlyClob.getPricesHistory(params);
  }

  // ─── Authenticated (L2) ──────────────────────────────────────

  public async getBalance(
    assetType: AssetType = AssetType.COLLATERAL,
    tokenId?: string
  ): Promise<BalanceAllowanceResponse> {
    const clob = this.requireTrading();
    return clob.getBalanceAllowance({
      asset_type: assetType,
      token_id: tokenId,
    });
  }

  public async getOpenOrders(params?: OpenOrderParams): Promise<OpenOrder[]> {
    const clob = this.requireTrading();
    const resp = await clob.getOpenOrders(params);
    return resp;
  }

  public async getOrder(orderId: string): Promise<OpenOrder> {
    const clob = this.requireTrading();
    return clob.getOrder(orderId);
  }

  public async getTrades(params?: TradeParams): Promise<Trade[]> {
    const clob = this.requireTrading();
    return clob.getTrades(params);
  }

  public async createLimitOrder(
    tokenId: string,
    side: Side,
    price: number,
    size: number
  ): Promise<unknown> {
    const clob = this.requireTrading();
    const userOrder: UserOrder = { tokenID: tokenId, price, size, side };
    return clob.createAndPostOrder(userOrder);
  }

  public async createMarketOrder(
    tokenId: string,
    side: Side,
    amount: number
  ): Promise<unknown> {
    const clob = this.requireTrading();
    const userMarketOrder: UserMarketOrder = {
      tokenID: tokenId,
      amount,
      side,
    };
    return clob.createAndPostMarketOrder(userMarketOrder);
  }

  public async cancelOrder(orderId: string): Promise<unknown> {
    const clob = this.requireTrading();
    return clob.cancelOrder({ orderID: orderId });
  }

  public async cancelOrders(orderIds: string[]): Promise<unknown> {
    const clob = this.requireTrading();
    return clob.cancelOrders(orderIds);
  }

  public async cancelAll(): Promise<unknown> {
    const clob = this.requireTrading();
    return clob.cancelAll();
  }

  public async cancelMarketOrders(
    params: OrderMarketCancelParams
  ): Promise<unknown> {
    const clob = this.requireTrading();
    return clob.cancelMarketOrders(params);
  }
}
