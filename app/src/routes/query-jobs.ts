import { Hono } from 'hono';
import { getQueryJob, getActiveJobForSession } from '../auth/query-job-store';
import type { AuthEnv } from '../auth/middleware';
import { getAuthUser } from '../auth/middleware';

const app = new Hono<AuthEnv>();

app.get('/jobs/:jobId', async (c) => {
  const user = getAuthUser(c);
  const job = await getQueryJob(c.req.param('jobId'));
  if (!job || job.userId !== user.id) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const since = Number(c.req.query('since') ?? '0');
  const events = job.events.slice(Math.max(0, since));

  return c.json({
    job: {
      id: job.id,
      sessionId: job.sessionId,
      question: job.question,
      status: job.status,
      partialAnswer: job.partialAnswer,
      result: job.result,
      error: job.error,
      updatedAt: job.updatedAt,
      eventCount: job.events.length,
    },
    events,
    nextSince: job.events.length,
  });
});

app.get('/sessions/:sessionId/active', async (c) => {
  const user = getAuthUser(c);
  const sessionId = c.req.param('sessionId');
  const job = await getActiveJobForSession(sessionId);
  if (!job || job.userId !== user.id) {
    return c.json({ active: false });
  }
  return c.json({
    active: job.status === 'running',
    jobId: job.id,
    status: job.status,
    partialAnswer: job.partialAnswer,
  });
});

export default app;
