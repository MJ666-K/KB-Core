export function resolveChunkRange(
  original: string,
  chunk: { content: string; startOffset: number | null; endOffset: number | null },
): { start: number; end: number; aligned: boolean } {
  const start = chunk.startOffset ?? 0;
  const end = chunk.endOffset ?? start + chunk.content.length;

  if (original.slice(start, end) === chunk.content) {
    return { start, end, aligned: true };
  }

  const hint = Math.max(0, start - 200);
  const near = original.indexOf(chunk.content, hint);
  if (near >= 0) {
    return { start: near, end: near + chunk.content.length, aligned: true };
  }

  const any = original.indexOf(chunk.content);
  if (any >= 0) {
    return { start: any, end: any + chunk.content.length, aligned: false };
  }

  return { start, end, aligned: false };
}
