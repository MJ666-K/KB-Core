import { Hono } from 'hono';
import { authMiddleware, requirePermission, type AuthEnv } from '@infra/auth/middleware';
import agentsRouter from '@features/admin/routes/agents';
import skillsRouter from '@features/admin/routes/skills';
import documentsRouter from '@features/kb/routes/documents';
import datasetsRouter from '@features/kb/routes/datasets';
import statsRouter from '@features/admin/routes/stats';
import modelsRouter from '@features/admin/routes/models';
import chatRouter from '@features/chat/routes/chat';
import sessionsRouter from '@features/chat/routes/sessions';
import settingsRouter from '@features/admin/routes/settings';
import skillMetaRouter from '@features/admin/routes/skill-meta';
import authRouter from '@infra/auth/routes';
import kgRouter from '@features/kg/routes';
import queryJobsRouter from '@features/chat/routes/query-jobs';
import usersRouter from '@features/admin/routes/users';
import rolesRouter from '@features/admin/routes/roles';
import excelRouter from '@features/excel/routes';
import { getSubAgentRegistry } from '@features/chat/agent/sub-agent-registry';

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
