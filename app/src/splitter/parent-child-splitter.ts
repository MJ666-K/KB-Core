import type { SplitConfig, ChunkUnit } from './types';
import { RecursiveSplitter } from './recursive-splitter';
import { computeChunkOffsets } from './offsets';
import { countTokens } from './token-counter';
import { sha256 } from '../utils/hash';
import { normalizeDocumentContent } from '../utils/text-normalize';
import { StructureIndex, type StructureMeta } from './structure-parser';

export class ParentChildSplitter {
  constructor(
    private parentConfig: SplitConfig,
    private childConfig: SplitConfig,
  ) {}

  split(text: string, metadata: Record<string, unknown> = {}): ChunkUnit[] {
    const cleaned = normalizeDocumentContent(text);
    const index = new StructureIndex(cleaned);
    const units: ChunkUnit[] = [];

    const parentSplitter = new RecursiveSplitter(this.parentConfig);
    const parentTexts = parentSplitter.splitRaw(cleaned);
    const parentOffsets = computeChunkOffsets(cleaned, parentTexts);

    for (let pi = 0; pi < parentTexts.length; pi++) {
      const parentText = parentTexts[pi]!;
      const { start: pStart, end: pEnd } = parentOffsets[pi]!;
      const parentMeta = index.queryAt(pStart);

      units.push({
        text: parentText,
        tokenCount: countTokens(parentText),
        isParent: true,
        parentChunkIndex: pi,
        childIndexWithinParent: null,
        startOffset: pStart,
        endOffset: pEnd,
        contentHash: sha256(parentText),
        metadata: { ...metadata, isParent: true, parentChunkIndex: pi, ...parentMeta },
        structure: { ...parentMeta },
      });

      const childSplitter = new RecursiveSplitter(this.childConfig);
      const childTexts = childSplitter.splitRaw(parentText);
      const childOffsets = computeChunkOffsets(parentText, childTexts);

      for (let ci = 0; ci < childTexts.length; ci++) {
        const childText = childTexts[ci]!;
        const local = childOffsets[ci]!;
        const absoluteStart = pStart + local.start;
        // tiao 归属：取 childText 内部出现的所有「第X条」中**靠后但非末尾**的一个
        //   （childText 是"overlap 前缀 + 主内容"，主内容的「第X条」在 childText 中段或后段；
        //    末尾那个「第X条」通常是下一条的 overlap 头，被 skip）
        //   - 0 个 → 原文 absoluteStart 查到的 tiao → 父块 tiao
        //   - 1 个 → 用它
        //   - 2+ → 用倒数第二个
        const childInnerIndex = new StructureIndex(childText);
        const localTiaos = childInnerIndex.tiaoEntries();
        let tiao: string | undefined;
        if (localTiaos.length === 0) {
          tiao = index.queryAt(absoluteStart).tiao ?? parentMeta.tiao;
        } else if (localTiaos.length === 1) {
          tiao = localTiaos[0]!.label;
        } else {
          tiao = localTiaos[localTiaos.length - 2]!.label;
        }
        const childMeta: StructureMeta = {
          bian: parentMeta.bian,
          zhang: parentMeta.zhang,
          jie: parentMeta.jie,
          tiao,
        };

        units.push({
          text: childText,
          tokenCount: countTokens(childText),
          isParent: false,
          parentChunkIndex: pi,
          childIndexWithinParent: ci,
          // startOffset/endOffset 指向**原文**中的 child 物理区段（与 text 等长，无 prefix）
          startOffset: absoluteStart,
          endOffset: absoluteStart + childText.length,
          contentHash: sha256(childText),
          metadata: { ...metadata, isParent: false, parentChunkIndex: pi, childIndexWithinParent: ci, ...childMeta },
          structure: { ...childMeta },
        });
      }
    }

    return units;
  }
}
