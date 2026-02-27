import 'dotenv/config';

export interface PolymarketConfig {
  port: number;
  privateKey: string | undefined;
  funderAddress: string | undefined;
  signatureType: number;
}

export function loadConfig(): PolymarketConfig {
  const sigType = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE || '2', 10);
  if (![0, 1, 2].includes(sigType)) {
    throw new Error(
      `Invalid POLYMARKET_SIGNATURE_TYPE: ${sigType}. Must be 0 (EOA), 1 (POLY_PROXY), or 2 (GNOSIS_SAFE).`
    );
  }
  return {
    port: parseInt(process.env.PORT || '11188', 10),
    privateKey: process.env.POLYMARKET_PRIVATE_KEY || undefined,
    funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS || undefined,
    signatureType: sigType,
  };
}

export function isReadOnly(config: PolymarketConfig): boolean {
  return !config.privateKey;
}
