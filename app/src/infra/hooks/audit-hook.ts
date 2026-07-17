import type { Hook } from './types';
import { logger } from '@core/utils/logger';

export const auditBeforeHook: Hook = {
  name: 'audit-before', target: 'both', phase: 'before',
  async before(ctx) { logger.info(`[AUDIT] calling ${ctx.targetName}`, { params: ctx.params, datasetId: ctx.metadata.datasetId }); },
};

export const auditAfterHook: Hook = {
  name: 'audit-after', target: 'both', phase: 'after',
  async after(ctx, result) { const latency = Date.now() - ctx.metadata.timestamp; logger.info(`[AUDIT] ${ctx.targetName} done (${latency}ms)`); return result; },
};
