import type { SplitConfig } from './types';

export class RecursiveSplitter {
  constructor(protected config: SplitConfig) {}

  protected splitBySeparators(text: string, seps: string[]): string[] {
    const availableSeps = seps.filter(s => s !== '' && text.includes(s));
    if (availableSeps.length === 0) return [text];

    const parts: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      let earliestIdx = remaining.length;
      let earliestSep = '';
      for (const s of availableSeps) {
        const idx = remaining.indexOf(s);
        if (idx !== -1 && idx < earliestIdx) {
          earliestIdx = idx;
          earliestSep = s;
        }
      }
      if (earliestSep === '') {
        parts.push(remaining);
        break;
      }
      const end = earliestIdx + earliestSep.length;
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    return parts.filter(p => p.length > 0);
  }

  private recursiveSplit(text: string, level: number): string[] {
    const { maxChunkSize, separators, lengthFunction: len } = this.config;
    if (len(text) <= maxChunkSize) return [text];
    if (level >= separators.length) return this.hardSplit(text);
    const parts = this.splitBySeparators(text, separators[level]!);
    const result: string[] = [];
    for (const part of parts) {
      if (len(part) <= maxChunkSize) {
        result.push(part);
      } else {
        result.push(...this.recursiveSplit(part, level + 1));
      }
    }
    return result;
  }

  private mergeUnits(units: string[]): string[] {
    const { maxChunkSize, minChunkSize, lengthFunction: len } = this.config;
    const chunks: string[] = [];
    let current = '';
    for (const unit of units) {
      const candidate = current + unit;
      if (len(candidate) <= maxChunkSize) {
        current = candidate;
      } else {
        if (current && len(current) >= minChunkSize) {
          chunks.push(current);
          current = unit;
        } else {
          chunks.push(current + unit);
          current = '';
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private addOverlap(chunks: string[]): string[] {
    const { overlapSize, lengthFunction: len, separators } = this.config;
    if (overlapSize <= 0 || chunks.length <= 1) return chunks;

    const result = [chunks[0]!];
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      if (len(prev) <= overlapSize) {
        result.push(prev + chunks[i]);
        continue;
      }
      const ratio = overlapSize / len(prev);
      let startChar = Math.floor(prev.length * (1 - ratio));
      const snapTolerance = Math.max(2, Math.floor(overlapSize * 0.1));
      const sentenceSeps = separators[1] ?? [];
      for (const sep of sentenceSeps) {
        const idx = prev.indexOf(sep, startChar);
        if (idx >= 0 && Math.abs(idx - startChar) <= snapTolerance) {
          startChar = idx + sep.length;
          break;
        }
      }
      result.push(prev.slice(startChar) + chunks[i]);
    }
    return result;
  }

  private hardSplit(text: string): string[] {
    const { maxChunkSize, lengthFunction: len } = this.config;
    const totalLen = len(text);
    if (totalLen <= maxChunkSize) return [text];
    const ratio = maxChunkSize / Math.max(totalLen, 1);
    const step = Math.max(1, Math.floor(text.length * ratio));
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += step) {
      parts.push(text.slice(i, i + step));
    }
    return parts;
  }

  splitRaw(text: string): string[] {
    const cleaned = text.replace(/\r\n/g, '\n');
    const units = this.recursiveSplit(cleaned, 0);
    const merged = this.mergeUnits(units);
    return this.addOverlap(merged);
  }
}
