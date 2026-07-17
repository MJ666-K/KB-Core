import { HookRegistry } from './registry';
import { auditBeforeHook, auditAfterHook } from './audit-hook';
import { rateLimitHook } from './rate-limit-hook';
import { kgTraceHook, kgAccessHook } from './kg-hooks';
import { config } from '@core/config';

export function createHookRegistry(): HookRegistry {
  const registry = new HookRegistry();
  registry.register(auditBeforeHook);
  registry.register(auditAfterHook);
  registry.register(rateLimitHook);
  if (config.kgEnabled) {
    registry.register(kgAccessHook);
    registry.register(kgTraceHook);
  }
  return registry;
}

export { HookRegistry } from './registry';
export type { Hook, HookContext, HookActionResult } from './types';
