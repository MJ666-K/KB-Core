/**
 * 自包含测试：启动服务 → 跑全部测试 → 关服务 → 写报告
 * 用法：bun tests/run-all.ts
 */
import { spawn } from 'child_process';

const API = 'http://localhost:3000';
const APP_DIR = '/home/mingjie-li/code/KB-Core/app';
const REPORT_PATH = '/home/mingjie-li/code/KB-Core/docs/tests/test-report-v2.md';

interface Testcase {
  id: string;
  question: string;
  expectKeyword?: string;
}

const TESTS: Testcase[] = [
  { id: 'chat-1', question: '你好' },
  { id: 'chat-2', question: '你能帮我做什么？' },
  { id: 'qa-1', question: '劳动合同法第三十九条规定了什么？', expectKeyword: '第三十九条|第39条|过失性辞退|解除劳动合同' },
  { id: 'qa-2', question: '公司法关于法定代表人有什么规定？', expectKeyword: '法定代表人|民法典|第六十一条' },
  { id: 'qa-3', question: '社会保险法规定了哪些社会保险种类？', expectKeyword: '养老|医疗|工伤|失业|生育' },
  { id: 'qa-4', question: '用人单位违法解除劳动合同应该怎么赔偿？', expectKeyword: '赔偿|双倍|经济补偿|第八十七条' },
  { id: 'search-1', question: '搜索经济补偿相关的法条', expectKeyword: '经济补偿|劳动' },
  { id: 'search-2', question: '检索民法典合同编关于违约责任的规定', expectKeyword: '违约|五百七十七|577' },
  { id: 'summary-1', question: '总结劳动合同法的核心要点' },
  { id: 'compare-1', question: '对比劳动合同法和劳动法在合同解除方面的区别' },
  { id: 'multihop-1', question: '违法解除劳动合同怎么赔偿？依据哪条法律？为什么设定双倍赔偿标准？' },
];

interface Result {
  id: string;
  question: string;
  answer: string;
  termination: string;
  latencyMs: number;
  passed: boolean;
  keywordMatch: boolean;
  error?: string;
}

async function waitForServer(maxWait = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function runQuery(question: string, _datasetId: string, timeout = 120000): Promise<{ answer: string; termination: string; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json() as { answer: string; termination: string };
    return {
      answer: data.answer ?? '',
      termination: data.termination ?? 'unknown',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      answer: '',
      termination: 'error',
      latencyMs: Date.now() - start,
    };
  }
}

function generateReport(results: Result[]): string {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const passRate = ((passed / total) * 100).toFixed(1);
  const keywordPassed = results.filter(r => r.keywordMatch).length;

  let md = `# KB-Core 法律知识库测试报告 v2\n\n`;
  md += `> 测试时间：${new Date().toISOString()}\n`;
  md += `> 测试数据：23 部法律法规，1089 chunks\n\n`;
  md += `## 总览\n\n| 指标 | 值 |\n|---|---|\n`;
  md += `| 测试用例 | ${total} |\n| 通过 | ${passed}（${passRate}%）|\n`;
  md += `| 关键词命中 | ${keywordPassed}/${total}\n\n`;
  md += `## v1 → v2 改进\n\n`;
  md += `| 改进项 | v1 | v2 |\n|---|---|---|\n`;
  md += `| Reranker | 禁用（404） | DashScope 原生 API（gte-rerank） |\n`;
  md += `| LLM/Embedding 重试 | 无 | 3 次指数退避 |\n`;
  md += `| 服务启动等待 | 5 秒 | 30 秒健康检查 |\n\n`;
  md += `## 详细结果\n\n| ID | 问题 | 耗时(s) | 终止 | 长度 | 关键词 | 状态 |\n|---|---|---|---|---|---|---|\n`;

  for (const r of results) {
    const q = r.question.slice(0, 25);
    const sec = (r.latencyMs / 1000).toFixed(1);
    const kw = r.keywordMatch ? '✅' : r.error ? '—' : '❌';
    const status = r.passed ? '✅' : '❌';
    md += `| ${r.id} | ${q}... | ${sec} | ${r.termination} | ${r.answer.length} | ${kw} | ${status} |\n`;
  }

  md += `\n## 答案摘要\n\n`;
  for (const r of results) {
    md += `### ${r.id}: ${r.question}\n`;
    md += `- **耗时**: ${(r.latencyMs / 1000).toFixed(1)}s | **终止**: ${r.termination} | **长度**: ${r.answer.length}字\n`;
    if (r.answer) {
      md += `- **回答**: ${r.answer.slice(0, 300).replace(/\n/g, ' ')}...\n\n`;
    } else {
      md += `- **回答**: （空）${r.error ?? ''}\n\n`;
    }
  }

  return md;
}

async function main() {
  console.log('=== 1. 启动服务 ===');
  const server = spawn('bun', ['src/index.ts'], {
    cwd: APP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  server.stdout?.on('data', (d) => process.stdout.write(d));
  server.stderr?.on('data', (d) => process.stderr.write(d));

  console.log('等待服务就绪...');
  const ready = await waitForServer(30000);
  if (!ready) {
    console.error('❌ 服务启动失败');
    server.kill('SIGKILL');
    process.exit(1);
  }
  console.log('✅ 服务就绪');

  console.log('\n=== 2. 获取 dataset UUID ===');
  let datasetId = '';
  try {
    const { db } = await import(`${APP_DIR}/src/db/client.ts`);
    const { datasets } = await import(`${APP_DIR}/src/db/schema.ts`);
    const { eq } = await import('drizzle-orm');
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.name, 'default') });
    datasetId = ds?.id ?? '';
  } catch {
  }
  if (!datasetId) {
    const pgRes = await fetch('http://localhost:3000/documents?limit=1');
    if (pgRes.ok) {
      const docs = await pgRes.json() as { documents: Array<{ id: string }> };
    }
  }
  console.log(`datasetId: ${datasetId || '(empty - will use query default)'}`);

  console.log('\n=== 3. 运行测试 ===');
  const results: Result[] = [];

  for (const tc of TESTS) {
    process.stdout.write(`[${tc.id}] ${tc.question.slice(0, 30)}... `);
    const body: Record<string, unknown> = { question: tc.question };
    if (datasetId) body.datasetId = datasetId;

    const r = await runQuery(tc.question, datasetId);
    const keywordMatch = tc.expectKeyword
      ? new RegExp(tc.expectKeyword).test(r.answer)
      : r.answer.length > 10;
    const passed = r.answer.length > 10;

    results.push({
      id: tc.id,
      question: tc.question,
      answer: r.answer,
      termination: r.termination,
      latencyMs: r.latencyMs,
      passed,
      keywordMatch,
    });

    console.log(`${passed ? '✅' : '❌'} ${(r.latencyMs / 1000).toFixed(1)}s ${r.termination} ${r.answer.length}字 ${keywordMatch ? '🔑' : ''}`);
  }

  console.log('\n=== 4. 关闭服务 ===');
  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n=== 5. 生成报告 ===');
  const report = generateReport(results);
  await Bun.write(REPORT_PATH, report);

  const passed = results.filter(r => r.passed).length;
  console.log(`\n📊 结果: ${passed}/${results.length} 通过 (${((passed / results.length) * 100).toFixed(1)}%)`);
  console.log(`📄 报告: ${REPORT_PATH}`);

  server.kill('SIGKILL');
}

main().catch(console.error);
