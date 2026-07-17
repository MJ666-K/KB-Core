import { basename } from 'path';
import type { BaseParser } from './base-parser';
import { Document } from '@core/shared/document';
import { readDocumentText } from '@infra/storage/document-storage';
import { normalizeDocumentContent } from '@core/utils/text-normalize';

const CN_NUM = '[一二三四五六七八九十百千零〇两]';
const STRUCTURE_RE = new RegExp(`第${CN_NUM}+(?:编|章|节|条)`, 'g');

/** 启发式识别法律文档：文件名或正文命中足够多层级标记 */
function detectLawDoc(base: string, content: string): boolean {
  if (/中华人民共和国/.test(base)) return true;
  // 至少 3 个「第X{编/章/节/条}」标记
  const matches = content.match(STRUCTURE_RE);
  return !!matches && matches.length >= 3;
}

export class TxtParser implements BaseParser {
  readonly supportedTypes = ['txt'] as const;

  async parse(sourcePath: string): Promise<Document> {
    const content = normalizeDocumentContent(await readDocumentText(sourcePath));
    const base = basename(sourcePath).replace(/\.[^.]+$/, '');
    const title = base.replace(/^\d+-/, '');
    const docType = detectLawDoc(base, content) ? 'law' : 'general';
    return new Document({
      title,
      content,
      source: sourcePath,
      docType,
    });
  }
}
