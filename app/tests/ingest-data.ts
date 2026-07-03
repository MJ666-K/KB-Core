import { readdir } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = join(import.meta.dir, '..', '..', 'data');
const DATASET = process.env.DATASET ?? 'legal';
const BASE_URL = process.env.KB_URL ?? 'http://localhost:3000';

async function ingestFile(filePath: string, fileName: string): Promise<{ docId?: string; status: string }> {
  const file = Bun.file(filePath);
  const form = new FormData();
  form.append('file', new Blob([await file.arrayBuffer()]), fileName);
  form.append('dataset', DATASET);

  const res = await fetch(`${BASE_URL}/ingest`, { method: 'POST', body: form });
  return res.json();
}

async function main() {
  const files = (await readdir(DATA_DIR)).filter(f => f.endsWith('.txt'));
  console.log(`\n📚 Found ${files.length} legal documents in ${DATA_DIR}\n`);

  let ok = 0;
  let fail = 0;

  for (const f of files) {
    const fp = join(DATA_DIR, f);
    try {
      const result = await ingestFile(fp, f);
      const icon = result.status === 'error' ? '❌' : '✅';
      console.log(`${icon} ${f.padEnd(30)} → ${result.status} ${result.docId ?? ''}`);
      if (result.status === 'error') fail++; else ok++;
    } catch (err) {
      console.log(`❌ ${f.padEnd(30)} → ${(err as Error).message}`);
      fail++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Ingested: ${ok}  ❌ Failed: ${fail}  Total: ${files.length}`);
}

main();
