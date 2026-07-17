import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AuthEnv } from '@infra/auth/middleware';
import { requirePermission } from '@infra/auth/middleware';
import { getAgent } from '@features/chat/agent/registry';
import type { QueryOptions } from '@features/chat/agent/types';

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('chat:use'));

interface ChatRequest {
  question: string;
  datasetId?: string;
  topK?: number;
  maxIterations?: number;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

app.post('/', async (c) => {
  const body = await c.req.json() as ChatRequest;
  const agent = getAgent();
  if (!agent) {
    return c.json({ error: 'Agent not initialized' }, 500);
  }

  try {
    const options: QueryOptions = {
      datasetId: body.datasetId || '',
      topK: body.topK,
      maxIterations: body.maxIterations,
      history: body.history,
    };

    const result = await agent.execute(body.question, options);

    return c.json({
      success: true,
      answer: result.answer,
      citations: result.citations,
      duration: result.latencyMs,
      termination: result.termination,
    });
  } catch (err) {
    return c.json({ error: 'Chat failed', detail: String(err) }, 500);
  }
});

app.post('/stream', async (c) => {
  const body = await c.req.json() as ChatRequest;
  const agent = getAgent();
  if (!agent) {
    c.status(500);
    return c.json({ error: 'Agent not initialized' });
  }

  return streamSSE(c, async (stream) => {
    try {
      const eventStream = {
        emit: (event: any) => {
          stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
          });
        },
      };

      const options: QueryOptions = {
        datasetId: body.datasetId || '',
        topK: body.topK,
        maxIterations: body.maxIterations,
        history: body.history,
      };

      const result = await agent.execute(body.question, options, eventStream);

      stream.writeSSE({
        data: JSON.stringify({
          type: 'complete',
          answer: result.answer,
          citations: result.citations,
          duration: result.latencyMs,
          termination: result.termination,
        }),
        event: 'complete',
      });

      stream.close();
    } catch (err) {
      try {
        stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: String(err) }),
          event: 'error',
        });
        stream.close();
      } catch {
        // Stream closed
      }
    }
  });
});

export default app;
