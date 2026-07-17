import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { config } from '@core/config';

const chunkSchema = z.object({
  parentTokens: z.number().int().positive().max(8000),
  childTokens: z.number().int().positive().max(2000),
  overlapTokens: z.number().int().nonnegative().max(500),
});

const querySchema = z.object({
  searchTopK: z.number().int().positive().max(100),
  denseTopKMultiplier: z.number().int().positive().max(20),
  rrfK: z.number().int().positive().max(200),
  rerankTopK: z.number().int().positive().max(100),
  denseMinSimilarity: z.number().min(0).max(1),
  rerankMinScore: z.number().min(0).max(1),
  agentMaxIterations: z.number().int().positive().max(20),
  agentMaxToolCalls: z.number().int().positive().max(50),
  resultCacheTtlMs: z.number().int().positive().max(3_600_000),
});

export const runtimeSettingsSchema = z.object({
  chunk: chunkSchema,
  query: querySchema,
});

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

const SETTINGS_PATH = join(process.cwd(), 'data', 'settings.json');

let cached: RuntimeSettings | null = null;

export function defaultRuntimeSettings(): RuntimeSettings {
  return {
    chunk: {
      parentTokens: config.chunkParentTokens,
      childTokens: config.chunkChildTokens,
      overlapTokens: config.chunkOverlapTokens,
    },
    query: {
      searchTopK: config.searchTopK,
      denseTopKMultiplier: config.denseTopKMultiplier,
      rrfK: config.rrfK,
      rerankTopK: config.rerankTopK,
      denseMinSimilarity: config.denseMinSimilarity,
      rerankMinScore: config.rerankMinScore,
      agentMaxIterations: config.agentMaxIterations,
      agentMaxToolCalls: config.agentMaxToolCalls,
      resultCacheTtlMs: config.resultCacheTtlMs,
    },
  };
}

export async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  if (cached) return cached;
  const defaults = defaultRuntimeSettings();
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8');
    const json = JSON.parse(raw) as Partial<RuntimeSettings>;
    cached = runtimeSettingsSchema.parse({
      chunk: { ...defaults.chunk, ...json.chunk },
      query: { ...defaults.query, ...json.query },
    });
  } catch {
    cached = defaults;
  }
  return cached;
}

export function getRuntimeSettingsSync(): RuntimeSettings {
  return cached ?? defaultRuntimeSettings();
}

export async function saveRuntimeSettings(partial: {
  chunk?: Partial<RuntimeSettings['chunk']>;
  query?: Partial<RuntimeSettings['query']>;
}): Promise<RuntimeSettings> {
  const current = await loadRuntimeSettings();
  const next = runtimeSettingsSchema.parse({
    chunk: { ...current.chunk, ...partial.chunk },
    query: { ...current.query, ...partial.query },
  });
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  cached = next;
  return next;
}

/** 启动时加载，供同步读取 */
export async function initRuntimeSettings(): Promise<void> {
  await loadRuntimeSettings();
}
