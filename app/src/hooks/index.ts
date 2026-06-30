import { HookRegistry } from './registry';
import { auditBeforeHook, auditAfterHook } from './audit-hook';
import { rateLimitHook } from './rate-limit-hook';

export function createHookRegistry(): HookRegistry {
  const registry = new HookRegistry();
  registry.register(auditBeforeHook);
  registry.register(auditAfterHook);
  registry.register(rateLimitHook);
  return registry;
}

export { HookRegistry } from './registry';
export type { Hook, HookContext, HookActionResult } from './types';
