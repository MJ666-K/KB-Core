import { getRuntimeSettingsSync } from './store';
import type { DatasetChunkConfig, DatasetRetrieveConfig } from '../db/schema';

export type ChunkSettings = ReturnType<typeof getRuntimeSettingsSync>['chunk'];
export type QuerySettings = ReturnType<typeof getRuntimeSettingsSync>['query'];

/** 全局默认切割配置（data/settings.json） */
export function getChunkSettings(): ChunkSettings {
  return getRuntimeSettingsSync().chunk;
}

/** 全局默认召回配置（data/settings.json） */
export function getQuerySettings(): QuerySettings {
  return getRuntimeSettingsSync().query;
}

/**
 * 合并库级覆盖：全局默认 base ← 库级 Partial override。
 * 空字段（undefined）回退 base；多库检索时取主库（datasetIds[0]）的覆盖。
 */
export function mergeChunk(base: ChunkSettings, override?: Partial<DatasetChunkConfig> | null): ChunkSettings {
  return override ? { ...base, ...override } : base;
}

export function mergeQuery(base: QuerySettings, override?: Partial<DatasetRetrieveConfig> | null): QuerySettings {
  return override ? { ...base, ...override } : base;
}
