import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { TxtParser } from '../src/parser/txt-parser';

const tmpDir = './tests/tmp';

beforeEach(async () => mkdir(tmpDir, { recursive: true }));
afterEach(async () => rm(tmpDir, { recursive: true, force: true }));

describe('TxtParser', () => {
  it('解析 txt 文件', async () => {
    const filePath = `${tmpDir}/hello.txt`;
    await Bun.write(filePath, 'Hello 世界');
    const parser = new TxtParser();
    const doc = await parser.parse(filePath);
    expect(doc.title).toBe('hello');
    expect(doc.content).toBe('Hello 世界');
    expect(doc.docType).toBe('general');
  });

  it('空文件也能解析', async () => {
    const filePath = `${tmpDir}/empty.txt`;
    await Bun.write(filePath, '');
    const parser = new TxtParser();
    const doc = await parser.parse(filePath);
    expect(doc.content).toBe('');
  });
});
