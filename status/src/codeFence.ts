/**
 * 围栏代码块（fenced code block）切分与重组工具。
 *
 * 用于在「处理整段 Markdown 文本」时安全地跳过代码块内部：
 * 例如把 `[1]` 替换成引用链接、清洗泄露内容等，只作用于正文，
 * 避免破坏 mermaid / 代码块里的合法语法。
 */

export interface CodeSegment {
  text: string;
  isCode: boolean;
  lang: string;
}

const FENCE_RE = /(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n?`{3,}/g;

export function splitCodeFences(content: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  FENCE_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content)) !== null) {
    const leading = m[1] ?? '';
    const textBefore = content.slice(last, m.index + leading.length);
    if (textBefore) segments.push({ text: textBefore, isCode: false, lang: '' });
    segments.push({ text: m[4] ?? '', isCode: true, lang: (m[3] ?? '').trim() });
    last = FENCE_RE.lastIndex;
  }
  const tail = content.slice(last);
  if (tail) segments.push({ text: tail, isCode: false, lang: '' });
  return segments;
}

export function joinCodeFences(segments: CodeSegment[]): string {
  return segments
    .map(seg => (seg.isCode && seg.text ? `\`\`\`${seg.lang}\n${seg.text}\n\`\`\`` : seg.text))
    .join('');
}

export function mapCodeFences(
  content: string,
  proseFn: (text: string) => string,
  codeFn: (code: string, lang: string) => string = (code) => code,
): string {
  const segs = splitCodeFences(content).map(seg =>
    seg.isCode
      ? { ...seg, text: codeFn(seg.text, seg.lang) }
      : { ...seg, text: proseFn(seg.text) },
  );
  return joinCodeFences(segs);
}
