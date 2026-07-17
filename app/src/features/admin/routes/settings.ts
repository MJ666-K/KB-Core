import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthEnv } from '@infra/auth/middleware';
import { requirePermission } from '@infra/auth/middleware';
import { defaultRuntimeSettings, loadRuntimeSettings, runtimeSettingsSchema, saveRuntimeSettings } from '@infra/settings/store';

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('settings:manage'));

const patchSchema = z.object({
  chunk: runtimeSettingsSchema.shape.chunk.partial().optional(),
  query: runtimeSettingsSchema.shape.query.partial().optional(),
});

app.get('/', async (c) => {
  const settings = await loadRuntimeSettings();
  const defaults = defaultRuntimeSettings();
  return c.json({ settings, defaults, source: 'data/settings.json' });
});

app.put('/', async (c) => {
  const body = patchSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ error: 'Invalid settings', detail: body.error.issues }, 400);
  }
  const settings = await saveRuntimeSettings(body.data);
  return c.json({ ok: true, settings });
});

export default app;
