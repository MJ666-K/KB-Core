import { Hono } from 'hono';
import { config } from './config';
import { db } from './db/client';
import { datasets } from './db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './utils/logger';

import ingestRoutes from './routes/ingest';
import queryRoutes, { setAgent } from './routes/query';
import documentsRoutes from './routes/documents';

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
app.route('/', queryRoutes);
app.route('/', documentsRoutes);
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

  Bun.serve({ port: config.appPort, fetch: app.fetch });

  logger.info(`🚀 Server running at http://localhost:${config.appPort}`);
  logger.info(`📋 Health check: http://localhost:${config.appPort}/health`);
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
