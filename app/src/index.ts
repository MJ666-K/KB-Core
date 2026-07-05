import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { readFile } from 'fs/promises';
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
import { MainAgent } from './agent/main-agent';
import { SubAgentRegistry, setSubAgentRegistry } from './agent/sub-agent-registry';
import { seedSkills, seedAgents } from './db/seed';
import { startWorker } from './pipeline/queue';

import { mountApiRoutes } from './routes/index';

const app = new Hono();

app.route('/', ingestRoutes);
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

async function runManualMigrations(): Promise<void> {
  const migrationFile = new URL('../src/db/migrations/manual_add_agents_and_skills.sql', import.meta.url).pathname;
  let sqlText: string;
  try {
    sqlText = await readFile(migrationFile, 'utf-8');
  } catch {
    logger.warn('[Migration] manual SQL file not found, skipping');
    return;
  }
  try {
    const pgClient = (await import('pg')).default;
    const client = new pgClient.Client({ connectionString: (await import('./config')).config.databaseUrl });
    await client.connect();
    await client.query(sqlText);
    await client.end();
    logger.info('[Migration] manual_add_agents_and_skills applied');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) {
      logger.info('[Migration] manual tables already exist');
    } else {
      logger.error('[Migration] manual_add_agents_and_skills failed', err);
    }
  }
}

async function main(): Promise<void> {
  let defaultDataset = await db.query.datasets.findFirst({ where: eq(datasets.name, 'default') });
  if (!defaultDataset) {
    [defaultDataset] = await db.insert(datasets).values({ name: 'default' }).returning();
  }

  await runManualMigrations();
  await seedSkills();
  await seedAgents();

  const embeddingService = new EmbeddingService();
  const retriever = new HybridRetriever(embeddingService);
  const llm = new LLMService();
  const skillRegistry = await createSkillRegistry();
  const mainToolRegistry = createToolRegistry(retriever, llm, { includeCallAgent: true });
  const subToolRegistry = createToolRegistry(retriever, llm);
  const hookRegistry = createHookRegistry();

  const subRegistry = new SubAgentRegistry();
  subRegistry.setFactory((meta) => {
    const whitelist = meta.skillNames && meta.skillNames.length > 0 ? meta.skillNames : undefined;
    const agentSkillRegistry = whitelist ? new (skillRegistry.constructor as typeof import('./skills/registry').SkillRegistry)() : skillRegistry;
    if (whitelist) {
      for (const name of whitelist) {
        const s = skillRegistry.get(name);
        if (s) agentSkillRegistry.register(s as import('./skills/types').Skill);
      }
    }
    return new QueryAgent(llm, whitelist ? agentSkillRegistry : skillRegistry, subToolRegistry, hookRegistry, meta.model);
  });
  setSubAgentRegistry(subRegistry);
  await subRegistry.reload();

  const mainAgent = new MainAgent(llm, skillRegistry, mainToolRegistry, hookRegistry);
  setAgent(mainAgent as unknown as QueryAgent);
  startWorker();

  mountApiRoutes(app);
  setupStaticServing(app);

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
  logger.info(`🖥 Admin UI: http://localhost:${config.appPort}/`);
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

function setupStaticServing(app: Hono): void {
  app.get('/', serveStatic({ path: '../status/index.html' }));
  app.get('/status/*', serveStatic({ root: '..' }));
}
