<div align="center">
  <img src="https://media.githubusercontent.com/media/little-samo/CI/master/assets/characters/samo/profile.png" alt="Little Samo Mascot" width="250" />
  <h1>SamoAI-MCP-Polymarket</h1>
  <p><em>MCP SSE server for <a href="https://polymarket.com">Polymarket</a> — enabling AI agents to discover markets and execute trades</em></p>
</div>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#available-tools">Tools</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#usage">Usage</a> •
  <a href="#license">License</a>
</p>

## Features

- **Market Discovery** — Search markets, browse events, and get detailed market info via Polymarket's Gamma and CLOB APIs
- **Real-time Market Data** — Order books, prices, spreads, and recent trades
- **Trading** — Place limit and market orders, cancel orders, check balances and positions
- **Gasless Claim** — Redeem resolved positions through Polymarket's Builder Relayer when builder credentials are configured
- **Read-only Mode** — Runs without authentication for market data only; provide a private key to enable trading
- **Streamable HTTP Transport** — Standard MCP server compatible with any MCP client

## Available Tools

### Market Discovery (no auth required)

| Tool | Description |
|------|-------------|
| `find_markets` | Search and filter active markets by keyword, time-to-expiry, price range, liquidity, and volume |
| `get_market` | Get detailed market info by condition ID or slug, with optional orderbooks, recent trades, and price history |

### Account (auth required)

| Tool | Description |
|------|-------------|
| `get_account` | Get wallet balance, portfolio summary, positions, open orders, and trade history in one call |

### Trading (auth required)

| Tool | Description |
|------|-------------|
| `place_order` | Place a limit or market order for a token |
| `cancel_orders` | Cancel specific orders, all orders in a market/token, or all open orders |
| `redeem_positions` | Claim winning positions after market resolution, with gasless or on-chain execution |

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 11188) |
| `POLYMARKET_PRIVATE_KEY` | No | Ethereum private key for trading |
| `POLYMARKET_SIGNATURE_TYPE` | No | Signature type: `0` (EOA), `1` (POLY_PROXY), `2` (GNOSIS_SAFE, default) |
| `POLYMARKET_FUNDER_ADDRESS` | Sometimes | Required for `POLY_PROXY` and `GNOSIS_SAFE`; wallet/proxy address shown in Polymarket settings |
| `POLYGON_RPC_URL` | No | Primary Polygon RPC URL. Fallback order is `POLYGON_RPC_URL` or `https://polygon.drpc.org`, then `https://rpc-mainnet.matic.quiknode.pro`, then `https://polygon-rpc.com` |
| `POLY_BUILDER_API_KEY` | No | Enables gasless claim when used together with the builder secret and passphrase |
| `POLY_BUILDER_SECRET` | No | Builder relayer secret for gasless claim |
| `POLY_BUILDER_PASSPHRASE` | No | Builder relayer passphrase for gasless claim |
| `POLYMARKET_RELAYER_URL` | No | Optional override for the Polymarket builder relayer URL |

If `POLYMARKET_PRIVATE_KEY` is not set, the server runs in **read-only mode** — market data tools work, trading tools return an error.

### Authentication

Only `POLYMARKET_PRIVATE_KEY` is required for trading. API credentials are **automatically derived** from your private key on startup via Polymarket's L1 authentication.

If `POLY_BUILDER_API_KEY`, `POLY_BUILDER_SECRET`, and `POLY_BUILDER_PASSPHRASE` are all set, `redeem_positions` will try a gasless claim through Polymarket's Builder Relayer first. If the gasless flow fails, the server automatically falls back to the normal on-chain transaction path.

**Signature types** (see [Polymarket docs](https://docs.polymarket.com/api-reference/authentication)):

| Type | Value | When to use |
|------|-------|-------------|
| EOA | `0` | Standard Ethereum wallet (requires POL for gas) |
| POLY_PROXY | `1` | Magic Link login users who exported their PK from Polymarket.com |
| GNOSIS_SAFE | `2` | Most common — use this for new or returning users (default) |

The funder (maker) address defaults to the signer address derived from your private key.

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### MCP Client Configuration

Add to your MCP client config (e.g., Cursor, Claude Desktop):

```json
{
  "mcpServers": {
    "polymarket": {
      "url": "http://localhost:11188/mcp"
    }
  }
}
```

### Health Check

```
GET http://localhost:11188/health
```

Returns server status, mode (read-only/trading), and wallet address.

## Agent Workflow Example

A typical agent flow for discovering and trading on a market:

1. **Search** — `find_markets({ query: "US election", limit: 10 })` to find relevant markets
2. **Inspect** — `get_market({ condition_id: "...", include_orderbook: true })` to see token IDs, outcomes, and top-of-book liquidity
3. **Analyze** — `get_market({ condition_id: "...", include_trades: true, include_history: true })` to review recent flow and price history
4. **Check Account** — `get_account({ sections: ["balance", "positions"] })` to verify cash balance and current portfolio value
5. **Trade** — `place_order({ token_id, side: "BUY", type: "limit", price: 0.65, size: 100 })` to place a limit order
6. **Monitor** — `get_account({ sections: ["orders"] })` to review open orders, then `cancel_orders({ order_ids: ["..."] })` if needed

## Tech Stack

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Protocol implementation
- [@polymarket/clob-client](https://github.com/Polymarket/clob-client) — Polymarket CLOB API
- [Polymarket Gamma API](https://gamma-api.polymarket.com) — Market search and event data
- Express — HTTP server for SSE transport

## License

[MIT License](LICENSE)

---

<div align="center">
  <p>Made with ❤️ by the SamoAI Team</p>
</div>
