/**
 * KB-Core 入库验证测试脚本
 * 
 * 功能：
 * 1. 扫描 ../data/ 目录下的所有 .txt 文件
 * 2. 批量上传到 /ingest 接口
 * 3. 等待入库完成（status='ready'）
 * 4. 验证每个文档的 chunks 数量、embedding 生成情况
 * 
 * 运行：bun tests/ingest-validation.ts
 */

import { db } from '../src/db/client';
import { documents, chunks } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../src/utils/logger';
import { Glob } from 'bun';

const API_URL = process.env.KB_API_URL ?? 'http://localhost:3000';
const DATA_DIR = '../data';
const DATASET_NAME = 'legal-test';

interface IngestResult {
  fileName: string;
  docId?: string;
  status: string;
  chunksCount?: number;
  embeddedCount?: number;
  error?: string;
  duration?: number;
}

async function main() {
  console.log('=== KB-Core 入库验证测试 ===\n');
  console.log(`API: ${API_URL}`);
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Dataset: ${DATASET_NAME}\n`);

  // 1. 扫描 data 目录
  const glob = new Glob('*.txt');
  const files: string[] = [];
  for await (const file of glob.scan(DATA_DIR)) {
    files.push(file);
  }

  console.log(`发现 ${files.length} 个文件需要入库\n`);

  if (files.length === 0) {
    console.log('⚠️  没有找到文件，跳过入库测试');
    return;
  }

  // 2. 批量入库
  console.log('开始批量入库...');
  const results: IngestResult[] = [];

  for (const fileName of files) {
    const filePath = `${DATA_DIR}/${fileName}`;
    const startTime = Date.now();

    try {
      const file = Bun.file(filePath);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('dataset', DATASET_NAME);

      const response = await fetch(`${API_URL}/ingest`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        results.push({
          fileName,
          status: 'failed',
          error: `HTTP ${response.status}: ${error}`,
          duration: Date.now() - startTime,
        });
        console.log(`❌ ${fileName}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as { docId?: string; status: string };
      results.push({
        fileName,
        docId: data.docId,
        status: data.status,
        duration: Date.now() - startTime,
      });

      console.log(`✅ ${fileName}: ${data.status} (${Date.now() - startTime}ms)`);
    } catch (err) {
      results.push({
        fileName,
        status: 'error',
        error: String(err),
        duration: Date.now() - startTime,
      });
      console.log(`❌ ${fileName}: ${err}`);
    }
  }

  console.log('\n入库完成，等待处理...\n');

  // 3. 等待入库完成
  console.log('等待 Worker 处理...');
  const pendingDocs = results.filter(r => r.status === 'pending');
  
  if (pendingDocs.length > 0) {
    // 等待最多 5 分钟
    const maxWait = 5 * 60 * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const readyCount = await checkDocumentsReady(pendingDocs);
      console.log(`进度: ${readyCount}/${pendingDocs.length} 已完成`);

      if (readyCount === pendingDocs.length) {
        break;
      }

      await sleep(5000);
    }
  }

  // 4. 验证入库结果
  console.log('\n验证入库结果...\n');
  await verifyIngestResults(results);

  // 5. 生成报告
  const report = generateIngestReport(results);
  const reportPath = '../docs/tests/ingest-report.md';
  await Bun.write(reportPath, report);
  console.log(`\n📊 入库报告已保存: ${reportPath}`);
}

async function checkDocumentsReady(docs: IngestResult[]): Promise<number> {
  let readyCount = 0;

  for (const doc of docs) {
    if (!doc.docId) continue;

    try {
      const result = await db.query.documents.findFirst({
        where: eq(documents.id, doc.docId),
      });

      if (result && result.status === 'ready') {
        doc.status = 'ready';
        readyCount++;
      }
    } catch (err) {
      logger.error(`查询文档状态失败: ${doc.docId}`, err);
    }
  }

  return readyCount;
}

async function verifyIngestResults(results: IngestResult[]) {
  for (const result of results) {
    if (!result.docId) continue;

    try {
      // 查询文档状态
      const doc = await db.query.documents.findFirst({
        where: eq(documents.id, result.docId),
      });

      if (!doc) {
        result.error = '文档不存在';
        console.log(`❌ ${result.fileName}: 文档不存在`);
        continue;
      }

      // 查询 chunks
      const docChunks = await db.query.chunks.findMany({
        where: eq(chunks.documentId, result.docId),
      });

      result.chunksCount = docChunks.length;
      result.embeddedCount = docChunks.filter(c => c.embedding !== null).length;

      if (doc.status !== 'ready') {
        result.error = `状态异常: ${doc.status}`;
        console.log(`⚠️  ${result.fileName}: ${doc.status}`);
      } else if (result.chunksCount === 0) {
        result.error = '无 chunks';
        console.log(`❌ ${result.fileName}: 无 chunks`);
      } else if (result.embeddedCount === 0) {
        result.error = '无 embedding';
        console.log(`❌ ${result.fileName}: 无 embedding`);
      } else {
        console.log(`✅ ${result.fileName}: ${result.chunksCount} chunks, ${result.embeddedCount} embedded`);
      }
    } catch (err) {
      result.error = String(err);
      console.log(`❌ ${result.fileName}: 验证失败 - ${err}`);
    }
  }
}

function generateIngestReport(results: IngestResult[]): string {
  const total = results.length;
  const success = results.filter(r => r.status === 'ready' && !r.error).length;
  const failed = results.filter(r => r.error).length;
  const totalChunks = results.reduce((sum, r) => sum + (r.chunksCount ?? 0), 0);
  const totalEmbedded = results.reduce((sum, r) => sum + (r.embeddedCount ?? 0), 0);

  let md = `# KB-Core 入库验证报告\n\n`;
  md += `> 测试时间：${new Date().toISOString()}\n`;
  md += `> 数据目录：${DATA_DIR}\n`;
  md += `> 目标 Dataset：${DATASET_NAME}\n\n`;

  md += `## 总览\n\n`;
  md += `| 指标 | 值 |\n|---|---|\n`;
  md += `| 总文件数 | ${total} |\n`;
  md += `| 成功入库 | ${success} |\n`;
  md += `| 失败 | ${failed} |\n`;
  md += `| 总 chunks | ${totalChunks} |\n`;
  md += `| 已 embedding | ${totalEmbedded} |\n`;
  md += `| 入库成功率 | ${((success / total) * 100).toFixed(1)}% |\n`;
  md += `| Embedding 率 | ${((totalEmbedded / totalChunks) * 100).toFixed(1)}% |\n\n`;

  md += `## 详细结果\n\n`;
  md += `| 文件名 | 状态 | Chunks | Embedded | 耗时(ms) | 错误 |\n`;
  md += `|---|---|---|---|---|---|\n`;

  for (const r of results) {
    const status = r.error ? `❌ ${r.status}` : `✅ ${r.status}`;
    const chunks = r.chunksCount ?? '-';
    const embedded = r.embeddedCount ?? '-';
    const duration = r.duration ?? '-';
    const error = r.error ?? '';
    md += `| ${r.fileName} | ${status} | ${chunks} | ${embedded} | ${duration} | ${error} |\n`;
  }

  md += `\n## 问题分析\n\n`;

  const failures = results.filter(r => r.error);
  if (failures.length > 0) {
    md += `### 失败文件\n\n`;
    for (const f of failures) {
      md += `- **${f.fileName}**: ${f.error}\n`;
    }
  } else {
    md += `✅ 所有文件入库成功，无错误。\n`;
  }

  return md;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('入库验证失败:', err);
  process.exit(1);
});