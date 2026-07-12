import type { Context, Next } from 'hono';
import { extractBearer, resolveBearerToken } from './service';
import type { AuthUser } from './types';
import type { Permission } from './permission-registry';
import { hasPermission } from './permission-registry';

export type AuthEnv = { Variables: { user: AuthUser } };

const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/refresh',
];

export function isPublicApiPath(path: string): boolean {
  return PUBLIC_API_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (path === '/health' || isPublicApiPath(path)) {
    await next();
    return;
  }

  if (path.startsWith('/api/') || path === '/ingest') {
    const token = extractBearer(c.req.header('Authorization'));
    if (!token) {
      return c.json({ error: 'Unauthorized', detail: 'Missing Bearer token' }, 401);
    }
    const user = await resolveBearerToken(token);
    if (!user) {
      return c.json({ error: 'Unauthorized', detail: 'Invalid or expired token' }, 401);
    }
    c.set('user', user);
  }

  await next();
}

export function getAuthUser(c: Context<AuthEnv>): AuthUser {
  return c.get('user');
}

export function requirePermission(permission: Permission) {
  return async (c: Context<AuthEnv>, next: Next): Promise<Response | void> => {
    const user = getAuthUser(c);
    if (!hasPermission(user.permissions, permission)) {
      return c.json({ error: 'Forbidden', detail: '权限不足' }, 403);
    }
    await next();
  };
}

/** 满足任一权限即可通过 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async (c: Context<AuthEnv>, next: Next): Promise<Response | void> => {
    const user = getAuthUser(c);
    if (!permissions.some(p => hasPermission(user.permissions, p))) {
      return c.json({ error: 'Forbidden', detail: '权限不足' }, 403);
    }
    await next();
  };
}
