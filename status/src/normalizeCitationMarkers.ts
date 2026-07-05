/** 将误放在段首的 [1] 《法条标题》 调整为标题在前、编号在段末 */
export function normalizeCitationMarkers(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = line.match(/^\[(\d+)\]\s*(.+)$/);
    const isBlockCitation = m && (m[2].includes('《') || m[2].includes('第') && m[2].includes('条'));

    if (isBlockCitation && m) {
      const num = m[1];
      out.push(m[2].trim());
      i++;

      if (i < lines.length && lines[i] === '') {
        out.push('');
        i++;
      }

      const body: string[] = [];
      while (i < lines.length) {
        const next = lines[i] ?? '';
        if (/^\[\d+\]\s*/.test(next)) break;
        body.push(next);
        i++;
      }

      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      if (body.length > 0) {
        out.push(...body);
        out.push('');
      }
      out.push(`[${num}]`);
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join('\n');
}
