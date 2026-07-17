export interface HookContext {
  targetName: string;
  params: unknown;
  metadata: { queryLogId?: string; datasetId: string; userId?: string; timestamp: number; };
}

export interface HookActionResult {
  block?: boolean;
  reason?: string;
  modifiedParams?: unknown;
}

export interface Hook {
  name: string;
  target: 'tool' | 'skill' | 'both';
  phase: 'before' | 'after';
  filter?: string | string[];
  before?(ctx: HookContext): Promise<HookActionResult | void>;
  after?(ctx: HookContext, result: unknown): Promise<unknown | void>;
}
