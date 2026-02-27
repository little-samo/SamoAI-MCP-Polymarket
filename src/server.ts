import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAccountTools } from './tools/account';
import { registerMarketTools } from './tools/market';
import { registerTradingTools } from './tools/trading';

import type { PolymarketClient } from './polymarket/client';

export function createMcpServer(client: PolymarketClient): McpServer {
  const server = new McpServer({
    name: 'polymarket',
    version: '0.1.0',
  });

  registerMarketTools(server, client);
  registerAccountTools(server, client);
  registerTradingTools(server, client);

  return server;
}
