/**
 * 法律文档结构索引。
 *
 * 一次 O(n) 预扫原文，记录所有「第X{编|章|节|条}」出现位置。
 * 切分时通过 queryAt(pos) O(log n) 二分查当前位置所属的层级栈。
 *
 * 设计原则：
 *   - 切分逻辑（recursive-splitter）与结构识别（这里）解耦
 *   - 元数据只活 in-memory，DB 持久化延后到 v2
 */

const CN_NUM = '[一二三四五六七八九十百千零〇两]';
const L0_RE = new RegExp(`第(${CN_NUM}+)(编|章|节|条)`, 'g');

export type StructureKind = 'bian' | 'zhang' | 'jie' | 'tiao';

export interface StructureMeta {
  bian?: string;
  zhang?: string;
  jie?: string;
  tiao?: string;
}

interface StructureEntry {
  pos: number;
  kind: StructureKind;
  label: string; // 完整标签，如"第一条"
}

export class StructureIndex {
  private readonly entries: StructureEntry[] = [];

  constructor(text: string) {
    L0_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = L0_RE.exec(text)) !== null) {
      const kind = ({ 编: 'bian', 章: 'zhang', 节: 'jie', 条: 'tiao' } as const)[m[2] as '编' | '章' | '节' | '条'];
      if (!kind) continue;
      this.entries.push({ pos: m.index, kind, label: m[0] });
    }
  }

  /**
   * 给定位置，返回该位置**起点的语义结构**（即"刚跨过哪个边界"）：
   *   - 找到 ≤ pos 范围内**最后一个**条目
   *   - 如果是「第X条」返回该 tiao
   *   - 如果是「第X章」/「第X节」/「第X编」返回该层 + 推断后续
   *   - 找不到返回 {}
   *
   * 与"截至 pos 的累计状态"不同：本方法返回 pos 位置**当前所在**的 chunk 归属。
   */
  chunkAt(pos: number): StructureMeta {
    const meta: StructureMeta = {};
    let lastEntry: StructureEntry | null = null;
    for (const e of this.entries) {
      if (e.pos > pos) break;
      lastEntry = e;
    }
    if (!lastEntry) return meta;
    // 累计往上推
    for (const e of this.entries) {
      if (e.pos > lastEntry.pos) break;
      if (e.kind === 'bian') {
        meta.bian = e.label;
      } else if (e.kind === 'zhang' && !meta.bian) {
        meta.zhang = e.label;
      } else if (e.kind === 'jie' && !meta.zhang) {
        meta.jie = e.label;
      } else if (e.kind === 'tiao' && !meta.jie) {
        meta.tiao = e.label;
      }
    }
    return meta;
  }

  /**
   * 给定位置，返回该位置所属的层级栈（截至 pos 的**累计状态**）。
   *   - bian = 该位置之前最近的「第X编」（或继承自父块）
   *   - 第X编出现时，zhang/jie/tiao 失效（编切换 → 上层结构变化）
   *   - 第X章出现时，jie/tiao 失效
   *   - 第X节出现时，tiao 失效
   *   - 第X条出现时，仅更新 tiao
   */
  queryAt(pos: number): StructureMeta {
    const meta: StructureMeta = {};
    for (const e of this.entries) {
      if (e.pos > pos) break;
      if (e.kind === 'bian') {
        meta.bian = e.label;
        delete meta.zhang;
        delete meta.jie;
        delete meta.tiao;
      } else if (e.kind === 'zhang') {
        meta.zhang = e.label;
        delete meta.jie;
        delete meta.tiao;
      } else if (e.kind === 'jie') {
        meta.jie = e.label;
        delete meta.tiao;
      } else {
        meta.tiao = e.label;
      }
    }
    return meta;
  }

  /** 把 meta 拼成可读前缀，如 "第一编 第二章 第三节 第十二条 "。空时返回空串。 */
  static formatPrefix(meta: StructureMeta): string {
    const parts = [meta.bian, meta.zhang, meta.jie, meta.tiao].filter((x): x is string => Boolean(x));
    return parts.length === 0 ? '' : parts.join(' ') + ' ';
  }

  /** 总条目数（用于调试 / 测试） */
  size(): number {
    return this.entries.length;
  }

  /**
   * 返回所有「第X条」的位置和 label，按出现顺序。
   * 用于 child chunk 主归属判断（绕开 overlap 污染）。
   */
  tiaoEntries(): Array<{ pos: number; label: string }> {
    return this.entries
      .filter(e => e.kind === 'tiao')
      .map(e => ({ pos: e.pos, label: e.label }));
  }
}
