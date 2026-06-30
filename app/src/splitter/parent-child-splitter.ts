import type { SplitConfig, ChunkUnit } from './types';
import { RecursiveSplitter } from './recursive-splitter';
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

    // 切 Parent
    const parentSplitter = new RecursiveSplitter(this.parentConfig);
    const parentTexts = parentSplitter.splitRaw(cleaned);

    let searchFrom = 0;
    const parentStartOffsets: number[] = [];
    for (const parentText of parentTexts) {
      const fingerprint = parentText.slice(0, 50);
      const foundAt = cleaned.indexOf(fingerprint, searchFrom);
      const startOffset = foundAt >= 0 ? foundAt : searchFrom;
      parentStartOffsets.push(startOffset);
      searchFrom = startOffset + parentText.length;
    }

    for (let pi = 0; pi < parentTexts.length; pi++) {
      const parentText = parentTexts[pi]!;
      const startOffset = parentStartOffsets[pi]!;

      units.push({
        text: parentText,
        tokenCount: countTokens(parentText),
        isParent: true,
        parentChunkIndex: pi,
        childIndexWithinParent: null,
        startOffset,
        endOffset: startOffset + parentText.length,
        contentHash: sha256(parentText),
        metadata: { ...metadata, isParent: true, parentChunkIndex: pi },
      });

      // 切 Child
      const childSplitter = new RecursiveSplitter(this.childConfig);
      const childTexts = childSplitter.splitRaw(parentText);
      for (let ci = 0; ci < childTexts.length; ci++) {
        const childText = childTexts[ci]!;
        const fingerprint = childText.slice(0, 30);
        const localStart = parentText.indexOf(fingerprint);
        const absoluteStart = startOffset + (localStart >= 0 ? localStart : 0);

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
