import { Hono } from 'hono';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthEnv } from '../auth/middleware';
import { requirePermission } from '../auth/middleware';
import { kgSearchNodesTool, kgGetNodeTool, kgNeighborsTool, kgPathTool, kgSubgraphTool, kgToChunkTool } from '../kg/tools';
import { ingestKgData } from '../kg/ingest';
import { logger } from '../utils/logger';
import { config } from '../config';

const app = new Hono<AuthEnv>();

app.use('*', requirePermission('kg:view'));

/** 统一包装：捕获 Neo4j 不可用等异常，返回结构化 JSON 而不是 Hono 默认的 "Internal Server Error" */
function kgRoute(handler: () => Promise<Response>): Promise<Response> {
  return handler().catch((e: unknown) => {
    const err = e as { code?: string; message?: string };
    const msg = err.message ?? String(e);
    logger.warn('[kg] route error', { code: err.code, msg });
    // Neo4j 没启 / 连不上 / driver 错误
    if (err.code === 'ServiceUnavailable' || /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection/i.test(msg)) {
      return Response.json(
        { error: 'kg_unavailable', detail: 'Neo4j is not reachable. Start it with `docker compose up -d neo4j` and check NEO4J_URL/PASSWORD in .env' },
        { status: 503 },
      );
    }
    return Response.json({ error: 'kg_internal', detail: msg }, { status: 500 });
  });
}

// ===== POST /kg/search =====
app.post('/search', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled (KG_ENABLED=false)' }, 503);
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    keyword: z.string().min(1).max(200),
    type: z.enum(['Flow', 'Law', 'Evidence', 'Case']).optional(),
    category: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid params', detail: parsed.error.issues }, 400);
  const result = await kgSearchNodesTool.execute(parsed.data, { datasetId: '' });
  return c.json(result);
}));

// ===== GET /kg/nodes/:id =====
app.get('/nodes/:id', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const id = c.req.param('id');
  const result = await kgGetNodeTool.execute({ id }, { datasetId: '' });
  if (!result.node) return c.json({ error: 'Node not found', id }, 404);
  return c.json(result);
}));

// ===== GET /kg/nodes/:id/neighbors =====
app.get('/nodes/:id/neighbors', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const id = c.req.param('id');
  const parsed = z.object({
    edgeType: z.string().optional(),
    direction: z.enum(['out', 'in', 'both']).default('out'),
    solid: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }).safeParse({
    edgeType: c.req.query('edgeType'),
    direction: c.req.query('direction') ?? 'out',
    solid: c.req.query('solid'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) return c.json({ error: 'Invalid params', detail: parsed.error.issues }, 400);
  const { edgeType, direction, solid, limit } = parsed.data;
  const result = await kgNeighborsTool.execute(
    { id, edgeType, direction, solid: solid === undefined ? undefined : solid === 'true', limit },
    { datasetId: '' },
  );
  return c.json(result);
}));

// ===== POST /kg/path =====
app.post('/path', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
    maxDepth: z.number().int().min(1).max(10).default(5),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid params', detail: parsed.error.issues }, 400);
  const result = await kgPathTool.execute(parsed.data, { datasetId: '' });
  return c.json(result);
}));

// ===== POST /kg/subgraph =====
app.post('/subgraph', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    rootIds: z.array(z.string().min(1)).min(0).max(10),
    depth: z.number().int().min(1).max(3).default(2),
    category: z.string().optional(),
    full: z.boolean().optional(),
  }).refine(
    d => d.full === true || d.rootIds.length >= 1,
    { message: 'rootIds required when full is not set' },
  ).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid params', detail: parsed.error.issues }, 400);
  const result = await kgSubgraphTool.execute(parsed.data, { datasetId: '' });
  return c.json(result);
}));

// ===== GET /kg/nodes/:id/chunk =====
app.get('/nodes/:id/chunk', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const id = c.req.param('id');
  const result = await kgToChunkTool.execute({ nodeId: id }, { datasetId: '' });
  return c.json(result);
}));

// ===== GET /kg/stats =====
app.get('/stats', (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const { withSession } = await import('../kg/client');
  const result = await withSession(async (session) => {
    const r = await session.run(`
      MATCH (n)
      RETURN labels(n)[0] AS type, n.category AS category, count(n) AS cnt
      ORDER BY type, category
    `);
    const rows = r.records.map((rec) => ({
      type: rec.get('type'),
      category: rec.get('category'),
      count: Number(rec.get('cnt')),
    }));
    const total = rows.reduce((s, r) => s + r.count, 0);
    return { total, byType: rows };
  });
  return c.json(result);
}));

// ===== POST /kg/ingest =====
app.post('/ingest', requirePermission('settings:manage'), (c) => kgRoute(async () => {
  if (!config.kgEnabled) return c.json({ error: 'Knowledge graph is disabled' }, 503);
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    data: z.any().optional(),
    filePath: z.string().optional(),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid params' }, 400);

  try {
    if (parsed.data.data) {
      const tmpPath = path.join('/tmp', `kg-${Date.now()}.json`);
      await import('node:fs/promises').then((fs) => fs.writeFile(tmpPath, JSON.stringify(parsed.data.data)));
      await ingestKgData(tmpPath);
      return c.json({ ok: true, source: 'inline' });
    }
    if (parsed.data.filePath) {
      await ingestKgData(parsed.data.filePath);
      return c.json({ ok: true, source: parsed.data.filePath });
    }
    const defaultPath = path.resolve(process.cwd(), './data/kg-data.json');
    try {
      await readFile(defaultPath, 'utf-8');
    } catch {
      return c.json({ error: 'No data provided and default kg-data.json not found', expected: defaultPath }, 400);
    }
    await ingestKgData(defaultPath);
    return c.json({ ok: true, source: defaultPath });
  } catch (e) {
    logger.error('kg ingest failed', { err: (e as Error).message });
    return c.json({ error: 'Ingest failed', detail: (e as Error).message }, 500);
  }
}));

export default app;