import type { BaseParser } from './base-parser';

export class ParserRegistry {
  private parsers = new Map<string, BaseParser>();

  register(parser: BaseParser): void {
    for (const type of parser.supportedTypes) {
      if (this.parsers.has(type)) {
        throw new Error(`Parser for type '${type}' already registered`);
      }
      this.parsers.set(type, parser);
    }
  }

  getParser(fileType: string): BaseParser {
    const parser = this.parsers.get(fileType.toLowerCase());
    if (!parser) {
      throw new Error(
        `No parser for type '${fileType}'. Supported: ${[...this.parsers.keys()].join(', ')}`,
      );
    }
    return parser;
  }

  supportedTypes(): string[] {
    return [...this.parsers.keys()];
  }
}
