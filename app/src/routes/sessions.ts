import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { chatMessages, chatSessions } from '../db/schema';
import { asc, desc, eq, sql, and } from 'drizzle-orm';
import type { Citation } from '../db/schema/query-log';
import type { ChatMessageMeta } from '../db/schema/chat-session';
import type { AuthEnv } from '../auth/middleware';
import { getAuthUser, requirePermission } from '../auth/middleware';

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('chat:use'));

const SESSION_TITLE_MAX = 18;

function titleFromQuestion(question: string): string {
  const t = question.trim().replace(/\s+/g, ' ');
  if (!t) return '新会话';
  if (t.length <= SESSION_TITLE_MAX) return t;
  return `${t.slice(0, SESSION_TITLE_MAX)}…`;
}

const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  question: z.string().min(1).max(2000).optional(),
}).refine(d => d.title || d.question, { message: 'title or question required' });

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(z.record(z.string(), z.unknown())).optional(),
  meta: z.object({
    latencyMs: z.number().optional(),
    termination: z.string().optional(),
    toolCalls: z.array(z.object({
      name: z.string(),
      kind: z.string(),
    })).optional(),
    followUpQuestions: z.array(z.string()).optional(),
    queryJobId: z.string().optional(),
  }).optional(),
});

const patchMessageSchema = z.object({
  content: z.string().optional(),
  citations: z.array(z.record(z.string(), z.unknown())).optional(),
  meta: z.object({
    latencyMs: z.number().optional(),
    termination: z.string().optional(),
    toolCalls: z.array(z.object({
      name: z.string(),
      kind: z.string(),
    })).optional(),
    followUpQuestions: z.array(z.string()).optional(),
    queryJobId: z.string().optional(),
  }).partial().optional(),
});

app.get('/', async (c) => {
  const user = getAuthUser(c);
  const rows = await db.select({
    id: chatSessions.id,
    title: chatSessions.title,
    createdAt: chatSessions.createdAt,
    updatedAt: chatSessions.updatedAt,
  })
    .from(chatSessions)
    .where(eq(chatSessions.userId, user.id))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(200);

  return c.json({ sessions: rows });
});

app.post('/', async (c) => {
  const user = getAuthUser(c);
  const body = createSessionSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ error: 'Invalid body', detail: body.error.issues }, 400);
  }

  const title = body.data.title ?? titleFromQuestion(body.data.question ?? '');
  const [session] = await db.insert(chatSessions).values({ title, userId: user.id }).returning();
  return c.json({ session });
});

app.get('/:id', async (c) => {
  const user = getAuthUser(c);
  const id = c.req.param('id');
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, user.id)),
  });
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const messages = await db.select({
    id: chatMessages.id,
    role: chatMessages.role,
    content: chatMessages.content,
    citations: chatMessages.citations,
    meta: chatMessages.meta,
    sortOrder: chatMessages.sortOrder,
    createdAt: chatMessages.createdAt,
  })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, id))
    .orderBy(asc(chatMessages.sortOrder));

  return c.json({ session, messages });
});

app.post('/:id/messages', async (c) => {
  const user = getAuthUser(c);
  const id = c.req.param('id');
  const parsed = messageSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid message', detail: parsed.error.issues }, 400);
  }

  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, user.id)),
  });
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const orderRow = await db.select({
    maxOrder: sql<number>`coalesce(max(${chatMessages.sortOrder}), -1)`,
  })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, id));

  const nextOrder = (orderRow[0]?.maxOrder ?? -1) + 1;
  const data = parsed.data;

  const [message] = await db.insert(chatMessages).values({
    sessionId: id,
    role: data.role,
    content: data.content,
    citations: (data.citations ?? []) as unknown as Citation[],
    meta: (data.meta ?? {}) as ChatMessageMeta,
    sortOrder: nextOrder,
  }).returning();

  await db.update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, id));

  return c.json({ message });
});

app.patch('/:id/messages/:messageId', async (c) => {
  const user = getAuthUser(c);
  const sessionId = c.req.param('id');
  const messageId = c.req.param('messageId');
  const parsed = patchMessageSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid message patch', detail: parsed.error.issues }, 400);
  }

  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, user.id)),
  });
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const existing = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
  });
  if (!existing || existing.sessionId !== sessionId) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const patch = parsed.data;
  const mergedMeta: ChatMessageMeta = {
    ...(existing.meta ?? {}),
    ...(patch.meta ?? {}),
  };

  const [message] = await db.update(chatMessages)
    .set({
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.citations !== undefined ? { citations: patch.citations as unknown as Citation[] } : {}),
      ...(patch.meta !== undefined ? { meta: mergedMeta } : {}),
    })
    .where(eq(chatMessages.id, messageId))
    .returning();

  await db.update(chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  return c.json({ message });
});

app.delete('/:id', async (c) => {
  const user = getAuthUser(c);
  const id = c.req.param('id');
  const deleted = await db.delete(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, user.id)))
    .returning({ id: chatSessions.id });
  if (deleted.length === 0) return c.json({ error: 'Session not found' }, 404);
  return c.json({ ok: true });
});

export default app;
