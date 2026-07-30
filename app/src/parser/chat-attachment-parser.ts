import { extname } from 'path';
import type { PDFParse as PDFParseType, TextResult } from 'pdf-parse';

export interface ParsedAttachment {
  filename: string;
  text: string;
  truncated: boolean;
}

const MAX_TEXT_CHARS = 24000;
const ALLOWED_EXTS = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.markdown', '.csv', '.log']);

/**
 * pdf-parse v2 依赖 pdfjs-dist，后者在模块加载时会直接执行 `new DOMMatrix()` 等
 * 浏览器全局对象。Bun/Node 环境没有这些全局，会导致模块加载即崩溃。
 * 文本提取路径本身不依赖真正的渲染能力，提供最小桩即可。
 */
function ensurePdfDomPolyfills(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.DOMMatrix) return;
  class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
  }
  class DOMRect {
    x = 0; y = 0; width = 0; height = 0;
    get top() { return 0; }
    get bottom() { return 0; }
    get left() { return 0; }
    get right() { return 0; }
  }
  g.DOMMatrix = DOMMatrix;
  g.DOMRect = DOMRect;
  g.ImageData = class ImageData {};
  g.Path2D = class Path2D {};
}

let pdfCtor: typeof PDFParseType | null = null;
async function getPdfParse(): Promise<typeof PDFParseType> {
  if (pdfCtor) return pdfCtor;
  ensurePdfDomPolyfills();
  const mod = await import('pdf-parse');
  pdfCtor = (mod as { PDFParse: typeof PDFParseType }).PDFParse;
  return pdfCtor;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const PDFParse = await getPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result: TextResult = await parser.getText();
    return result.text ?? '';
  } finally {
    try { await parser.destroy(); } catch { /* ignore */ }
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

function lightNormalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isSupportedAttachment(filename: string): boolean {
  return ALLOWED_EXTS.has(extname(filename).toLowerCase());
}

export async function parseChatAttachment(filename: string, buffer: Buffer): Promise<ParsedAttachment> {
  const ext = extname(filename).toLowerCase();
  let raw = '';

  if (ext === '.pdf') {
    raw = await extractPdf(buffer);
  } else if (ext === '.docx' || ext === '.doc') {
    raw = await extractDocx(buffer);
  } else if (ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '.csv' || ext === '.log') {
    raw = buffer.toString('utf8');
  } else {
    throw new Error(`暂不支持的文件类型 ${ext}，支持 PDF / Word / 文本`);
  }

  let text = lightNormalize(raw);
  let truncated = false;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }

  if (!text) {
    throw new Error('文件解析后未得到任何文本内容（可能是扫描件或空文件）');
  }

  return { filename, text, truncated };
}
