import { ParentChildSplitter } from './parent-child-splitter';
import { SEPARATOR_LEVELS } from './separators';
import { countTokens } from './token-counter';
import { config } from '../config';

export function createSplitter(): ParentChildSplitter {
  return new ParentChildSplitter(
    {
      maxChunkSize: config.chunkParentTokens,
      overlapSize: Math.floor(config.chunkOverlapTokens * 1.5),
      minChunkSize: Math.floor(config.chunkParentTokens / 4),
      lengthFunction: countTokens,
      separators: SEPARATOR_LEVELS,
    },
    {
      maxChunkSize: config.chunkChildTokens,
      overlapSize: config.chunkOverlapTokens,
      minChunkSize: Math.floor(config.chunkChildTokens / 3),
      lengthFunction: countTokens,
      separators: SEPARATOR_LEVELS,
    },
  );
}

export { ParentChildSplitter } from './parent-child-splitter';
export { RecursiveSplitter } from './recursive-splitter';
export { countTokens } from './token-counter';
export { SEPARATOR_LEVELS } from './separators';
export type { ChunkUnit, SplitConfig } from './types';
