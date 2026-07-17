import type { SplitConfig } from './types';
import { PERIOD } from './separators';

type Separator = string | RegExp;

function isRegExp(s: Separator): s is RegExp {
  return s instanceof RegExp;
}

/** 找 separator 在 text 中的下一个匹配位置（兼容字符串与 RegExp） */
function findFirstMatch(text: string, sep: Separator): { idx: number; len: number } {
  if (isRegExp(sep)) {
    // 每次用前重置 lastIndex，避免被前一次调用污染
    const re = sep.global ? sep : new RegExp(sep.source, sep.flags);
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) return { idx: -1, len: 0 };
    return { idx: m.index, len: m[0].length };
  }
  const idx = text.indexOf(sep);
  return { idx, len: idx >= 0 ? sep.length : 0 };
}

export class RecursiveSplitter {
  constructor(protected config: SplitConfig) {}

  protected splitBySeparators(text: string, seps: Separator[]): string[] {
    const availableSeps = seps.filter(s => {
      if (s === '') return false;
      if (isRegExp(s)) {
        // 强制重置 lastIndex（无 g flag 时 .test() 不会自动重置）
        s.lastIndex = 0;
        return s.test(text);
      }
      return text.includes(s);
    });
    if (availableSeps.length === 0) return [text];

    const parts: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      let earliestIdx = remaining.length;
      let earliestLen = 0;
      let matched = false;
      for (const s of availableSeps) {
        const { idx, len } = findFirstMatch(remaining, s);
        if (idx !== -1 && idx < earliestIdx) {
          earliestIdx = idx;
          earliestLen = len;
          matched = true;
        }
      }
      if (!matched) {
        parts.push(remaining);
        break;
      }
      const end = earliestIdx + earliestLen;
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    return parts.filter(p => p.length > 0);
  }

  private splitByPeriod(text: string): string[] {
    return this.splitBySeparators(text, [PERIOD]);
  }

  /**
   * 真正的多级递归切分：
   *   - 先按 L0（法律层级）切；每个 part 仍超长 → 递归到 L1（款项）
   *   - L1 仍超长 → L2（句号）；L2 仍超长 → splitAtPeriodBoundary 强制按句号切
   *   - 当前 level 没切出多个 → 继续试下一级（除非已到末级）
   *   - 所有 level 都不够细 → 原样返回
   */
  private recursiveSplit(text: string, levelIdx: number = 0): string[] {
    const { maxChunkSize, separators, lengthFunction: len } = this.config;
    if (len(text) <= maxChunkSize) return [text];
    if (levelIdx >= separators.length) return [text];

    const seps = separators[levelIdx]!;
    const parts = this.splitBySeparators(text, seps as Separator[]);
    if (parts.length > 1) {
      const result: string[] = [];
      for (const part of parts) {
        if (len(part) <= maxChunkSize) {
          result.push(part);
        } else {
          result.push(...this.recursiveSplit(part, levelIdx + 1));
        }
      }
      return result;
    }
    // 当前 level 切不出多个 → 降级到下一级
    if (levelIdx + 1 < separators.length) {
      return this.recursiveSplit(text, levelIdx + 1);
    }
    return [text];
  }

  private mergeUnits(units: string[]): string[] {
    const { maxChunkSize, minChunkSize, lengthFunction: len } = this.config;
    const chunks: string[] = [];
    let current = '';
    for (const unit of units) {
      const candidate = current + unit;
      if (len(candidate) <= maxChunkSize) {
        current = candidate;
      } else if (current && len(current) >= minChunkSize) {
        chunks.push(current);
        current = unit;
      } else if (current) {
        chunks.push(...this.splitAtPeriodBoundary(current + unit));
        current = '';
      } else {
        chunks.push(unit);
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private splitAtPeriodBoundary(text: string): string[] {
    const { maxChunkSize, lengthFunction: len } = this.config;
    if (len(text) <= maxChunkSize) return [text];

    const parts: string[] = [];
    let remaining = text;
    while (len(remaining) > maxChunkSize) {
      const cut = this.findPeriodCut(remaining, maxChunkSize);
      if (cut >= remaining.length) {
        parts.push(remaining);
        return parts;
      }
      parts.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    if (remaining) parts.push(remaining);
    return parts;
  }

  private findPeriodCut(text: string, maxSize: number): number {
    const { lengthFunction: len } = this.config;
    if (len(text) <= maxSize) return text.length;

    const ratio = maxSize / len(text);
    const target = Math.max(1, Math.floor(text.length * ratio));
    const window = Math.max(20, Math.floor(text.length * 0.2));

    const idx = text.lastIndexOf(PERIOD, target);
    if (idx >= target - window && idx >= 0) return idx + PERIOD.length;

    const forward = text.indexOf(PERIOD, target);
    if (forward >= 0 && forward <= target + window) return forward + PERIOD.length;

    return text.length;
  }

  private addOverlap(chunks: string[]): string[] {
    const { overlapSize, lengthFunction: len } = this.config;
    if (overlapSize <= 0 || chunks.length <= 1) return chunks;

    const result = [chunks[0]!];
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      if (len(prev) <= overlapSize) {
        result.push(prev + chunks[i]!);
        continue;
      }
      const cutStart = this.findOverlapStartByPeriod(prev, overlapSize);
      result.push(cutStart >= 0 ? prev.slice(cutStart) + chunks[i]! : chunks[i]!);
    }
    return result;
  }

  /**
   * 在 prev 中按句号找 overlap 起点（不按字数暴力切）。
   * - 收集所有句号位置，选 overlap 长度 <= overlapSize 且最大的（最靠前满足的句号）
   * - 若所有句号之后的 overlap 都超 overlapSize，取最后一个句号（overlap 偏大但守住句号边界）
   * - 若无句号，返回 -1（不 overlap）
   */
  private findOverlapStartByPeriod(prev: string, overlapSize: number): number {
    const { lengthFunction: len } = this.config;
    const positions: number[] = [];
    let from = 0;
    while (true) {
      const idx = prev.indexOf(PERIOD, from);
      if (idx < 0) break;
      positions.push(idx);
      from = idx + PERIOD.length;
    }
    if (positions.length === 0) return -1;

    for (const idx of positions) {
      const overlapText = prev.slice(idx + PERIOD.length);
      if (len(overlapText) <= overlapSize) {
        return idx + PERIOD.length;
      }
    }
    const last = positions[positions.length - 1]!;
    return last + PERIOD.length;
  }

  splitRaw(text: string): string[] {
    const cleaned = text.replace(/\r\n/g, '\n');
    const units = this.recursiveSplit(cleaned, 0);
    const merged = this.mergeUnits(units);
    return this.addOverlap(merged);
  }
}
