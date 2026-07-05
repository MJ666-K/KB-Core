import { createInterface } from 'readline';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

marked.setOptions({
  renderer: new TerminalRenderer({
    emoji: true,
    width: Math.min((process.stdout.columns ?? 80) - 2, 100),
    reflowText: true,
    showSectionPrefix: true,
    tab: 2,
  }) as unknown as typeof marked.defaults.renderer,
});

const WS_URL = process.env.KB_WS_URL ?? 'ws://localhost:3000/ws/query';
const DATASET_ID = process.env.KB_DATASET_ID ?? undefined;
const MAX_HISTORY = 10;


const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m', gray: '\x1b[90m' };

interface Citation { chunkId: string; documentId: string; documentTitle: string; excerpt: string; score: number }
interface AgentStep { iteration: number; thought: string; action: string }
interface HistoryEntry { role: 'user' | 'assistant'; content: string }

const history: HistoryEntry[] = [];
let lastSteps: AgentStep[] = [];
let rl: ReturnType<typeof createInterface>;
let rlClosed = false;
let thinkingBuf = '';
let answerBuf = '';
let gotAnswerTokens = false;
let gotThinkingToken = false;
let answerStreaming = false;
let answerLnCount = 0;
let printedAnswerHeader = false;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerColor: string = C.gray;
let phase: 'idle' | 'thinking' | 'tool' | 'answering' = 'idle';
let lastStep: { action: string; kind: string; count: number } | null = null;

const subAgentState = {
  badge: null as string | null,
  tool: null as { action: string; count: number } | null,
  thinkingActive: false,
};
let gotSubAgentThinkingToken = false;

function finalizeSubAgentTool(): void {
  if (!subAgentState.tool) return;
  stopSpinner();
  const count = subAgentState.tool.count > 1 ? ` ×${subAgentState.tool.count}` : '';
  process.stdout.write(`\r\x1b[K${C.dim}    → ✅ ${subAgentState.tool.action}${count}${C.reset}\n`);
  subAgentState.tool = null;
}

function resetSubAgentState(): void {
  finalizeSubAgentTool();
  subAgentState.badge = null;
  subAgentState.thinkingActive = false;
}

function print(t: string): void { process.stdout.write(t + '\n'); }
function clearLine(): void { process.stdout.write('\r\x1b[K'); }

function startSpinner(label: string, color: string = C.gray): void {
  stopSpinner();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  process.stdout.write(`${color}${frames[0]} ${label}${C.reset}`);
  spinnerTimer = setInterval(() => { process.stdout.write(`\r${color}${frames[i = (i + 1) % frames.length]} ${label}${C.reset}`); }, 80);
}

function stopSpinner(): void { if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; } clearLine(); }

function banner(): void {
  print(`\n${C.cyan}${C.bold}  ⚖ Knowledge Core (流式)${C.reset}`);
  print(`${C.dim}  法律知识库 · Agent 流式问答${C.reset}`);
  print(`  ${C.dim}/help 查看命令 · 输入问题开始提问${C.reset}\n`);
}

function help(): void {
  print(`\n${C.bold}命令${C.reset}  ${C.cyan}/help${C.reset} 显示帮助 · ${C.cyan}/clear${C.reset} 清空历史 · ${C.cyan}/steps${C.reset} 决策链 · ${C.cyan}/quit${C.reset} 退出\n`);
}

function showSteps(): void {
  if (lastSteps.length === 0) { print(`\n${C.dim}没有查询记录${C.reset}\n`); return; }
  print(`\n${C.bold}🔍 决策链${C.reset}`);
  for (const s of lastSteps) {
    print(`  ${C.gray}[${s.iteration}]${C.reset} ${C.cyan}${s.action}${C.reset}`);
    if (s.thought && s.thought !== '直接回答') print(`       ${C.dim}${s.thought.slice(0, 120)}${C.reset}`);
  }
  print('');
}

function formatAnswer(t: string): string {
  try {
    return (marked.parse(t) as string).replace(/\n$/, '');
  } catch {
    return t;
  }
}

function handleEvent(data: Record<string, unknown>): void {
  const subAgent = data.subAgent as { name: string; displayName: string } | undefined;

  if (subAgent) {
    // Suppress sub-agent tool lifecycle events that arrive after main answer streaming begins —
    // otherwise "→ ✅ search_knowledge" lines would interleave inside the streamed answer text.
    if (phase === 'answering' && (data.type === 'step' || data.type === 'step_end')) {
      return;
    }

    const isNewSubAgent = subAgentState.badge !== subAgent.displayName;

    if (isNewSubAgent) {
      resetSubAgentState();
      stopSpinner();
      subAgentState.badge = subAgent.displayName;
      process.stdout.write(`${C.dim}  📡 [${subAgent.displayName}]${C.reset}\n`);
    }

    if (data.type === 'thinking') {
      finalizeSubAgentTool();
      if (!data.token) {
        if (!subAgentState.thinkingActive) {
          subAgentState.thinkingActive = true;
          process.stdout.write(`${C.dim}    💭 ${C.reset}`);
        }
        startSpinner('思考中...', C.dim);
      } else {
        if (!subAgentState.thinkingActive) {
          subAgentState.thinkingActive = true;
          stopSpinner();
          process.stdout.write(`${C.dim}    💭 ${C.reset}`);
        } else if (!gotSubAgentThinkingToken) {
          stopSpinner();
          gotSubAgentThinkingToken = true;
        }
        process.stdout.write(`${C.dim}${data.token as string}${C.reset}`);
      }
      return;
    }

    if (data.type === 'thinking_end') {
      finalizeSubAgentTool();
      stopSpinner();
      if (subAgentState.thinkingActive) {
        process.stdout.write(`\n`);
        subAgentState.thinkingActive = false;
        gotSubAgentThinkingToken = false;
      }
      return;
    }

    if (data.type === 'step') {
      const action = data.action as string;
      if (subAgentState.tool && subAgentState.tool.action === action) {
        subAgentState.tool.count++;
        const countLabel = ` ×${subAgentState.tool.count}`;
        startSpinner(`    → 🔧 ${action}${countLabel}`, C.dim);
      } else {
        finalizeSubAgentTool();
        subAgentState.tool = { action, count: 1 };
        startSpinner(`    → 🔧 ${action}`, C.dim);
      }
      return;
    }

    if (data.type === 'step_end') {
      finalizeSubAgentTool();
      return;
    }

    return;
  }

  switch (data.type) {
    case 'thinking':
      if (!data.token) {
        if (phase !== 'thinking') { phase = 'thinking'; thinkingBuf = ''; startSpinner('思考中...'); }
      } else {
        if (!gotThinkingToken) { gotThinkingToken = true; stopSpinner(); process.stdout.write(`${C.gray}💭 `); }
        thinkingBuf += data.token as string;
        process.stdout.write(`${C.gray}${data.token as string}`);
      }
      break;
    case 'thinking_end':
      stopSpinner();
      if (gotThinkingToken) process.stdout.write(`${C.reset}\n`);
      phase = 'idle';
      break;
    case 'step': {
      resetSubAgentState();
      phase = 'tool';
      const action = data.action as string;
      const kind = (data.kind as string) || 'tool';
      if (lastStep && lastStep.action === action && lastStep.kind === kind) {
        lastStep.count++;
        startSpinner(`🔧 ${action} (${kind}) ×${lastStep.count}`);
      } else {
        if (lastStep) {
          stopSpinner();
          process.stdout.write(`\r\x1b[K${C.dim}  ✅ ${lastStep.action}${lastStep.count > 1 ? ` ×${lastStep.count}` : ''}${C.reset}\n`);
        }
        lastStep = { action, kind, count: 1 };
        startSpinner(`🔧 ${action} (${kind})`);
      }
      break;
    }
    case 'step_end': {
      if (lastStep && lastStep.action === (data.action as string)) {
        stopSpinner();
        process.stdout.write(`\r\x1b[K${C.dim}  ✅ ${lastStep.action}${lastStep.count > 1 ? ` ×${lastStep.count}` : ''}${C.reset}\n`);
        lastStep = null;
      }
      phase = 'idle';
      break;
    }
    case 'answer_start':
      phase = 'answering'; answerBuf = ''; answerLnCount = 0; gotAnswerTokens = false; answerStreaming = false; stopSpinner();
      finalizeSubAgentTool();
      subAgentState.badge = null;
      startSpinner('生成中...');
      break;
    case 'token':
      if (!gotAnswerTokens) {
        gotAnswerTokens = true; answerStreaming = true; stopSpinner();
        if (!printedAnswerHeader) {
          if (lastStep) {
            process.stdout.write(`\r\x1b[K${C.dim}  ✅ ${lastStep.action}${lastStep.count > 1 ? ` ×${lastStep.count}` : ''}${C.reset}\n`);
            lastStep = null;
          } else {
            process.stdout.write('\n');
          }
          print(`${C.green}${C.bold}🤖 回答${C.reset}`);
          printedAnswerHeader = true;
        }
        process.stdout.write('\n'); answerLnCount++;
      }
      answerBuf += data.token as string;
      process.stdout.write(data.token as string);
      answerLnCount += ((data.token as string).match(/\n/g) || []).length;
      break;
    case 'answer_end': {
      stopSpinner();
      if (gotAnswerTokens) {
        process.stdout.write('\n');
      }
      phase = 'idle';
      finalizeSubAgentTool();
      break;
    }
    case 'result': {
      stopSpinner(); phase = 'idle';
      const citations = (data.citations as Citation[]) ?? [];
      const latencyMs = data.latencyMs as number;
      const termination = data.termination as string;

      if (!gotAnswerTokens) {
        const answer = (data.answer as string) ?? thinkingBuf;
        if (termination === 'direct' && gotThinkingToken) {
          process.stdout.write(`${C.reset}\n`);
          history.push({ role: 'assistant', content: answer });
        } else {
          if (!answerStreaming && answerBuf.length === 0 && !printedAnswerHeader) {
            print(`\n${C.green}${C.bold}🤖 回答${C.reset}\n`);
          }
          print(formatAnswer(answer));
          history.push({ role: 'assistant', content: answer });
          answerStreaming = false;
          printedAnswerHeader = true;
        }
      } else {
        history.push({ role: 'assistant', content: answerBuf });
      }

      if (citations.length > 0) {
        print(`\n${C.magenta}📎 引用 (${citations.length})${C.reset}`);
        citations.forEach((c, i) => print(`  ${C.gray}[${i + 1}]${C.reset} ${C.dim}[${c.score.toFixed(2)}]${C.reset} ${C.bold}${c.documentTitle}${C.reset}${C.dim}: ${c.excerpt.replace(/\n/g, ' ').slice(0, 60)}${C.reset}`));
      }

      const tc = termination === 'skill' ? C.green : termination === 'direct' ? C.cyan : C.yellow;
      print(`\n${C.dim}⏱ ${latencyMs}ms · ${tc}${termination}${C.reset}${C.dim} · ${citations.length} 引用${C.reset}\n`);
      lastSteps = (data.steps as AgentStep[]) ?? lastSteps;
      resetSubAgentState();
      break;
    }
    case 'error':
      stopSpinner(); phase = 'idle';
      print(`\n${C.red}❌ ${data.error as string}${C.reset}\n`);
      resetSubAgentState();
      break;
  }
}

async function query(question: string): Promise<void> {
  resetSubAgentState();
  gotAnswerTokens = false; gotThinkingToken = false; thinkingBuf = ''; answerBuf = ''; answerStreaming = false; phase = 'idle'; answerLnCount = 0; lastStep = null;
  printedAnswerHeader = false;

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => { ws.close(); reject(new Error('查询超时')); }, 120_000);
    ws.onopen = () => {
      const msg: Record<string, unknown> = { type: 'query', question, options: { history: history.slice(-MAX_HISTORY * 2) } };
      if (DATASET_ID) msg.datasetId = DATASET_ID;
      ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        handleEvent(data);
        if (data.type === 'result' || data.type === 'error') { clearTimeout(timer); ws.close(); resolve(); }
      } catch (err) { reject(err); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket 连接失败')); };
    ws.onclose = () => { clearTimeout(timer); resolve(); };
  });
}

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => { ws.close(); reject(new Error('超时')); }, 5000);
    ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('连接失败')); };
  });
}

async function main(): Promise<void> {
  banner();
  try { await connect(); print(`  ${C.green}● 已连接 (流式)${C.reset}\n`); }
  catch { print(`  ${C.red}✗ 连接失败，请确认 bun run dev${C.reset}\n`); return; }

  rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => { rlClosed = true; });
  const prompt = (): void => {
    if (!rl || rlClosed) return;
    rl.question(`${C.cyan}❯${C.reset} `, async (input) => {
      const q = (input || '').trim();
      if (!q) { prompt(); return; }
      switch (q) {
        case '/quit': case '/exit': print(`\n${C.dim}再见 👋${C.reset}\n`); rl.close(); process.exit(0); return;
        case '/clear': history.length = 0; print(`\n${C.dim}历史已清空${C.reset}\n`); prompt(); return;
        case '/help': help(); prompt(); return;
        case '/steps': showSteps(); prompt(); return;
        default:
          history.push({ role: 'user', content: q });
          try { await query(q); } catch (err) { print(`${C.red}❌ ${(err as Error).message}${C.reset}\n`); }
          prompt();
      }
    });
  };
  prompt();
}

main().catch(err => { print(`${C.red}Fatal: ${err.message}${C.reset}`); process.exit(1); });
process.on('SIGINT', () => { stopSpinner(); print(`\n${C.dim}再见 👋${C.reset}\n`); process.exit(0); });
