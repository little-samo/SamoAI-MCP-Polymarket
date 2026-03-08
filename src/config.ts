import 'dotenv/config';

export interface BuilderRelayerConfig {
  apiKey: string;
  secret: string;
  passphrase: string;
  relayerUrl: string;
}

export interface PolymarketConfig {
  port: number;
  privateKey: string | undefined;
  signatureType: number;
  funderAddress: string | undefined;
  rpcUrl: string;
  rpcUrls: string[];
  builderRelayer: BuilderRelayerConfig | undefined;
}

const DEFAULT_POLYGON_RPC_URL = 'https://polygon.drpc.org';
const DEFAULT_POLYGON_RPC_FALLBACKS = [
  'https://rpc-mainnet.matic.quiknode.pro',
  'https://polygon-rpc.com',
];
const DEFAULT_RELAYER_URL = 'https://relayer-v2.polymarket.com/';

function uniqueValues(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ] as string[];
}

export function loadConfig(): PolymarketConfig {
  const sigType = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || '2', 10);
  if (![0, 1, 2].includes(sigType)) {
    throw new Error(
      `Invalid POLYMARKET_SIGNATURE_TYPE: ${sigType}. Must be 0 (EOA), 1 (POLY_PROXY), or 2 (GNOSIS_SAFE).`
    );
  }

  const rpcUrls = uniqueValues([
    process.env.POLYGON_RPC_URL || DEFAULT_POLYGON_RPC_URL,
    ...DEFAULT_POLYGON_RPC_FALLBACKS,
  ]);

  const builderRelayer =
    process.env.POLY_BUILDER_API_KEY &&
    process.env.POLY_BUILDER_SECRET &&
    process.env.POLY_BUILDER_PASSPHRASE
      ? {
          apiKey: process.env.POLY_BUILDER_API_KEY,
          secret: process.env.POLY_BUILDER_SECRET,
          passphrase: process.env.POLY_BUILDER_PASSPHRASE,
          relayerUrl: process.env.POLYMARKET_RELAYER_URL || DEFAULT_RELAYER_URL,
        }
      : undefined;

  return {
    port: parseInt(process.env.PORT || '11188', 10),
    privateKey: process.env.POLYMARKET_PRIVATE_KEY || undefined,
    signatureType: sigType,
    funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS || undefined,
    rpcUrl: rpcUrls[0],
    rpcUrls,
    builderRelayer,
  };
}

export function isReadOnly(config: PolymarketConfig): boolean {
  return !config.privateKey;
}
