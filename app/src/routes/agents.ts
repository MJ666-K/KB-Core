import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '../auth/middleware';
import { requireAnyPermission, getAuthUser } from '../auth/middleware';
import { db } from '../db/client';
import { agents, models } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getSubAgentRegistry } from '../agent/sub-agent-registry';
import { resolveAgentAccess, agentVisibleToUser, isSuperadminUser, hasAccessLevel } from '../auth/access';

const app = new Hono<AuthEnv>();

// 智能体功能：agents:manage（管理任意，管理员）或 datasets:read（owner 建自己的私有智能体）
const canUseAgents = requireAnyPermission('agents:manage', 'datasets:read');

const agentSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  modelId: z.string().uuid(),
  datasetIds: z.array(z.string().uuid()),
  skillNames: z.array(z.string()).optional().default([]),
  personality: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  visibility: z.enum(['private', 'shared', 'public']).optional(),
});

/** 加载智能体并做行级校验；返回 {agent} 或 {response} */
async function loadAgentForAccess(c: Context<AuthEnv>, id: string, required: 'read' | 'manage') {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, id) });
  if (!agent) return { response: c.json({ error: 'Agent not found' }, 404) };
  const user = getAuthUser(c);
  const access = resolveAgentAccess(agent, user.id, isSuperadminUser(user.role));
  if (!hasAccessLevel(access, required)) {
    return { response: c.json({ error: 'Forbidden', detail: `需要 ${required} 权限` }, 403) };
  }
  return { agent };
}

/** 列出用户可见的智能体（owner 自己的 + public；超管全部） */
app.get('/', canUseAgents, async (c) => {
  const user = getAuthUser(c);
  const sup = isSuperadminUser(user.role);
  const allAgents = await db.select({
    id: agents.id, name: agents.name, displayName: agents.displayName, description: agents.description,
    modelId: agents.modelId,
    model: { name: models.name, displayName: models.displayName, provider: models.provider, modelId: models.modelId },
    datasetIds: agents.datasetIds, skillNames: agents.skillNames,
    enabled: agents.enabled, ownerId: agents.ownerId, visibility: agents.visibility,
  }).from(agents).innerJoin(models, eq(agents.modelId, models.id));
  const visible = sup ? allAgents : allAgents.filter(a => agentVisibleToUser(a, user.id, sup));
  return c.json({ agents: visible });
});

/** 详情（需 read 及以上） */
app.get('/:id', canUseAgents, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadAgentForAccess(c, id, 'read');
  if ('response' in loaded) return loaded.response;
  const rows = await db.select({
    id: agents.id, name: agents.name, displayName: agents.displayName, description: agents.description,
    modelId: agents.modelId, model: models, datasetIds: agents.datasetIds, skillNames: agents.skillNames,
    personality: agents.personality, enabled: agents.enabled, ownerId: agents.ownerId, visibility: agents.visibility,
  }).from(agents).innerJoin(models, eq(agents.modelId, models.id)).where(eq(agents.id, id));
  if (rows.length === 0) return c.json({ error: 'Agent not found' }, 404);
  return c.json({ agent: rows[0] });
});

/** 创建（ownerId = 当前用户，visibility 默认 private） */
app.post('/', canUseAgents, async (c) => {
  const body = await c.req.json();
  const parsed = agentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);
  const user = getAuthUser(c);
  try {
    const [row] = await db.insert(agents).values({
      ...parsed.data,
      ownerId: user.id,
      visibility: parsed.data.visibility ?? 'private',
    }).returning();
    await getSubAgentRegistry().reload();
    return c.json({ agent: row }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return c.json({ error: 'Agent name already exists for this owner' }, 409);
    }
    throw err;
  }
});

/** 更新（需 manage） */
app.put('/:id', canUseAgents, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadAgentForAccess(c, id, 'manage');
  if ('response' in loaded) return loaded.response;
  const body = await c.req.json();
  const parsed = agentSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', detail: parsed.error.issues }, 400);
  const { visibility, ...rest } = parsed.data;
  const updated = await db.update(agents)
    .set({ ...rest, ...(visibility !== undefined && { visibility }), updatedAt: new Date() })
    .where(eq(agents.id, id)).returning();
  if (updated.length === 0) return c.json({ error: 'Agent not found' }, 404);
  await getSubAgentRegistry().reload();
  return c.json({ agent: updated[0] });
});

/** 删除（需 manage；防删最后一个 enabled） */
app.delete('/:id', canUseAgents, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const loaded = await loadAgentForAccess(c, id, 'manage');
  if ('response' in loaded) return loaded.response;
  const enabledCount = await db.select({ c: agents.id }).from(agents).where(eq(agents.enabled, true));
  if (enabledCount.length <= 1) {
    return c.json({ error: 'Cannot delete the last enabled agent' }, 400);
  }
  const deleted = await db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id });
  if (deleted.length === 0) return c.json({ error: 'Agent not found' }, 404);
  await getSubAgentRegistry().reload();
  return c.json({ ok: true });
});

export default app;
