import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AuthEnv } from '../auth/middleware';
import { requirePermission } from '../auth/middleware';
import { getAgent } from '../agent/registry';
import type { QueryOptions } from '../agent/types';
import { parseChatAttachment, isSupportedAttachment } from '../parser/chat-attachment-parser';

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('chat:use'));

const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024;

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

app.post('/attachments', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: '未提供文件' }, 400);
  }
  if (!isSupportedAttachment(file.name)) {
    return c.json({ error: '暂不支持的文件类型，支持 PDF / Word / 文本' }, 400);
  }
  if (file.size > ATTACHMENT_MAX_SIZE) {
    return c.json({ error: `文件过大（上限 ${ATTACHMENT_MAX_SIZE / 1024 / 1024}MB）` }, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseChatAttachment(file.name, buffer);
    return c.json({
      filename: parsed.filename,
      text: parsed.text,
      truncated: parsed.truncated,
      charCount: parsed.text.length,
    });
  } catch (err) {
    return c.json({ error: '文件解析失败', detail: err instanceof Error ? err.message : String(err) }, 422);
  }
});

export default app;
