/**
 * KB-Core 法律知识库全量测试脚本
 * 覆盖 6 个 Skill + 各种法律场景
 * 
 * 运行：bun tests/e2e-legal.test.ts
 */
import { describe, it, expect, afterAll } from 'bun:test';

const API = 'http://localhost:3000';

interface QueryResult {
  answer: string;
  citations: Array<{ chunkId: string; documentId: string; documentTitle: string; excerpt: string; score: number; }>;
  steps: Array<{ iteration: number; thought: string; action: string; }>;
  toolCalls: Array<{ name: string; kind: string; }>;
  latencyMs: number;
  termination: string;
}

async function query(question: string): Promise<QueryResult> {
  const res = await fetch(`${API}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }, 120000);
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return await res.json() as QueryResult;
}

// ===== 测试用例 =====

describe('法律知识库 E2E 测试', () => {
  const results: Array<{ id: string; question: string; result: QueryResult | null; error?: string; }> = [];

  // 辅助：记录结果用于报告生成
  async function run(id: string, q: string): Promise<QueryResult> {
    try {
      const r = await query(q);
      results.push({ id, question: q, result: r });
      return r;
    } catch (e) {
      results.push({ id, question: q, result: null, error: String(e) });
      throw e;
    }
  }

  // 后置：在所有测试后生成报告
  afterAll(async () => {
    const report = generateReport(results);
    const path = `${import.meta.dir}/../../docs/tests/test-report-v1.md`;
    await Bun.write(path, report);
    console.log(`\n📊 Test report saved to: ${path}`);
  });
  it('Chat: 问候', async () => {
    const r = await run('chat-1', '你好');
    expect(r.answer).toBeTruthy();
    expect(r.answer.length).toBeGreaterThan(10);
  }, 120000);

  it('Chat: 能力咨询', async () => {
    const r = await run('chat-2', '你能帮我做什么？');
    expect(r.answer).toBeTruthy();
  }, 120000);

  // ===== QA Skill =====
  it('QA: 劳动合同法第39条', async () => {
    const r = await run('qa-1', '劳动合同法第三十九条规定了什么？');
    expect(r.answer).toBeTruthy();
    expect(r.answer).toMatch(/第三十九条|第39条|39/);
  }, 120000);

  it('QA: 公司法法定代表人', async () => {
    const r = await run('qa-2', '公司法关于法定代表人有什么规定？');
    expect(r.answer).toBeTruthy();
    expect(r.answer.length).toBeGreaterThan(50);
  }, 120000);

  it('QA: 社会保险法五险', async () => {
    const r = await run('qa-3', '社会保险法规定了哪些社会保险种类？');
    expect(r.answer).toBeTruthy();
  }, 120000);

  it('QA: 违法解除赔偿', async () => {
    const r = await run('qa-4', '用人单位违法解除劳动合同应该怎么赔偿？');
    expect(r.answer).toBeTruthy();
    expect(r.answer).toMatch(/赔偿|双倍|经济补偿/);
  }, 120000);

  // ===== Search Skill =====
  it('Search: 经济补偿条文', async () => {
    const r = await run('search-1', '搜索经济补偿相关的法条');
    expect(r.answer).toBeTruthy();
  }, 120000);

  it('Search: 民法典合同编', async () => {
    const r = await run('search-2', '检索民法典合同编关于违约责任的规定');
    expect(r.answer).toBeTruthy();
  }, 120000);

  // ===== Summary Skill =====
  it('Summary: 劳动合同法核心', async () => {
    const r = await run('summary-1', '总结劳动合同法的核心要点');
    expect(r.answer).toBeTruthy();
    expect(r.answer.length).toBeGreaterThan(100);
  }, 120000);

  it('Summary: 公司法股东权利', async () => {
    const r = await run('summary-2', '总结公司法关于股东权利的规定');
    expect(r.answer).toBeTruthy();
  }, 120000);

  // ===== Compare Skill =====
  it('Compare: 劳动合同法 vs 劳动法', async () => {
    const r = await run('compare-1', '对比劳动合同法和劳动法在合同解除方面的区别');
    expect(r.answer).toBeTruthy();
  }, 120000);

  // ===== Multihop Skill =====
  it('Multihop: 违法解除深度分析', async () => {
    const r = await run('multihop-1', '违法解除劳动合同怎么赔偿？依据哪条法律？为什么设定双倍赔偿标准？');
    expect(r.answer).toBeTruthy();
    expect(r.answer.length).toBeGreaterThan(100);
  }, 120000); // 给 2 分钟超时

  it('Multihop: 公司税务交叉', async () => {
    const r = await run('multihop-2', '公司股权转让需要缴纳哪些税？涉及哪些法律？');
    expect(r.answer).toBeTruthy();
  }, 120000);
});

function generateReport(results: Array<{ id: string; question: string; result: QueryResult | null; error?: string; }>): string {
  const passed = results.filter(r => r.result !== null).length;
  const failed = results.filter(r => r.result === null).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  let md = `# KB-Core 法律知识库测试报告 v1\n\n`;
  md += `> 测试时间：${new Date().toISOString()}\n`;
  md += `> 测试文档：23 部法律法规（民法典、公司法、劳动合同法等）\n`;
  md += `> 知识库统计：1089 chunks（895 embedded）\n\n`;
  md += `## 总览\n\n`;
  md += `| 指标 | 值 |\n|---|---|\n`;
  md += `| 测试用例总数 | ${total} |\n`;
  md += `| 通过（有结果返回） | ${passed} |\n`;
  md += `| 失败（API 错误） | ${failed} |\n`;
  md += `| 通过率 | ${passRate}% |\n\n`;

  md += `## 详细结果\n\n`;
  md += `| ID | 问题 | 终止路径 | 耗时(ms) | 引用数 | 答案长度 | Skill/Tool 调用 | 状态 |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    if (r.result) {
      const skills = r.result.toolCalls.map(t => t.name).join(', ') || 'none';
      const ansLen = r.result.answer.length;
      const citeCount = r.result.citations.length;
      md += `| ${r.id} | ${r.question.slice(0, 30)}... | ${r.result.termination} | ${r.result.latencyMs} | ${citeCount} | ${ansLen} | ${skills} | ✅ |\n`;
    } else {
      md += `| ${r.id} | ${r.question.slice(0, 30)}... | - | - | - | - | - | ❌ ${r.error ?? ''} |\n`;
    }
  }

  md += `\n## 答案内容摘要\n\n`;
  for (const r of results) {
    if (r.result) {
      md += `### ${r.id}: ${r.question}\n\n`;
      md += `**终止路径**: ${r.result.termination}\n`;
      md += `**耗时**: ${r.result.latencyMs}ms\n`;
      md += `**调用链**: ${r.result.toolCalls.map(t => `${t.name}(${t.kind})`).join(' → ') || '无'}\n\n`;
      md += `**回答** (前500字):\n> ${r.result.answer.slice(0, 500).replace(/\n/g, '\n> ')}\n\n`;
      if (r.result.citations.length > 0) {
        md += `**引用**: ${r.result.citations.length} 条\n`;
        for (const c of r.result.citations.slice(0, 3)) {
          md += `- 《${c.documentTitle}》score=${c.score.toFixed(3)}: ${c.excerpt.slice(0, 100)}...\n`;
        }
      }
      md += `\n`;
    }
  }

  return md;
}
