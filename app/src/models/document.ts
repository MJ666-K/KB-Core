export interface DocumentData {
  title: string;
  content: string;
  source: string;
  docType: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

export class Document implements DocumentData {
  title: string;
  content: string;
  source: string;
  docType: string;
  category?: string;
  metadata: Record<string, unknown>;

  constructor(data: DocumentData) {
    this.title = data.title;
    this.content = data.content;
    this.source = data.source;
    this.docType = data.docType;
    this.category = data.category;
    this.metadata = data.metadata ?? {};
  }

  get charCount(): number {
    return this.content.replace(/\s/g, '').length;
  }
}
