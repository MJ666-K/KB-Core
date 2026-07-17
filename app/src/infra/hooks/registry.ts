import type { Hook, HookContext, HookActionResult } from './types';
import { logger } from '@core/utils/logger';

export class HookRegistry {
  private hooks: Hook[] = [];

  register(hook: Hook): void { this.hooks.push(hook); }

  async runBefore(
    targetName: string, params: unknown,
    options: { datasetId: string; queryLogId?: string; userId?: string },
  ): Promise<HookActionResult | void> {
    const ctx: HookContext = { targetName, params, metadata: { datasetId: options.datasetId, queryLogId: options.queryLogId, userId: options.userId, timestamp: Date.now() } };
    let currentParams = params;
    for (const hook of this.hooks) {
      if (hook.phase !== 'before') continue;
      if (hook.filter && !matchesFilter(targetName, hook.filter)) continue;
      try {
        const result = await hook.before?.(ctx);
        if (result?.block) return result;
        if (result?.modifiedParams) { currentParams = result.modifiedParams; ctx.params = currentParams; }
      } catch (err) { logger.warn(`[Hook "${hook.name}" before] threw on "${targetName}"`, err); }
    }
  }

  async runAfter(
    targetName: string, result: unknown,
    options: { datasetId: string; queryLogId?: string; userId?: string },
  ): Promise<unknown> {
    const ctx: HookContext = { targetName, params: null, metadata: { datasetId: options.datasetId, queryLogId: options.queryLogId, userId: options.userId, timestamp: Date.now() } };
    let current = result;
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i]!;
      if (hook.phase !== 'after') continue;
      if (hook.filter && !matchesFilter(targetName, hook.filter)) continue;
      try {
        const modified = await hook.after?.(ctx, current);
        if (modified !== undefined) current = modified;
      } catch (err) { logger.warn(`[Hook "${hook.name}" after] threw on "${targetName}"`, err); }
    }
    return current;
  }
}

function matchesFilter(name: string, filter: string | string[]): boolean {
  return Array.isArray(filter) ? filter.includes(name) : filter === name;
}
