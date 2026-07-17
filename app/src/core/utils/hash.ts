import { createHash } from 'crypto';

/** 对字符串做 SHA-256，返回 hex */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 对文件做 SHA-256，返回 hex（流式读取大文件不会爆内存） */
export async function fileHash(filePath: string): Promise<string> {
  const stream = Bun.file(filePath).stream();
  const hasher = createHash('sha256');
  for await (const chunk of stream) {
    hasher.update(chunk as Buffer);
  }
  return hasher.digest('hex');
}
