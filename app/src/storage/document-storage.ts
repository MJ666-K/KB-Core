import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import OSS from 'ali-oss';
import { config } from '../config';
import { logger } from '../utils/logger';

/** DB 中 OSS 路径前缀：oss:knowledge_core/xxx.txt */
export const OSS_SCHEME = 'oss:';

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

export async function readDocumentText(sourcePath: string): Promise<string> {
  if (isOssSourcePath(sourcePath)) {
    const result = await getOssClient().get(ossObjectKey(sourcePath));
    const body = result.content;
    if (Buffer.isBuffer(body)) return body.toString('utf-8');
    if (typeof body === 'string') return body;
    return Buffer.from(body as ArrayBuffer).toString('utf-8');
  }

  return readFile(localPath(sourcePath), 'utf-8');
}

export async function hashSourcePath(sourcePath: string): Promise<string> {
  const text = await readDocumentText(sourcePath);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
