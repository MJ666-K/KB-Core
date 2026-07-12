import { z } from 'zod';
import type { ServerWebSocket } from 'bun';
import { db } from '../db/client';
import { chatSessions, datasets } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import type { Message } from '../llm/llm-service';
import { getAgent } from '../agent/registry';
import type { EventStream } from '../agent/types';
import { logger } from '../utils/logger';
import { getLastRetrievalDetails } from '../tools/search-knowledge';
import { resolveBearerToken } from '../auth/service';
import { hasPermission } from '../auth/permission-registry';
import {
  createQueryJob,
  appendQueryJobEvent,
  completeQueryJob,
  failQueryJob,
  getQueryJob,
  clearSessionActiveJob,
} from '../auth/query-job-store';

const queryMessageSchema = z.object({
  type: z.literal('query'),
  question: z.string().min(1).max(2000),
  sessionId: z.string().uuid(),
  datasetId: z.string().uuid().optional(),
  options: z.object({
    topK: z.number().int().min(1).max(50).optional(),
    maxIterations: z.number().int().min(1).max(10).optional(),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).max(20).optional(),
  }).optional(),
});

const resumeMessageSchema = z.object({
  type: z.literal('resume'),
  jobId: z.string().min(1),
  sessionId: z.string().uuid(),
  since: z.number().int().min(0).optional(),
});

const authMessageSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1),
});

type WsData = { userId: string; authenticated: boolean };

let cachedDefaultDatasetId: string | null = null;

async function resolveDatasetId(datasetId?: string): Promise<string | null> {
  if (datasetId) return datasetId;
  if (!cachedDefaultDatasetId) {
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.name, 'default') });
    if (!ds) return null;
    cachedDefaultDatasetId = ds.id;
  }
  return cachedDefaultDatasetId;
}

function send(ws: ServerWebSocket<WsData>, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

async function assertSessionOwner(sessionId: string, userId: string): Promise<boolean> {
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
  });
  return !!session;
}

export const queryWebSocket = {
  open(ws: ServerWebSocket<WsData>): void {
    ws.data = { userId: '', authenticated: false };
  },

  async message(ws: ServerWebSocket<WsData>, message: string | Buffer): Promise<void> {
    const queryId = Math.random().toString(36).slice(2, 10);
    let raw: unknown;
    try {
      raw = JSON.parse(typeof message === 'string' ? message : message.toString());
    } catch {
      send(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    const msgType = typeof raw === 'object' && raw !== null && 'type' in raw
      ? String((raw as { type: string }).type)
      : '';

    if (msgType === 'auth') {
      const parsed = authMessageSchema.safeParse(raw);
      if (!parsed.success) {
        send(ws, { type: 'error', error: 'Invalid auth message' });
        return;
      }
      const user = await resolveBearerToken(parsed.data.token);
      if (!user) {
        send(ws, { type: 'error', error: 'Unauthorized' });
        ws.close();
        return;
      }
      if (!hasPermission(user.permissions, 'chat:use')) {
        send(ws, { type: 'error', error: 'Forbidden', detail: '权限不足' });
        ws.close();
        return;
      }
      ws.data = { userId: user.id, authenticated: true };
      send(ws, { type: 'auth_ok', user: { id: user.id, username: user.username, role: user.role } });
      return;
    }

    if (!ws.data?.authenticated) {
      send(ws, { type: 'error', error: 'Not authenticated' });
      return;
    }

    if (msgType === 'resume') {
      const parsed = resumeMessageSchema.safeParse(raw);
      if (!parsed.success) {
        send(ws, { type: 'error', error: 'Invalid resume message' });
        return;
      }
      const job = await getQueryJob(parsed.data.jobId);
      if (!job || job.userId !== ws.data.userId || job.sessionId !== parsed.data.sessionId) {
        send(ws, { type: 'error', error: 'Job not found' });
        return;
      }
      const since = parsed.data.since ?? 0;
      for (const ev of job.events.slice(since)) {
        send(ws, ev);
      }
      if (job.status === 'completed' && job.result) {
        send(ws, job.result);
      } else if (job.status === 'failed') {
        send(ws, { type: 'error', error: job.error ?? 'Query failed' });
      } else {
        send(ws, { type: 'resume_ok', jobId: job.id, status: job.status, eventCount: job.events.length });
      }
      return;
    }

    const parsed = queryMessageSchema.safeParse(raw);
    if (!parsed.success) {
      send(ws, { type: 'error', error: 'Invalid message', detail: parsed.error.issues });
      return;
    }

    const body = parsed.data;
    if (!await assertSessionOwner(body.sessionId, ws.data.userId)) {
      send(ws, { type: 'error', error: 'Session not found' });
      return;
    }

    const agent = getAgent();
    if (!agent) {
      send(ws, { type: 'error', error: 'Agent not initialized' });
      return;
    }

    const datasetId = await resolveDatasetId(body.datasetId);
    if (!datasetId) {
      send(ws, { type: 'error', error: 'Default dataset not found' });
      return;
    }

    const jobId = await createQueryJob({
      userId: ws.data.userId,
      sessionId: body.sessionId,
      question: body.question,
    });

    send(ws, { type: 'job_started', jobId, sessionId: body.sessionId });

    const startTime = Date.now();
    logger.info(`[WS:${queryId}] 开始处理查询`, { jobId, sessionId: body.sessionId.slice(0, 8) });

    const recordEvent = (payload: Record<string, unknown>) => {
      send(ws, payload);
      void appendQueryJobEvent(jobId, payload);
    };

    try {
      const history = body.options?.history as Message[] | undefined;

      const wsEvents: EventStream = {
        emit(event) {
          switch (event.type) {
            case 'thinking_start':
              recordEvent({ type: 'thinking_start', subAgent: event.subAgent });
              break;
            case 'thinking_token':
              recordEvent({ type: 'thinking', token: event.token, subAgent: event.subAgent });
              break;
            case 'thinking_end':
              recordEvent({ type: 'thinking_end', subAgent: event.subAgent });
              break;
            case 'tool_call_start':
              recordEvent({ type: 'step', action: event.name, kind: event.kind, subAgent: event.subAgent });
              break;
            case 'tool_call_end':
              recordEvent({ type: 'step_end', action: event.name, summary: event.summary, subAgent: event.subAgent });
              if (event.name === 'search_knowledge') {
                const details = getLastRetrievalDetails();
                if (details && details.results.length > 0) {
                  recordEvent({
                    type: 'retrieval_results',
                    results: details.results.map(r => ({
                      chunkId: r.chunkId,
                      text: r.text.slice(0, 500),
                      score: r.score,
                      documentTitle: r.documentTitle,
                    })),
                    action: 'search_knowledge',
                  });
                }
              }
              break;
            case 'retrieval_results':
              recordEvent({ type: 'retrieval_results', name: event.name, results: event.results });
              break;
            case 'answer_start':
              recordEvent({ type: 'answer_start' });
              break;
            case 'answer_token':
              recordEvent({ type: 'token', token: event.token });
              break;
            case 'answer_end':
              recordEvent({ type: 'answer_end' });
              break;
            case 'follow_up':
              recordEvent({ type: 'follow_up', questions: event.questions });
              break;
            case 'result_end':
              break;
          }
        },
      };

      const result = await agent.execute(body.question, {
        datasetId,
        topK: body.options?.topK,
        maxIterations: body.options?.maxIterations,
        history,
      }, wsEvents);

      const resultPayload: Record<string, unknown> = { type: 'result', jobId, ...result };
      recordEvent(resultPayload);
      await completeQueryJob(jobId, resultPayload);
      await clearSessionActiveJob(body.sessionId);

      logger.info(`[WS:${queryId}] 查询完成`, {
        jobId,
        elapsed: `${Date.now() - startTime}ms`,
        answerLen: result.answer.length,
      });

      void agent.generateFollowUpSuggestions(body.question, result, {
        datasetId,
        topK: body.options?.topK,
        maxIterations: body.options?.maxIterations,
        history,
      }).then(questions => {
        if (questions.length > 0) {
          recordEvent({ type: 'follow_up', questions });
        }
      }).catch(err => {
        logger.warn(`[WS:${queryId}] follow-up failed`, err);
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await failQueryJob(jobId, detail);
      recordEvent({ type: 'error', error: 'Query failed', detail });
      logger.error(`[WS:${queryId}] 查询失败`, err);
    }
  },

  close(_ws: ServerWebSocket<WsData>): void { /* noop */ },
};

export const WS_QUERY_PATH = '/ws/query';
