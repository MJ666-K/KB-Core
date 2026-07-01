/**
 * 冒烟测试：health + ingest + WebSocket query
 * 用法：bun tests/smoke.ts
 * 会自动启动/关闭测试服务（端口 3000，如被占用则 3001）
 */
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { wsQuery } from './ws-query';

const APP_DIR = join(import.meta.dir, '..');
const REPORT_PATH = join(import.meta.dir, '../../docs/tests/smoke-report.md');
const QUERY_TIMEOUT = Number(process.env.SMOKE_QUERY_TIMEOUT ?? 120_000);

interface CaseResult {
  id: string;
  name: string;
  passed: boolean;
  latencyMs: number;
  detail: string;
  error?: string;
  excerpt?: string;
}

const results: CaseResult[] = [];
let API = 'http://localhost:3000';
let WS_URL = 'ws://localhost:3000/ws/query';
let serverProc: Subprocess | null = null;
let serverPort = 3000;

function record(id: string, name: string, passed: boolean, latencyMs: number, detail: string, error?: string, excerpt?: string): void {
  results.push({ id, name, passed, latencyMs, detail, error, excerpt });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${id}] ${name} (${latencyMs}ms) — ${detail}${error ? ` | ${error}` : ''}`);
}

async function isPortHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    if (!res.ok) return false;
    const body = await res.json() as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  }
}

async function canWsUpgrade(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/query`);
    const timer = setTimeout(() => { ws.close(); resolve(false); }, 3000);
    ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(timer); resolve(false); };
  });
}

async function startServer(): Promise<void> {
  for (const port of [3000, 3001]) {
    if (await isPortHealthy(port) && await canWsUpgrade(port)) {
      serverPort = port;
      API = `http://localhost:${port}`;
      WS_URL = `ws://localhost:${port}/ws/query`;
      console.log(`♻️  复用已有服务 ${API}`);
      return;
    }
  }

  serverPort = (await isPortHealthy(3000)) ? 3001 : 3000;
  API = `http://localhost:${serverPort}`;
  WS_URL = `ws://localhost:${serverPort}/ws/query`;

  console.log(`🚀 启动测试服务 ${API} ...`);
  serverProc = Bun.spawn(['bun', 'src/index.ts'], {
    cwd: APP_DIR,
    env: { ...process.env, APP_PORT: String(serverPort) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  for (let i = 0; i < 40; i++) {
    if (await isPortHealthy(serverPort) && await canWsUpgrade(serverPort)) {
      console.log(`✅ 服务就绪 (${serverPort})\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`服务启动超时（port ${serverPort}）`);
}

function stopServer(): void {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

async function testHealth(): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/health`);
    const body = await res.json() as { status?: string };
    const ok = res.ok && body.status === 'ok';
    record('S1', 'GET /health', ok, Date.now() - t0, `status=${body.status ?? res.status}`, ok ? undefined : `HTTP ${res.status}`);
  } catch (err) {
    record('S1', 'GET /health', false, Date.now() - t0, '连接失败', err instanceof Error ? err.message : String(err));
  }
}

async function testIngest(): Promise<void> {
  const t0 = Date.now();
  const content = `冒烟测试文档 ${new Date().toISOString()}\n\n第一条 测试条款内容。\n第二条 知识库入库验证。`;
  try {
    const fd = new FormData();
    fd.append('file', new File([content], 'smoke-test.txt', { type: 'text/plain' }));
    fd.append('dataset', 'default');
    const res = await fetch(`${API}/ingest`, { method: 'POST', body: fd });
    const body = await res.json() as { docId?: string; status?: string; error?: string };
    const ok = res.ok && !!body.docId;
    record('S2', 'POST /ingest', ok, Date.now() - t0, `docId=${body.docId?.slice(0, 8) ?? '-'} status=${body.status ?? '-'}`, ok ? undefined : body.error ?? `HTTP ${res.status}`);
  } catch (err) {
    record('S2', 'POST /ingest', false, Date.now() - t0, '请求失败', err instanceof Error ? err.message : String(err));
  }
}

async function testWsConnect(): Promise<void> {
  const t0 = Date.now();
  const ok = await canWsUpgrade(serverPort);
  record('S3', 'WS 连接 /ws/query', ok, Date.now() - t0, WS_URL, ok ? undefined : '无法建立 WebSocket');
}

async function testWsInvalidMessage(): Promise<void> {
  const t0 = Date.now();
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => { ws.close(); record('S4', 'WS 非法消息校验', false, Date.now() - t0, '超时'); resolve(); }, 5000);
    ws.onopen = () => ws.send('{ invalid json');
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(String(ev.data)) as { type?: string; error?: string };
        record('S4', 'WS 非法消息校验', data.type === 'error', Date.now() - t0, data.error ?? JSON.stringify(data));
      } catch {
        record('S4', 'WS 非法消息校验', false, Date.now() - t0, '响应非 JSON');
      }
      ws.close();
      resolve();
    };
    ws.onerror = () => { clearTimeout(timer); record('S4', 'WS 非法消息校验', false, Date.now() - t0, '连接失败'); resolve(); };
  });
}

async function testWsQuery(id: string, name: string, question: string, expectMinLen = 5): Promise<void> {
  const t0 = Date.now();
  try {
    const data = await wsQuery(question, QUERY_TIMEOUT, WS_URL);
    const ok = data.type === 'result' && (data.answer?.length ?? 0) >= expectMinLen;
    record(id, name, ok, Date.now() - t0,
      `termination=${data.termination} citations=${data.citations?.length ?? 0} len=${data.answer?.length ?? 0}`,
      ok ? undefined : '答案过短或格式错误',
      data.answer?.slice(0, 300));
  } catch (err) {
    record(id, name, false, Date.now() - t0, '查询失败', err instanceof Error ? err.message : String(err));
  }
}

function generateReport(): string {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

  let md = `# KB-Core 冒烟测试报告\n\n`;
  md += `> **测试时间**：${dateStr}\n`;
  md += `> **API 基址**：${API}\n`;
  md += `> **WebSocket**：${WS_URL}\n`;
  md += `> **对外接口**：\`POST /ingest\` · \`WS /ws/query\` · \`GET /health\`\n\n`;

  md += `## 总览\n\n| 指标 | 值 |\n|---|---|\n`;
  md += `| 用例总数 | ${total} |\n| 通过 | ${passed} |\n| 失败 | ${total - passed} |\n`;
  md += `| 通过率 | ${total > 0 ? ((passed / total) * 100).toFixed(0) : 0}% |\n\n`;

  md += `## 用例明细\n\n| ID | 用例 | 结果 | 耗时 | 说明 |\n|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.id} | ${r.name} | ${r.passed ? '✅ PASS' : '❌ FAIL'} | ${r.latencyMs}ms | ${r.detail}${r.error ? ` — ${r.error}` : ''} |\n`;
  }

  const withExcerpt = results.filter((r) => r.excerpt);
  if (withExcerpt.length > 0) {
    md += `\n## 问答摘要\n\n`;
    for (const r of withExcerpt) {
      md += `### ${r.id} ${r.name}\n\n> ${r.excerpt!.replace(/\n/g, '\n> ')}${r.excerpt!.length >= 300 ? '…' : ''}\n\n`;
    }
  }

  md += `\n## 接口速查\n\n### POST /ingest\n\`\`\`bash\ncurl -X POST ${API}/ingest -F "file=@doc.txt" -F "dataset=default"\n\`\`\`\n\n`;
  md += `### WS /ws/query\n\`\`\`json\n{ "type": "query", "question": "你的问题" }\n\`\`\`\n\n`;

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    md += `## 失败项\n\n`;
    for (const r of failed) md += `- **${r.id} ${r.name}**：${r.error ?? r.detail}\n`;
    md += `\n`;
  }

  md += `---\n*由 \`bun tests/smoke.ts\` 自动生成*\n`;
  return md;
}

async function main(): Promise<void> {
  console.log(`\n🔥 KB-Core 冒烟测试\n`);
  try {
    await startServer();
    console.log(`   API: ${API}`);
    console.log(`   WS:  ${WS_URL}\n`);

    await testHealth();
    await testIngest();
    await testWsConnect();
    await testWsInvalidMessage();
    await testWsQuery('S5', 'WS 对话（chat）', '你好', 3);
    await testWsQuery('S6', 'WS 检索问答（qa）', '社会保险法规定了哪些社会保险种类？', 20);
  } finally {
    stopServer();
  }

  const report = generateReport();
  await Bun.write(REPORT_PATH, report);

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n📊 结果：${passed}/${results.length} 通过`);
  console.log(`📄 报告：${REPORT_PATH}\n`);

  if (passed < results.length) process.exit(1);
}

main().catch((err) => {
  stopServer();
  console.error(err);
  process.exit(1);
});
