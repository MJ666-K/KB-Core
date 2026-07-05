import type { Hono } from 'hono';
import agentsRouter from './agents';
import skillsRouter from './skills';
import documentsRouter from './documents';
import datasetsRouter from './datasets';
import statsRouter from './stats';
import modelsRouter from './models';
import chatRouter from './chat';
import { getSubAgentRegistry } from '../agent/sub-agent-registry';

export function mountApiRoutes(app: Hono): void {
  app.route('/api/agents', agentsRouter);
  app.route('/api/skills', skillsRouter);
  app.route('/api/documents', documentsRouter);
  app.route('/api/datasets', datasetsRouter);
  app.route('/api/stats', statsRouter);
  app.route('/api/models', modelsRouter);
  app.route('/api/chat', chatRouter);
  app.post('/api/reload', async (c) => {
    try {
      await getSubAgentRegistry().reload();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: 'reload failed', detail: String(err) }, 500);
    }
  });
}
