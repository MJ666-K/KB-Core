/** 入库切分前规范化：统一换行并去除空行（保留非空行顺序） */
export function normalizeDocumentContent(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}
