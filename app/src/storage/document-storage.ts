import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { asc, eq } from 'drizzle-orm';
import OSS from 'ali-oss';
import { config } from '../config';
import { db } from '../db/client';
import { chunks } from '../db/schema';
import { logger } from '../utils/logger';

/** DB 中 OSS 路径前缀：oss:knowledge_core/xxx.txt */
export const OSS_SCHEME = 'oss:';

/** KG 虚拟文档：内容在 chunks 表，无物理文件 */
export const KG_SCHEME = 'kg://';

export function isKgSourcePath(sourcePath: string): boolean {
  return sourcePath.startsWith(KG_SCHEME);
}

let ossClient: OSS | null = null;

function getOssClient(): OSS {
  if (!ossClient) {
    if (!config.ossEnabled) throw new Error('OSS is not configured');
    ossClient = new OSS({
      accessKeyId: config.ossAccessKeyId!,
      accessKeySecret: config.ossAccessKeySecret!,
      bucket: config.ossBucketName!,
      endpoint: config.ossEndpoint!.replace(/^https?:\/\//, ''),
      secure: config.ossEndpoint!.startsWith('https'),
    });
  }
  return ossClient;
}

export function isOssSourcePath(sourcePath: string): boolean {
  return sourcePath.startsWith(OSS_SCHEME);
}

function ossObjectKey(sourcePath: string): string {
  return sourcePath.slice(OSS_SCHEME.length);
}

function localPath(sourcePath: string): string {
  return sourcePath.startsWith('./') ? sourcePath : `./documents/${sourcePath}`;
}

export function hashBuffer(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex');
}

/** 保存上传文件，返回写入 DB 的 sourcePath */
export async function saveDocumentFile(safeName: string, buffer: ArrayBuffer): Promise<string> {
  if (config.ossEnabled) {
    const key = `${config.ossPrefix}${safeName}`;
    await getOssClient().put(key, Buffer.from(buffer));
    logger.info('[Storage] Uploaded to OSS', { key });
    return `${OSS_SCHEME}${key}`;
  }

  const filePath = `./documents/${safeName}`;
  await Bun.write(filePath, buffer);
  return filePath;
}

export async function readKgDocumentText(documentId: string): Promise<string> {
  const rows = await db.select({ content: chunks.content })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.parentChunkIndex), asc(chunks.childIndexWithinParent));
  if (rows.length === 0) {
    throw new Error(`KG document has no chunks: ${documentId}`);
  }
  return rows.map(r => r.content).join('\n\n');
}

export async function readDocumentText(
  sourcePath: string,
  opts?: { documentId?: string },
): Promise<string> {
  if (isKgSourcePath(sourcePath)) {
    if (!opts?.documentId) {
      throw new Error(`documentId required for kg source: ${sourcePath}`);
    }
    return readKgDocumentText(opts.documentId);
  }

  if (isOssSourcePath(sourcePath)) {
    const result = await getOssClient().get(ossObjectKey(sourcePath));
    const body = result.content;
    if (Buffer.isBuffer(body)) return body.toString('utf-8');
    if (typeof body === 'string') return body;
    return Buffer.from(body as ArrayBuffer).toString('utf-8');
  }

  return readFile(localPath(sourcePath), 'utf-8');
}

export async function hashSourcePath(sourcePath: string, opts?: { documentId?: string }): Promise<string> {
  const text = await readDocumentText(sourcePath, opts);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
