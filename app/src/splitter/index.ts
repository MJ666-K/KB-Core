import { ParentChildSplitter } from './parent-child-splitter';
import { SEPARATOR_LEVELS } from './separators';
import { countTokens } from './token-counter';
import { getChunkSettings } from '../settings/effective-config';

export function createSplitter(): ParentChildSplitter {
  const { parentTokens, childTokens, overlapTokens } = getChunkSettings();
  return createSplitterWithConfig(parentTokens, childTokens, overlapTokens);
}

export function createSplitterWithConfig(
  parentTokens: number,
  childTokens: number,
  overlapTokens: number,
): ParentChildSplitter {
  return new ParentChildSplitter(
    {
      maxChunkSize: parentTokens,
      overlapSize: Math.floor(overlapTokens * 1.5),
      minChunkSize: Math.floor(parentTokens / 4),
      lengthFunction: countTokens,
      separators: SEPARATOR_LEVELS,
    },
    {
      maxChunkSize: childTokens,
      overlapSize: overlapTokens,
      minChunkSize: Math.floor(childTokens / 3),
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
