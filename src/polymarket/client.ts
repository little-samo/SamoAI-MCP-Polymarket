import {
  ClobClient,
  Chain,
  Side,
  OrderType,
  AssetType,
  PriceHistoryInterval,
} from '@polymarket/clob-client';
import { Wallet, Contract, constants, utils, providers } from 'ethers';

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

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
];
const NEG_RISK_REDEEM_ABI = [
  'function redeemPositions(bytes32 conditionId, uint256[] calldata amounts)',
];
const SAFE_EXEC_ABI = [
  'function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures) external payable returns (bool)',
];

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

  public get proxyAddress(): string | null {
    return this.config.funderAddress ?? this.wallet?.address ?? null;
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

  private extractValue(res: unknown): string {
    if (res === null || res === undefined) return '0';
    if (typeof res !== 'object') return String(res);
    const obj = res as Record<string, unknown>;
    for (const v of Object.values(obj)) {
      if (v !== null && v !== undefined && typeof v !== 'object') {
        return String(v);
      }
    }
    return JSON.stringify(res);
  }

  public async getMidpoint(tokenId: string): Promise<string> {
    return this.extractValue(await this.readonlyClob.getMidpoint(tokenId));
  }

  public async getPrice(tokenId: string, side: Side): Promise<string> {
    return this.extractValue(await this.readonlyClob.getPrice(tokenId, side));
  }

  public async getSpread(tokenId: string): Promise<string> {
    return this.extractValue(await this.readonlyClob.getSpread(tokenId));
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

  public async updateBalanceAllowance(
    assetType: AssetType = AssetType.COLLATERAL,
    tokenId?: string
  ): Promise<unknown> {
    const clob = this.requireTrading();
    return (
      clob as unknown as Record<string, CallableFunction>
    ).updateBalanceAllowance({
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

  // ─── On-chain (redeem) ──────────────────────────────────────

  public async redeemPositions(
    conditionId: string,
    tokenIds: string[],
    negRisk: boolean
  ): Promise<{ transactionHash: string }> {
    if (!this.wallet) {
      throw new Error('No private key configured');
    }
    const safeAddress = this.config.funderAddress;
    if (!safeAddress) {
      throw new Error(
        'POLYMARKET_FUNDER_ADDRESS required for on-chain redemption'
      );
    }

    const provider = new providers.JsonRpcProvider(this.config.rpcUrl);
    const signer = this.wallet.connect(provider);

    let targetContract: string;
    let calldata: string;

    if (negRisk) {
      const ctf = new Contract(CTF_ADDRESS, CTF_ABI, provider);
      const balances = await Promise.all(
        tokenIds.map((tid) => ctf.balanceOf(safeAddress, tid))
      );
      const iface = new utils.Interface(NEG_RISK_REDEEM_ABI);
      targetContract = NEG_RISK_ADAPTER;
      calldata = iface.encodeFunctionData('redeemPositions', [
        conditionId,
        balances,
      ]);
    } else {
      const iface = new utils.Interface(CTF_ABI);
      targetContract = CTF_ADDRESS;
      calldata = iface.encodeFunctionData('redeemPositions', [
        USDC_E,
        constants.HashZero,
        conditionId,
        [1, 2],
      ]);
    }

    const signature = utils.solidityPack(
      ['bytes32', 'bytes32', 'uint8'],
      [utils.hexZeroPad(signer.address, 32), constants.HashZero, 1]
    );

    const safe = new Contract(safeAddress, SAFE_EXEC_ABI, signer);
    const minTip = utils.parseUnits('30', 'gwei');
    const feeData = await provider.getFeeData();
    const basePriority = feeData.maxPriorityFeePerGas ?? minTip;
    const maxPriority = basePriority.lt(minTip) ? minTip : basePriority;
    const maxFee = (feeData.maxFeePerGas ?? maxPriority).add(maxPriority);

    const tx = await safe.execTransaction(
      targetContract,
      0,
      calldata,
      0,
      0,
      0,
      0,
      constants.AddressZero,
      constants.AddressZero,
      signature,
      { maxPriorityFeePerGas: maxPriority, maxFeePerGas: maxFee }
    );

    const receipt = await tx.wait();
    return { transactionHash: receipt.transactionHash };
  }
}
