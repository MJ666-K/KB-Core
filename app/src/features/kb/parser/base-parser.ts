import type { Document } from '@core/shared/document';

export interface BaseParser {
  parse(filePath: string): Promise<Document>;
  supportedTypes: readonly string[];
}
