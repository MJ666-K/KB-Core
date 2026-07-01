import { Hono } from 'hono';
import { config } from './config';
import { db } from './db/client';
import { datasets } from './db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './utils/logger';

import ingestRoutes from './routes/ingest';
import { setAgent } from './agent/registry';
import { queryWebSocket, WS_QUERY_PATH } from './ws/query';

import { EmbeddingService } from './embedding/embedding-service';
import { HybridRetriever } from './retrieve/retriever';
import { LLMService } from './llm/llm-service';
import { createToolRegistry } from './tools';
import { createSkillRegistry } from './skills';
import { createHookRegistry } from './hooks';
import { QueryAgent } from './agent/query-agent';
import { startWorker } from './pipeline/queue';

const app = new Hono();

app.route('/', ingestRoutes);
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

async function main(): Promise<void> {
  let defaultDataset = await db.query.datasets.findFirst({ where: eq(datasets.name, 'default') });
  if (!defaultDataset) {
    [defaultDataset] = await db.insert(datasets).values({ name: 'default' }).returning();
  }

  const embeddingService = new EmbeddingService();
  const retriever = new HybridRetriever(embeddingService);
  const llm = new LLMService();
  const toolRegistry = createToolRegistry(retriever, llm);
  const skillRegistry = await createSkillRegistry('./src/skills');
  const hookRegistry = createHookRegistry();
  const agent = new QueryAgent(llm, skillRegistry, toolRegistry, hookRegistry);

  setAgent(agent);
  startWorker();

  Bun.serve({
    port: config.appPort,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === WS_QUERY_PATH) {
        if (server.upgrade(req, { data: {} })) return undefined;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return app.fetch(req, server);
    },
    websocket: queryWebSocket,
  });

  logger.info(`🚀 Server running at http://localhost:${config.appPort}`);
  logger.info(`📋 Health check: http://localhost:${config.appPort}/health`);
  logger.info(`💬 Query WebSocket: ws://localhost:${config.appPort}${WS_QUERY_PATH}`);
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
