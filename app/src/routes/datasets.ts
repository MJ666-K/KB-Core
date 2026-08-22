import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import type { AuthEnv } from '../auth/middleware';
import { requireAnyPermission, getAuthUser } from '../auth/middleware';
import { db } from '../db/client';
import { datasets, datasetMembers } from '../db/schema';
import {
  resolveDatasetAccess, accessibleDatasetIds, canManageAllDatasets, hasAccessLevel,
} from '../auth/access';

const app = new Hono<AuthEnv>();

// 列库：兼容 datasets:read 与现有 documents:read 等持有者
const canListDatasets = requireAnyPermission(
  'datasets:read', 'documents:read', 'documents:write', 'agents:manage', 'settings:manage',
);
// 库 CRUD/成员：需 datasets:read 或 datasets:manage（owner 对自己库天然 manage，由行级校验把关）
const canUseDatasets = requireAnyPermission('datasets:read', 'datasets:manage');

const nameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9\u4e00-\u9fff_-]+$/);
const visibilitySchema = z.enum(['private', 'shared', 'public']);

const chunkConfigSchema = z.object({
  parentTokens: z.number().int().positive().max(8000).optional(),
  childTokens: z.number().int().positive().max(2000).optional(),
  overlapTokens: z.number().nonnegative().max(500).optional(),
}).optional();

const retrieveConfigSchema = z.object({
  searchTopK: z.number().int().positive().max(100).optional(),
  denseTopKMultiplier: z.number().int().positive().max(20).optional(),
  rrfK: z.number().int().positive().max(200).optional(),
  rerankTopK: z.number().int().positive().max(100).optional(),
  denseMinSimilarity: z.number().min(0).max(1).optional(),
  rerankMinScore: z.number().min(0).max(1).optional(),
}).optional();

const createSchema = z.object({
  name: nameSchema,
  description: z.string().max(500).optional(),
  visibility: visibilitySchema.optional(),
  kind: z.enum(['document', 'kg']).optional(),
  chunkConfig: chunkConfigSchema,
  retrieveConfig: retrieveConfigSchema,
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  visibility: visibilitySchema.optional(),
  chunkConfig: chunkConfigSchema.nullable(),
  retrieveConfig: retrieveConfigSchema.nullable(),
});

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['viewer', 'editor', 'manager']),
});

/** 解析 :id 并校验存在；返回库行与访问级别，未授权返回 Response */
async function loadDatasetFor(c: Context<AuthEnv>, required: 'read' | 'manage') {
  const id = c.req.param('id');
  if (!id) return { response: c.json({ error: 'Invalid id' }, 400) };
  const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, id) });
  if (!ds) return { response: c.json({ error: 'Dataset not found' }, 404) };
  const user = getAuthUser(c);
  const access = await resolveDatasetAccess(ds, user.id, canManageAllDatasets(user.role, user.permissions));
  if (!hasAccessLevel(access, required)) {
    return { response: c.json({ error: 'Forbidden', detail: `需要 ${required} 权限` }, 403) };
  }
  return { ds, access };
}

/** 列出用户可访问的库（owner 自己的 + shared 成员 + public；超管全部） */
app.get('/', canListDatasets, async (c) => {
  const user = getAuthUser(c);
  const sup = canManageAllDatasets(user.role, user.permissions);
  let rows;
  if (sup) {
    rows = await db.select().from(datasets);
  } else {
    const ids = await accessibleDatasetIds(user.id, sup);
    rows = ids.length > 0
      ? await db.select().from(datasets).where(inArray(datasets.id, ids))
      : [];
  }
  return c.json({ datasets: rows });
});

/** 详情（需 read 及以上） */
app.get('/:id', canListDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'read');
  if ('response' in loaded) return loaded.response;
  return c.json({ dataset: loaded.ds, access: loaded.access });
});

/** 创建（ownerId = 当前用户，visibility 默认 private） */
app.post('/', canUseDatasets, async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);
  const user = getAuthUser(c);
  try {
    const [row] = await db.insert(datasets).values({
      name: parsed.data.name,
      description: parsed.data.description,
      visibility: parsed.data.visibility ?? 'private',
      kind: parsed.data.kind ?? 'document',
      chunkConfig: parsed.data.chunkConfig,
      retrieveConfig: parsed.data.retrieveConfig,
      ownerId: user.id,
    }).returning();
    return c.json({ dataset: row }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Dataset name already exists for this owner' }, 409);
    }
    throw err;
  }
});

/** 更新（需 manage） */
app.put('/:id', canUseDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'manage');
  if ('response' in loaded) return loaded.response;
  const body = await c.req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);
  const { name, description, visibility, chunkConfig, retrieveConfig } = parsed.data;
  const id = loaded.ds.id;
  try {
    const [row] = await db.update(datasets).set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description: description ?? null }),
      ...(visibility !== undefined && { visibility }),
      ...(chunkConfig !== undefined && { chunkConfig: chunkConfig ?? null }),
      ...(retrieveConfig !== undefined && { retrieveConfig: retrieveConfig ?? null }),
      updatedAt: new Date(),
    }).where(eq(datasets.id, id)).returning();
    return c.json({ dataset: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Dataset name already exists for this owner' }, 409);
    }
    throw err;
  }
});

/** 删除（需 manage；FK 级联删 documents/chunks/members） */
app.delete('/:id', canUseDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'manage');
  if ('response' in loaded) return loaded.response;
  await db.delete(datasets).where(eq(datasets.id, loaded.ds.id));
  return c.json({ ok: true });
});

// ===== 成员管理（shared 库 ACL，需 manage） =====

app.get('/:id/members', canUseDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'manage');
  if ('response' in loaded) return loaded.response;
  const members = await db.select().from(datasetMembers).where(eq(datasetMembers.datasetId, loaded.ds.id));
  return c.json({ members });
});

app.post('/:id/members', canUseDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'manage');
  if ('response' in loaded) return loaded.response;
  const body = await c.req.json();
  const parsed = memberSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);
  const user = getAuthUser(c);
  try {
    await db.insert(datasetMembers).values({
      datasetId: loaded.ds.id, userId: parsed.data.userId, role: parsed.data.role, grantedBy: user.id,
    }).onConflictDoUpdate({
      target: [datasetMembers.datasetId, datasetMembers.userId],
      set: { role: parsed.data.role, grantedBy: user.id },
    });
    return c.json({ ok: true }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('foreign') || msg.includes('violates')) {
      return c.json({ error: 'User not found' }, 404);
    }
    throw err;
  }
});

app.put('/:id/members/:userId', canUseDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'manage');
  if ('response' in loaded) return loaded.response;
  const userIdParam = c.req.param('userId');
  if (!userIdParam) return c.json({ error: 'Invalid userId' }, 400);
  const body = await c.req.json();
  const roleParsed = z.enum(['viewer', 'editor', 'manager']).safeParse(body.role);
  if (!roleParsed.success) return c.json({ error: 'Invalid role' }, 400);
  const [row] = await db.update(datasetMembers).set({ role: roleParsed.data })
    .where(and(eq(datasetMembers.datasetId, loaded.ds.id), eq(datasetMembers.userId, userIdParam))).returning();
  if (!row) return c.json({ error: 'Member not found' }, 404);
  return c.json({ ok: true });
});

app.delete('/:id/members/:userId', canUseDatasets, async (c) => {
  const loaded = await loadDatasetFor(c, 'manage');
  if ('response' in loaded) return loaded.response;
  const userIdParam = c.req.param('userId');
  if (!userIdParam) return c.json({ error: 'Invalid userId' }, 400);
  await db.delete(datasetMembers)
    .where(and(eq(datasetMembers.datasetId, loaded.ds.id), eq(datasetMembers.userId, userIdParam)));
  return c.json({ ok: true });
});

export default app;
