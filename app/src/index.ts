import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { readFile } from 'fs/promises';
import { config } from './config';
import { initRuntimeSettings } from './settings/store';
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
import { seedSkills, seedAgents, ensureMissingSkillsFromFiles } from './db/seed';
import { startWorker } from './pipeline/queue';

import { mountApiRoutes } from './routes/index';
import { authMiddleware } from './auth/middleware';
import { connectRedis } from './redis/client';
import { seedSuperAdmin } from './auth/service';
import { seedDefaultRoles } from './auth/role-service';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));
app.use('/ingest', authMiddleware);
app.route('/', ingestRoutes);

async function runManualMigrations(): Promise<void> {
  const files = [
    '../src/db/migrations/manual_add_agents_and_skills.sql',
    '../src/db/migrations/manual_add_tsvector_and_fkeys.sql',
    '../src/db/migrations/manual_add_chat_sessions.sql',
    '../src/db/migrations/manual_add_auth.sql',
    '../src/db/migrations/manual_add_superadmin_role.sql',
    '../src/db/migrations/manual_add_roles.sql',
  ];
  const pgClient = (await import('pg')).default;
  const { config: cfg } = await import('./config');

  for (const rel of files) {
    const migrationFile = new URL(rel, import.meta.url).pathname;
    let sqlText: string;
    try {
      sqlText = await readFile(migrationFile, 'utf-8');
    } catch {
      logger.warn(`[Migration] ${rel} not found, skipping`);
      continue;
    }
    try {
      const client = new pgClient.Client({ connectionString: cfg.databaseUrl });
      await client.connect();
      await client.query(sqlText);
      await client.end();
      logger.info(`[Migration] ${rel} applied`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) {
        logger.info(`[Migration] ${rel} already applied`);
      } else {
        logger.error(`[Migration] ${rel} failed`, err);
      }
    }
  }
}

async function main(): Promise<void> {
  let defaultDataset = await db.query.datasets.findFirst({ where: eq(datasets.name, 'default') });
  if (!defaultDataset) {
    [defaultDataset] = await db.insert(datasets).values({ name: 'default' }).returning();
  }

  await runManualMigrations();
  await connectRedis();
  await initRuntimeSettings();
  await seedDefaultRoles();
  await seedSuperAdmin();
  await seedSkills();
  await ensureMissingSkillsFromFiles();
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
  setAgent(mainAgent);
  startWorker();

  mountApiRoutes(app);
  setupStaticServing(app);

  Bun.serve({
    port: config.appPort,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === WS_QUERY_PATH) {
        if (server.upgrade(req, { data: { userId: '', authenticated: false } })) return undefined;
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
  app.get('/', serveStatic({ path: '../status/dist/index.html' }));
  app.get('/assets/*', serveStatic({ root: '../status/dist' }));
  app.use('/status-legacy/*', serveStatic({ root: '..' }));
}
