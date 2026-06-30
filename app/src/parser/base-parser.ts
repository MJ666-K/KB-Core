import type { Document } from '../models/document';

export interface BaseParser {
  parse(filePath: string): Promise<Document>;
  supportedTypes: readonly string[];
}
