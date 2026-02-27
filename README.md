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
- **Read-only Mode** — Runs without authentication for market data only; provide a private key to enable trading
- **Streamable HTTP Transport** — Standard MCP server compatible with any MCP client

## Available Tools

### Market Discovery (no auth required)

| Tool | Description |
|------|-------------|
| `search_markets` | Search markets by keyword |
| `get_market` | Get detailed market info by condition ID or slug |
| `get_event` | Get detailed event info by ID or slug |
| `list_events` | Browse active events with pagination |
| `list_markets` | List markets with filters and sorting |
| `find_ending_soon` | Find markets ending within N hours |
| `get_orderbook` | Get bids/asks for a token |
| `get_price` | Get midpoint, spread, and last trade price |
| `get_prices_history` | Get historical price data for a token |
| `get_market_trades` | Get recent trades for a market or event |
| `get_open_interest` | Get open interest for markets |
| `list_tags` | List market tags/categories |

### Account (auth required)

| Tool | Description |
|------|-------------|
| `get_balance` | Get USDC or token balance and allowance |
| `get_positions` | Get current open positions with P&L |
| `get_open_orders` | List open orders with optional filters |
| `get_order` | Get details of a specific order |
| `get_trades` | Get trade history |

### Trading (auth required)

| Tool | Description |
|------|-------------|
| `create_order` | Place a limit order (auto-detects tick size) |
| `create_market_order` | Place a market order |
| `cancel_order` | Cancel a specific order |
| `cancel_orders` | Cancel multiple orders by IDs |
| `cancel_all_orders` | Cancel all open orders |
| `cancel_market_orders` | Cancel all orders for a specific market/token |

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
| `POLYMARKET_FUNDER_ADDRESS` | No | Proxy wallet address (see [Authentication](#authentication)) |
| `POLYMARKET_SIGNATURE_TYPE` | No | Signature type: `0` (EOA), `1` (POLY_PROXY), `2` (GNOSIS_SAFE, default) |

If `POLYMARKET_PRIVATE_KEY` is not set, the server runs in **read-only mode** — market data tools work, trading tools return an error.

### Authentication

Only `POLYMARKET_PRIVATE_KEY` is required for trading. API credentials are **automatically derived** from your private key on startup via Polymarket's L1 authentication.

**Signature types** (see [Polymarket docs](https://docs.polymarket.com/api-reference/authentication)):

| Type | Value | When to use |
|------|-------|-------------|
| EOA | `0` | Standard Ethereum wallet (requires POL for gas) |
| POLY_PROXY | `1` | Magic Link login users who exported their PK from Polymarket.com |
| GNOSIS_SAFE | `2` | Most common — use this for new or returning users (default) |

When using `GNOSIS_SAFE` (default), set `POLYMARKET_FUNDER_ADDRESS` to the proxy wallet address shown on your [Polymarket profile](https://polymarket.com/settings).

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

1. **Search** — `search_markets({ query: "US election" })` to find relevant markets
2. **Inspect** — `get_market({ condition_id: "..." })` to see token IDs, outcomes, and fees
3. **Analyze** — `get_orderbook({ token_id: "..." })` and `get_price({ token_id: "..." })` for price data
4. **Check Balance** — `get_balance()` to verify available USDC
5. **Trade** — `create_order({ token_id, side: "BUY", price: 0.65, size: 100 })` to place a limit order
6. **Monitor** — `get_open_orders()` and `get_order({ order_id: "..." })` to track order status

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
