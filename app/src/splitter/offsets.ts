/** 计算带 overlap 的 chunk 在 source 中的起止偏移 */
export function computeChunkOffsets(
  source: string,
  parts: readonly string[],
): Array<{ start: number; end: number }> {
  const offsets: Array<{ start: number; end: number }> = [];
  let hint = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    let start = source.indexOf(part, hint);

    if (start < 0 && i > 0) {
      const prev = parts[i - 1]!;
      const prevStart = offsets[i - 1]!.start;
      start = findOverlapStart(source, prev, part, prevStart);
    }

    if (start < 0) {
      const head = part.slice(0, Math.min(50, part.length));
      start = source.indexOf(head, Math.max(0, hint - part.length));
    }

    if (start < 0) start = hint;

    offsets.push({ start, end: start + part.length });

    if (i + 1 < parts.length) {
      hint = nextSearchHint(parts[i]!, parts[i + 1]!, start);
    }
  }

  return offsets;
}

function findOverlapStart(source: string, prev: string, curr: string, prevStart: number): number {
  for (let k = 0; k < prev.length; k++) {
    if (curr.startsWith(prev.slice(k))) return prevStart + k;
  }
  const fp = curr.slice(0, Math.min(40, curr.length));
  const inPrev = prev.indexOf(fp);
  if (inPrev >= 0) return prevStart + inPrev;
  const inSource = source.indexOf(fp, prevStart);
  return inSource >= 0 ? inSource : prevStart;
}

function nextSearchHint(current: string, next: string, currentStart: number): number {
  for (let k = 1; k < current.length; k++) {
    if (next.startsWith(current.slice(k))) return currentStart + k;
  }
  return currentStart + 1;
}
