/**
 * 精简测试 v2：5 个核心用例 × 60s 超时 = ~5 分钟
 */
import { spawn } from 'child_process';

const API = 'http://localhost:3000';
const APP_DIR = '/home/mingjie-li/code/KB-Core/app';

const TESTS = [
  { id: 'chat-1', q: '你好', kw: '法律|知识库|助手' },
  { id: 'qa-3', q: '社会保险法规定了哪些社会保险种类？', kw: '养老|医疗|工伤|失业|生育' },
  { id: 'search-1', q: '搜索经济补偿相关的法条', kw: '经济补偿|劳动' },
  { id: 'qa-4', q: '用人单位违法解除劳动合同应该怎么赔偿？', kw: '赔偿|双倍|补偿|87' },
  { id: 'compare-1', q: '对比劳动合同法和劳动法在合同解除方面的区别', kw: '解除|对比|劳动合同法|劳动法' },
];

async function main() {
  console.log('启动服务...');
  const srv = spawn('bun', ['src/index.ts'], { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', () => {});

  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${API}/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }

  const results: any[] = [];

  for (const tc of TESTS) {
    process.stdout.write(`[${tc.id}] ${tc.q.slice(0, 25)}... `);
    const t0 = Date.now();
    try {
      const { wsQuery } = await import('./ws-query');
      const data = await wsQuery(tc.q, 60000);
      const ms = Date.now() - t0;
      const ans = data.answer ?? '';
      const kw = new RegExp(tc.kw).test(ans);
      const ok = ans.length > 10;
      results.push({ id: tc.id, q: tc.q, ans, term: data.termination, ms, ok, kw });
      console.log(`${ok ? '✅' : '❌'} ${(ms/1000).toFixed(1)}s ${ans.length}字 ${kw ? '🔑' : ''}`);
    } catch (e: any) {
      results.push({ id: tc.id, q: tc.q, ans: '', term: 'error', ms: Date.now()-t0, ok: false, kw: false, err: String(e) });
      console.log(`❌ ERROR`);
    }
  }

  srv.kill('SIGKILL');

  const passed = results.filter(r => r.ok).length;
  const kwPass = results.filter(r => r.kw).length;
  console.log(`\n📊 ${passed}/${results.length} 通过 (${((passed/results.length)*100).toFixed(0)}%) | 关键词 ${kwPass}/${results.length}`);

  let md = `# KB-Core 法律知识库测试报告 v2\n\n> 测试时间：${new Date().toISOString()}\n> 测试数据：23 部法律法规，1089 chunks\n\n`;
  md += `## 总览\n\n| 指标 | 值 |\n|---|---|\n| 测试用例 | ${results.length} |\n| 通过 | ${passed}（${((passed/results.length)*100).toFixed(0)}%）|\n| 关键词命中 | ${kwPass}/${results.length} |\n\n`;
  md += `## v1 → v2 修复\n\n| 修复项 | 说明 |\n|---|---|\n| Reranker API | DashScope 原生格式（gte-rerank）|\n| LLM/Embedding 重试 | 3 次指数退避 |\n| datasetId | query 路由自动解析 UUID |\n| 服务启动等待 | 30s 健康检查轮询 |\n\n`;
  md += `## 详细结果\n\n| ID | 问题 | 耗时(s) | 终止 | 长度 | 关键词 | 状态 |\n|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.id} | ${r.q.slice(0,25)}... | ${(r.ms/1000).toFixed(1)} | ${r.term} | ${r.ans.length} | ${r.kw?'✅':'❌'} | ${r.ok?'✅':'❌'} |\n`;
  }
  md += `\n## 答案摘要\n\n`;
  for (const r of results) {
    md += `### ${r.id}: ${r.q}\n-${r.ans ? ' '+r.ans.slice(0,400).replace(/\n/g,' ')+'...' : '（空）'}\n\n`;
  }

  await Bun.write('/home/mingjie-li/code/KB-Core/docs/tests/test-report-v2.md', md);
  console.log('📄 报告已保存');
}

main().catch(console.error);
