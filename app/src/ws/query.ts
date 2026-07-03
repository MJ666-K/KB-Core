import { z } from 'zod';
import type { ServerWebSocket } from 'bun';
import { db } from '../db/client';
import { datasets } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { Message } from '../llm/llm-service';
import { getAgent } from '../agent/registry';
import type { EventStream } from '../agent/types';

const queryMessageSchema = z.object({
  type: z.literal('query'),
  question: z.string().min(1).max(2000),
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

type WsData = Record<string, never>;

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

export const queryWebSocket = {
  open(_ws: ServerWebSocket<WsData>): void {
    // ready
  },

  async message(ws: ServerWebSocket<WsData>, message: string | Buffer): Promise<void> {
    const agent = getAgent();
    if (!agent) {
      send(ws, { type: 'error', error: 'Agent not initialized' });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(typeof message === 'string' ? message : message.toString());
    } catch {
      send(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    const parsed = queryMessageSchema.safeParse(raw);
    if (!parsed.success) {
      send(ws, { type: 'error', error: 'Invalid message', detail: parsed.error.issues });
      return;
    }

    const body = parsed.data;
    const datasetId = await resolveDatasetId(body.datasetId);
    if (!datasetId) {
      send(ws, { type: 'error', error: 'Default dataset not found' });
      return;
    }

    try {
      const history = body.options?.history as Message[] | undefined;

      const wsEvents: EventStream = {
        emit(event) {
          switch (event.type) {
            case 'thinking_start': send(ws, { type: 'thinking' }); break;
            case 'thinking_token': send(ws, { type: 'thinking', token: event.token }); break;
            case 'thinking_end': send(ws, { type: 'thinking_end' }); break;
            case 'tool_call_start': send(ws, { type: 'step', action: event.name, kind: event.kind }); break;
            case 'tool_call_end': send(ws, { type: 'step_end', action: event.name, summary: event.summary }); break;
            case 'answer_start': send(ws, { type: 'answer_start' }); break;
            case 'answer_token': send(ws, { type: 'token', token: event.token }); break;
            case 'answer_end': send(ws, { type: 'answer_end' }); break;
            case 'result_end': break;
          }
        },
      };

      const result = await agent.execute(body.question, {
        datasetId,
        topK: body.options?.topK,
        maxIterations: body.options?.maxIterations,
        history,
      }, wsEvents);
      send(ws, { type: 'result', ...result });
    } catch (err) {
      send(ws, {
        type: 'error',
        error: 'Query failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  },

  close(_ws: ServerWebSocket<WsData>): void {
    // noop
  },
};

export const WS_QUERY_PATH = '/ws/query';
