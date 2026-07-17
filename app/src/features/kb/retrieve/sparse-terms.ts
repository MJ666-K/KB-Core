/** 从查询中提取可用于稀疏匹配的关键词（中文短语 + 英文/数字） */
export function extractSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  const trimmed = query.trim();
  if (!trimmed) return [];

  // 中文连续词组（2~12 字，覆盖「劳动合同法」「加班费」等）
  for (const m of trimmed.match(/[\u4e00-\u9fff]{2,12}/g) ?? []) {
    terms.add(m);
    // 较长短语再拆 4 字窗口，提高部分命中概率
    if (m.length > 4) {
      for (let i = 0; i <= m.length - 4; i++) {
        terms.add(m.slice(i, i + 4));
      }
    }
  }

  // 英文/数字词
  for (const w of trimmed.match(/[a-zA-Z0-9]{2,}/g) ?? []) {
    terms.add(w.toLowerCase());
  }

  // 按长度降序，优先长短语
  return [...terms].sort((a, b) => b.length - a.length).slice(0, 16);
}
