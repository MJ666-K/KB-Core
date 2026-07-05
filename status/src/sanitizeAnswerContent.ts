/** 回答展示前去掉系统级冗余提示（页脚已有统一免责声明） */
export function sanitizeAnswerContent(content: string): string {
  const patterns = [
    /^未检索到相关法律条文[。.]?\s*$/gm,
    /^以下回答未基于知识库检索[，,].*?请咨询专业律师[。.]?\s*$/gm,
    /^知识库检索未获得可用法律条文[。.]?\s*$/gm,
  ];

  let text = content;
  for (const re of patterns) {
    text = text.replace(re, '');
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}
