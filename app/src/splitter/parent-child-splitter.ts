import type { SplitConfig, ChunkUnit } from './types';
import { RecursiveSplitter } from './recursive-splitter';
import { computeChunkOffsets } from './offsets';
import { countTokens } from './token-counter';
import { sha256 } from '../utils/hash';

export class ParentChildSplitter {
  constructor(
    private parentConfig: SplitConfig,
    private childConfig: SplitConfig,
  ) {}

  split(text: string, metadata: Record<string, unknown> = {}): ChunkUnit[] {
    const cleaned = text.replace(/\r\n/g, '\n');
    const units: ChunkUnit[] = [];

    const parentSplitter = new RecursiveSplitter(this.parentConfig);
    const parentTexts = parentSplitter.splitRaw(cleaned);
    const parentOffsets = computeChunkOffsets(cleaned, parentTexts);

    for (let pi = 0; pi < parentTexts.length; pi++) {
      const parentText = parentTexts[pi]!;
      const { start: startOffset, end: endOffset } = parentOffsets[pi]!;

      units.push({
        text: parentText,
        tokenCount: countTokens(parentText),
        isParent: true,
        parentChunkIndex: pi,
        childIndexWithinParent: null,
        startOffset,
        endOffset,
        contentHash: sha256(parentText),
        metadata: { ...metadata, isParent: true, parentChunkIndex: pi },
      });

      const childSplitter = new RecursiveSplitter(this.childConfig);
      const childTexts = childSplitter.splitRaw(parentText);
      const childOffsets = computeChunkOffsets(parentText, childTexts);

      for (let ci = 0; ci < childTexts.length; ci++) {
        const childText = childTexts[ci]!;
        const local = childOffsets[ci]!;
        const absoluteStart = startOffset + local.start;

        units.push({
          text: childText,
          tokenCount: countTokens(childText),
          isParent: false,
          parentChunkIndex: pi,
          childIndexWithinParent: ci,
          startOffset: absoluteStart,
          endOffset: absoluteStart + childText.length,
          contentHash: sha256(childText),
          metadata: { ...metadata, isParent: false, parentChunkIndex: pi, childIndexWithinParent: ci },
        });
      }
    }

    return units;
  }
}
