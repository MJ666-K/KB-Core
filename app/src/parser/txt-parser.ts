import { basename } from 'path';
import type { BaseParser } from './base-parser';
import { Document } from '../models/document';
import { readDocumentText } from '../storage/document-storage';
import { normalizeDocumentContent } from '../utils/text-normalize';

export class TxtParser implements BaseParser {
  readonly supportedTypes = ['txt'] as const;

  async parse(sourcePath: string): Promise<Document> {
    const content = normalizeDocumentContent(await readDocumentText(sourcePath));
    const base = basename(sourcePath).replace(/\.[^.]+$/, '');
    const title = base.replace(/^\d+-/, '');
    return new Document({
      title,
      content,
      source: sourcePath,
      docType: 'general',
    });
  }
}
