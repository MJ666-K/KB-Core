/** 清除回答中不应展示给用户的内部占位符 */
export function sanitizeUserFacingAnswer(content: string): string {
  if (!content) return content;
  return content
    .replace(/\{\{kg:[^}]+\}\}/g, '')
    .replace(/\{\{chunk:[^}]+\}\}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
