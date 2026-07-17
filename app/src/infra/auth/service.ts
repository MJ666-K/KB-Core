import { timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@core/db/client';
import { users } from '@core/db/schema';
import { getRedis } from '@core/redis/client';
import { config } from '@core/config';
import { signAccessToken, verifyAccessToken } from './jwt';
import { hashPassword, verifyPassword } from './password';
import type { AuthUser, LoginResult } from './types';
import { resolveUserAuth } from './role-service';
import { SUPERADMIN_ROLE_KEY } from './permission-registry';

const REFRESH_PREFIX = 'auth:refresh:';
const REVOKED_ACCESS_PREFIX = 'auth:revoked:';

function refreshKey(id: string): string {
  return `${REFRESH_PREFIX}${id}`;
}

function tokensEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

async function toAuthUser(user: typeof users.$inferSelect): Promise<AuthUser> {
  const { roleLabel, permissions } = await resolveUserAuth(user.role);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    roleLabel,
    permissions,
  };
}

/** 初始化超级管理员（仅首次） */
export async function seedSuperAdmin(): Promise<void> {
  const existing = await db.query.users.findFirst({
    where: eq(users.username, config.authDefaultUsername),
  });
  if (existing) {
    if (existing.role !== SUPERADMIN_ROLE_KEY) {
      await db.update(users)
        .set({ role: SUPERADMIN_ROLE_KEY, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
    }
    return;
  }

  const passwordHash = await hashPassword(config.authDefaultPassword);
  await db.insert(users).values({
    username: config.authDefaultUsername,
    passwordHash,
    role: SUPERADMIN_ROLE_KEY,
  });
}

export async function login(username: string, password: string): Promise<LoginResult | null> {
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user || user.disabled) return null;
  if (!await verifyPassword(password, user.passwordHash)) return null;
  return issueSession(user);
}

async function issueSession(user: typeof users.$inferSelect): Promise<LoginResult> {
  const refreshId = nanoid(32);
  const jti = nanoid(16);
  const authUser = await toAuthUser(user);
  const redis = getRedis();
  await redis.set(
    refreshKey(refreshId),
    JSON.stringify({ userId: user.id }),
    'EX',
    config.jwtRefreshTtlSec,
  );

  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
    jti,
  });
  return {
    accessToken,
    refreshToken: refreshId,
    user: authUser,
  };
}

export async function refreshSession(refreshToken: string): Promise<LoginResult | null> {
  const redis = getRedis();
  const raw = await redis.get(refreshKey(refreshToken));
  if (!raw) return null;

  const parsed = JSON.parse(raw) as { userId: string };
  const user = await db.query.users.findFirst({ where: eq(users.id, parsed.userId) });
  if (!user || user.disabled) {
    await redis.del(refreshKey(refreshToken));
    return null;
  }

  await redis.del(refreshKey(refreshToken));
  return issueSession(user);
}

export async function logout(refreshToken: string): Promise<void> {
  await getRedis().del(refreshKey(refreshToken));
}

async function isAccessRevoked(jti: string): Promise<boolean> {
  const v = await getRedis().get(`${REVOKED_ACCESS_PREFIX}${jti}`);
  return v === '1';
}

async function resolveServiceTokenUser(): Promise<AuthUser | null> {
  const superadmin = await db.query.users.findFirst({
    where: eq(users.role, SUPERADMIN_ROLE_KEY),
  });
  if (!superadmin || superadmin.disabled) return null;
  return toAuthUser(superadmin);
}

export async function resolveBearerToken(token: string): Promise<AuthUser | null> {
  if (config.apiServiceToken && tokensEqual(token, config.apiServiceToken)) {
    return resolveServiceTokenUser();
  }

  const payload = verifyAccessToken(token);
  if (!payload) return null;
  if (await isAccessRevoked(payload.jti)) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
  if (!user || user.disabled) return null;

  return toAuthUser(user);
}

export function extractBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}
