import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config } from './config';
import { initRuntimeSettings } from './settings/store';
import { runMigrations } from './db/migrate';
import { runBaseSeed } from './db/seed/run';
import { seedKgIfEmpty } from './kg/seed';
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
import { startWorker } from './pipeline/queue';

import { mountApiRoutes } from './routes/index';
import { authMiddleware } from './auth/middleware';
import { connectRedis } from './redis/client';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));
app.use('/ingest', authMiddleware);
app.route('/', ingestRoutes);

async function main(): Promise<void> {
  await runMigrations();
  await runBaseSeed();
  await seedKgIfEmpty();
  await connectRedis();
  await initRuntimeSettings();

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
  const staticRoot = process.env.STATIC_ROOT ?? '../status/dist';
  app.use('/assets/*', serveStatic({ root: staticRoot }));

  app.get('*', async (c) => {
    const path = c.req.path;
    if (path.startsWith('/api/') || path.startsWith('/ingest') || path.startsWith('/ws/') || path === '/health') {
      return c.json({ error: 'Not Found' }, 404);
    }
    const indexFile = Bun.file(`${staticRoot}/index.html`);
    if (await indexFile.exists()) {
      return c.html(await indexFile.text());
    }
    return c.text('Frontend not built. Run: cd status && npm run build', 503);
  });
}
