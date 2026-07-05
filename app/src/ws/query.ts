import { z } from 'zod';
import type { ServerWebSocket } from 'bun';
import { db } from '../db/client';
import { datasets } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { Message } from '../llm/llm-service';
import { getAgent } from '../agent/registry';
import type { EventStream } from '../agent/types';
import { logger } from '../utils/logger';
import { getLastRetrievalDetails } from '../tools/search-knowledge';

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
  open(_ws: ServerWebSocket<WsData>): void { /* ready */ },

  async message(ws: ServerWebSocket<WsData>, message: string | Buffer): Promise<void> {
    const queryId = Math.random().toString(36).slice(2, 10);
    const startTime = Date.now();
    logger.info(`[WS:${queryId}] 收到查询请求`);

    const agent = getAgent();
    if (!agent) {
      logger.error(`[WS:${queryId}] Agent 未初始化，拒绝请求`);
      send(ws, { type: 'error', error: 'Agent not initialized' });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(typeof message === 'string' ? message : message.toString());
    } catch {
      logger.error(`[WS:${queryId}] 请求解析失败: ${typeof message === 'string' ? message.slice(0, 200) : 'Buffer'}`);
      send(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    const parsed = queryMessageSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(`[WS:${queryId}] 请求验证失败: ${JSON.stringify(parsed.error.issues)}`);
      send(ws, { type: 'error', error: 'Invalid message', detail: parsed.error.issues });
      return;
    }

    const body = parsed.data;
    const datasetId = await resolveDatasetId(body.datasetId);
    if (!datasetId) {
      logger.error(`[WS:${queryId}] 找不到 dataset: ${body.datasetId ?? 'default'}`);
      send(ws, { type: 'error', error: 'Default dataset not found' });
      return;
    }

    logger.info(`[WS:${queryId}] 开始处理查询`, {
      question: body.question.slice(0, 100),
      datasetId: datasetId.slice(0, 8),
      historyLen: (body.options?.history ?? []).length,
      topK: body.options?.topK,
      maxIterations: body.options?.maxIterations,
    });

    try {
      const history = body.options?.history as Message[] | undefined;

      const wsEvents: EventStream = {
        emit(event) {
          switch (event.type) {
            case 'thinking_start':
              send(ws, { type: 'thinking', subAgent: event.subAgent });
              break;
            case 'thinking_token':
              send(ws, { type: 'thinking', token: event.token, subAgent: event.subAgent });
              break;
            case 'thinking_end':
              send(ws, { type: 'thinking_end', subAgent: event.subAgent });
              break;
            case 'tool_call_start':
              send(ws, { type: 'step', action: event.name, kind: event.kind, subAgent: event.subAgent });
              break;
            case 'tool_call_end':
              send(ws, { type: 'step_end', action: event.name, summary: event.summary, subAgent: event.subAgent });
              if (event.name === 'search_knowledge') {
                const details = getLastRetrievalDetails();
                if (details && details.results.length > 0) {
                  send(ws, {
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
              send(ws, {
                type: 'retrieval_results',
                name: event.name,
                results: event.results,
              });
              break;
            case 'answer_start':
              send(ws, { type: 'answer_start' });
              break;
            case 'answer_token':
              send(ws, { type: 'token', token: event.token });
              break;
            case 'answer_end':
              send(ws, { type: 'answer_end' });
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

      const elapsed = Date.now() - startTime;
      logger.info(`[WS:${queryId}] 查询完成`, {
        elapsed: `${elapsed}ms`,
        termination: result.termination,
        citations: result.citations.length,
        answerLen: result.answer.length,
        toolCalls: result.toolCalls.map(tc => tc.name).join(',') || '(none)',
        iterations: result.steps.length,
      });
      send(ws, { type: 'result', ...result });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      logger.error(`[WS:${queryId}] 查询失败 (${elapsed}ms)`, err);
      send(ws, {
        type: 'error',
        error: 'Query failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  },

  close(_ws: ServerWebSocket<WsData>): void { /* noop */ },
};

export const WS_QUERY_PATH = '/ws/query';
