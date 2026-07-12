import { Hono } from 'hono';
import { authMiddleware, requirePermission, type AuthEnv } from '../auth/middleware';
import agentsRouter from './agents';
import skillsRouter from './skills';
import documentsRouter from './documents';
import datasetsRouter from './datasets';
import statsRouter from './stats';
import modelsRouter from './models';
import chatRouter from './chat';
import sessionsRouter from './sessions';
import settingsRouter from './settings';
import skillMetaRouter from './skill-meta';
import authRouter from './auth';
import kgRouter from './kg';
import queryJobsRouter from './query-jobs';
import usersRouter from './users';
import rolesRouter from './roles';
import excelRouter from './excel';
import { getSubAgentRegistry } from '../agent/sub-agent-registry';

export function mountApiRoutes(app: Hono): void {
  app.route('/api/auth', authRouter);

  const api = new Hono<AuthEnv>();
  api.use('*', authMiddleware);

  api.route('/agents', agentsRouter);
  api.route('/skills', skillsRouter);
  api.route('/skill-meta', skillMetaRouter);
  api.route('/documents', documentsRouter);
  api.route('/datasets', datasetsRouter);
  api.route('/stats', statsRouter);
  api.route('/models', modelsRouter);
  api.route('/chat', chatRouter);
  api.route('/sessions', sessionsRouter);
  api.route('/settings', settingsRouter);
  api.route('/query', queryJobsRouter);
  api.route('/users', usersRouter);
  api.route('/roles', rolesRouter);
  api.route('/kg', kgRouter);
  api.route('/excel', excelRouter);

  api.post('/reload', requirePermission('agents:manage'), async (c) => {
    try {
      await getSubAgentRegistry().reload();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: 'reload failed', detail: String(err) }, 500);
    }
  });

  app.route('/api', api);
}
