import { basename } from 'path';
import type { BaseParser } from './base-parser';
import { Document } from '../models/document';

export class TxtParser implements BaseParser {
  readonly supportedTypes = ['txt'] as const;

  async parse(filePath: string): Promise<Document> {
    const content = await Bun.file(filePath).text();
    const title = basename(filePath, '.txt');
    return new Document({
      title,
      content,
      source: filePath,
      docType: 'general',
    });
  }
}
