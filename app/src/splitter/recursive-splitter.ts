import type { SplitConfig } from './types';
import { PERIOD } from './separators';

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

  private splitByPeriod(text: string): string[] {
    return this.splitBySeparators(text, [PERIOD]);
  }

  private recursiveSplit(text: string): string[] {
    const { maxChunkSize, lengthFunction: len } = this.config;
    if (len(text) <= maxChunkSize) return [text];

    const parts = this.splitByPeriod(text);
    if (parts.length <= 1) return [text];

    const result: string[] = [];
    for (const part of parts) {
      if (len(part) <= maxChunkSize) {
        result.push(part);
      } else {
        result.push(part);
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
        result.push(prev + chunks[i]);
        continue;
      }
      const ratio = overlapSize / len(prev);
      let startChar = Math.floor(prev.length * (1 - ratio));
      const snapTolerance = Math.max(8, Math.floor(prev.length * 0.05));
      let bestSnap = startChar;
      const idx = prev.lastIndexOf(PERIOD, startChar + snapTolerance);
      if (idx >= startChar - snapTolerance && idx >= 0) {
        const snapEnd = idx + PERIOD.length;
        if (Math.abs(snapEnd - startChar) < Math.abs(bestSnap - startChar)) {
          bestSnap = snapEnd;
        }
      }
      startChar = bestSnap;
      result.push(prev.slice(startChar) + chunks[i]);
    }
    return result;
  }

  splitRaw(text: string): string[] {
    const cleaned = text.replace(/\r\n/g, '\n');
    const units = this.recursiveSplit(cleaned);
    const merged = this.mergeUnits(units);
    return this.addOverlap(merged);
  }
}
