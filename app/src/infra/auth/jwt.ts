import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '@core/config';
import type { AccessTokenPayload } from './types';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function b64urlJson(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

function sign(data: string): string {
  return createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type' | 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const body: AccessTokenPayload & { iat: number; exp: number } = {
    ...payload,
    type: 'access',
    iat: now,
    exp: now + config.jwtAccessTtlSec,
  };
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payloadPart = b64urlJson(body);
  const signature = sign(`${header}.${payloadPart}`);
  return `${header}.${payloadPart}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payloadPart, signature] = parts;
  const expected = sign(`${header}.${payloadPart}`);
  try {
    const a = Buffer.from(signature ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadPart ?? '', 'base64url').toString('utf8')) as AccessTokenPayload & { exp?: number };
    if (payload.type !== 'access' || !payload.sub || !payload.jti) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function accessTokenExpiresInSec(): number {
  return config.jwtAccessTtlSec;
}
