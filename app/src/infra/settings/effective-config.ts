import { getRuntimeSettingsSync } from './store';

export function getChunkSettings() {
  return getRuntimeSettingsSync().chunk;
}

export function getQuerySettings() {
  return getRuntimeSettingsSync().query;
}
