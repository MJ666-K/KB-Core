import { Hono } from 'hono';
import { z } from 'zod';
import type { QueryAgent } from '../agent/query-agent';
import type { Message } from '../llm/llm-service';

const app = new Hono();

let agentInstance: QueryAgent | null = null;
export function setAgent(agent: QueryAgent): void { agentInstance = agent; }

const queryBodySchema = z.object({
  question: z.string().min(1).max(2000),
  datasetId: z.string().uuid().optional(),
  options: z.object({
    topK: z.number().int().min(1).max(50).optional(),
    maxIterations: z.number().int().min(1).max(10).optional(),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']), content: z.string(),
    })).max(20).optional(),
  }).optional(),
});

app.post('/query', async (c) => {
  if (!agentInstance) return c.json({ error: 'Agent not initialized' }, 503);
  const rawBody = await c.req.json().catch(() => null);
  if (!rawBody) return c.json({ error: 'Invalid JSON body' }, 400);
  const parseResult = queryBodySchema.safeParse(rawBody);
  if (!parseResult.success) return c.json({ error: 'Invalid request body', detail: parseResult.error.issues }, 400);
  const body = parseResult.data;
  const history = body.options?.history as Message[] | undefined;
  try {
    const result = await agentInstance.execute(body.question, {
      datasetId: body.datasetId ?? 'default', topK: body.options?.topK, maxIterations: body.options?.maxIterations, history,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: 'Query failed', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default app;
