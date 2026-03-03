import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { loadConfig, isReadOnly } from './config';
import { PolymarketClient } from './polymarket/client';
import { createMcpServer } from './server';

async function main(): Promise<void> {
  const config = loadConfig();
  console.error(
    `[polymarket] signatureType=${config.signatureType} funder=${config.funderAddress ?? 'none'}`
  );
  const client = new PolymarketClient(config);

  if (!isReadOnly(config)) {
    try {
      await client.initTrading();
      console.error(
        `[polymarket] Trading mode enabled for wallet ${client.walletAddress}`
      );
    } catch (err) {
      console.error(
        `[polymarket] Failed to initialize trading: ${err instanceof Error ? err.message : err}`
      );
      console.error('[polymarket] Falling back to read-only mode');
    }
  } else {
    console.error('[polymarket] Running in read-only mode (no private key)');
  }

  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const server = createMcpServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: client.isReadOnly ? 'read-only' : 'trading',
      wallet: client.walletAddress,
    });
  });

  const port = config.port;
  app.listen(port, () => {
    console.error(`[polymarket] MCP server listening on port ${port}`);
    console.error(`[polymarket] MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`[polymarket] Health check: http://localhost:${port}/health`);
  });
}

main().catch((err) => {
  console.error('[polymarket] Fatal error:', err);
  process.exit(1);
});
