import type { Hook } from './types';
import { getQuerySettings } from '@infra/settings/effective-config';

const callCounts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;

export const rateLimitHook: Hook = {
  name: 'rate-limit', target: 'both', phase: 'before',
  async before(ctx) {
    const key = ctx.metadata.queryLogId ?? ctx.metadata.userId ?? 'anonymous';
    const now = Date.now();
    let entry = callCounts.get(key);
    if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + WINDOW_MS }; callCounts.set(key, entry); }
    entry.count++;
    if (entry.count > getQuerySettings().agentMaxToolCalls) {
      const max = getQuerySettings().agentMaxToolCalls;
      return { block: true, reason: `超过单次查询最大调用数 (${max})` };
    }
  },
};

export function resetRateLimit(key: string): void { callCounts.delete(key); }
