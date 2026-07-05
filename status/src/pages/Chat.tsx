import { useEffect, useRef, useState, useCallback } from 'react';
import { Input, Button, Card, Space, Tag, Typography } from 'antd';
import { SendOutlined, PaperClipOutlined, RobotOutlined, UserOutlined, LoadingOutlined } from '@ant-design/icons';
import { api } from '../api';
import MarkdownContent from '../MarkdownContent';
import { actionLabel, statusMessage, aggregateCalls } from '../chatLabels';

const { TextArea } = Input;
const { Text } = Typography;

interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
}

interface SubAgent { name: string; displayName: string }

type MsgPhase = 'idle' | 'thinking' | 'tool' | 'writing' | 'done' | 'error';

interface AgentMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string[];
  toolCalls: Array<{ name: string; kind: string; done: boolean }>;
  subAgents: SubAgent[];
  citations: Citation[];
  latencyMs?: number;
  termination?: string;
  phase: MsgPhase;
}

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/query`;

let idSeq = 0;
const newId = () => `msg-${Date.now()}-${idSeq++}`;

const HINTS = [
  '劳动合同法关于加班的规定？',
  '民法典第39条怎么规定的？',
  '公司股权转让需要哪些法律程序？',
  '离婚财产分割的法律依据？',
];

const emptyAssistant = (): AgentMsg => ({
  id: newId(),
  role: 'assistant',
  content: '',
  thinking: [],
  toolCalls: [],
  subAgents: [],
  citations: [],
  phase: 'thinking',
});

export default function Chat() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [skillLabels, setSkillLabels] = useState<Map<string, string>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  useEffect(() => {
    api.getSkills()
      .then(r => {
        const map = new Map<string, string>();
        for (const s of r.skills ?? []) {
          if (s.name && s.displayName) map.set(s.name, s.displayName);
        }
        setSkillLabels(map);
      })
      .catch(() => { /* 使用本地 fallback 标签 */ });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const patchAssistant = useCallback((fn: (m: AgentMsg) => AgentMsg) => {
    const id = assistantIdRef.current;
    if (!id) return;
    setMessages(prev => prev.map(msg => (msg.id === id ? fn(msg) : msg)));
  }, []);

  const finishAssistant = useCallback((patch: Partial<AgentMsg> & { content: string }) => {
    const id = assistantIdRef.current;
    if (!id) return;
    finishedRef.current = true;
    setMessages(prev => prev.map(msg => (
      msg.id === id ? { ...msg, ...patch, phase: patch.phase ?? 'done' } : msg
    )));
    historyRef.current = [...historyRef.current, { role: 'assistant', content: patch.content }];
    assistantIdRef.current = null;
    setLoading(false);
  }, []);

  const handleMsg = useCallback((data: Record<string, unknown>) => {
    const type = data.type as string;
    const sub = data.subAgent as SubAgent | undefined;
    const token = data.token as string | undefined;

    const apply = (fn: (m: AgentMsg) => AgentMsg) => patchAssistant(fn);

    if (type === 'thinking_start') {
      apply(msg => ({ ...msg, phase: 'thinking' }));
      return;
    }
    if (type === 'thinking_end') return;
    if (type === 'thinking' && token) {
      apply(msg => ({
        ...msg,
        phase: 'thinking',
        thinking: [...msg.thinking, sub ? `[${sub.displayName}] ${token}` : token],
      }));
      return;
    }
    if (type === 'step') {
      apply(msg => ({
        ...msg,
        phase: 'tool',
        subAgents: sub && !msg.subAgents.find(s => s.name === sub.name)
          ? [...msg.subAgents, sub]
          : msg.subAgents,
        toolCalls: [...msg.toolCalls, { name: data.action as string, kind: data.kind as string, done: false }],
      }));
      return;
    }
    if (type === 'step_end') {
      const name = data.action as string;
      apply(msg => ({
        ...msg,
        toolCalls: msg.toolCalls.map(t => (t.name === name && !t.done ? { ...t, done: true } : t)),
      }));
      return;
    }
    if (type === 'answer_start') {
      apply(msg => ({ ...msg, phase: 'writing' }));
      return;
    }
    if (type === 'token' && token) {
      apply(msg => ({ ...msg, phase: 'writing', content: msg.content + token }));
      return;
    }
    if (type === 'answer_end') return;
    if (type === 'result') {
      const answer = typeof data.answer === 'string' ? data.answer : '';
      const citations = (data.citations as Citation[]) ?? [];
      finishAssistant({
        content: answer,
        citations,
        latencyMs: data.latencyMs as number | undefined,
        termination: data.termination as string | undefined,
        phase: 'done',
      });
      return;
    }
    if (type === 'error') {
      const detail = data.detail ? `: ${JSON.stringify(data.detail)}` : '';
      finishAssistant({
        content: `❌ ${data.error as string}${detail}`,
        phase: 'error',
      });
    }
  }, [patchAssistant, finishAssistant]);

  const handleMsgRef = useRef(handleMsg);
  handleMsgRef.current = handleMsg;

  const bindWs = useCallback((ws: WebSocket) => {
    ws.onmessage = (ev) => {
      try {
        handleMsgRef.current(JSON.parse(ev.data as string) as Record<string, unknown>);
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      if (assistantIdRef.current && !finishedRef.current) {
        finishAssistant({ content: '❌ 连接失败，请检查后端服务', phase: 'error' });
      }
    };
    ws.onclose = () => {
      if (assistantIdRef.current && !finishedRef.current) {
        patchAssistant(msg => ({
          ...msg,
          content: msg.content || '⚠️ 连接已断开',
          phase: 'error',
        }));
        assistantIdRef.current = null;
        setLoading(false);
      }
    };
  }, [finishAssistant, patchAssistant]);

  const send = useCallback((q?: string) => {
    const text = (q ?? question).trim();
    if (!text || loading) return;

    const userMsg: AgentMsg = {
      id: newId(), role: 'user', content: text,
      thinking: [], toolCalls: [], subAgents: [], citations: [], phase: 'done',
    };
    const botMsg = emptyAssistant();

    assistantIdRef.current = botMsg.id;
    finishedRef.current = false;
    setMessages(prev => [...prev, userMsg, botMsg]);
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    setQuestion('');
    setLoading(true);

    const payload = JSON.stringify({
      type: 'query',
      question: text,
      options: { history: historyRef.current.slice(0, -1).slice(-20), topK: 5 },
    });

    const sendQuery = (ws: WebSocket) => { ws.send(payload); };

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      bindWs(wsRef.current);
      sendQuery(wsRef.current);
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    bindWs(ws);
    ws.onopen = () => { sendQuery(ws); };
  }, [question, loading, bindWs]);

  return (
    <div className="kc-chat">
      <Card bordered={false} className="kc-chat-card" styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 } }}>
        <div className="kc-chat-messages">
          {messages.length === 0 && (
            <div className="kc-chat-empty">
              <div className="kc-chat-empty-icon">⚖️</div>
              <div className="kc-chat-empty-title">法律助手</div>
              <Text type="secondary">输入法律问题，系统自动选择专家智能体解答</Text>
              <div className="kc-chat-hints">
                {HINTS.map(h => (
                  <button key={h} type="button" className="kc-chat-hint" onClick={() => send(h)}>{h}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map(m => <MsgBubble key={m.id} msg={m} skillLabels={skillLabels} />)}
          <div ref={endRef} />
        </div>

        <div className="kc-chat-input-bar">
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="输入法律问题，Enter 发送，Shift+Enter 换行..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={loading}
              style={{ borderRadius: '8px 0 0 8px' }}
            />
            <Button
              type="primary"
              icon={loading ? <LoadingOutlined /> : <SendOutlined />}
              onClick={() => send()}
              disabled={loading || !question.trim()}
              style={{ height: 'auto', minHeight: 40, borderRadius: '0 8px 8px 0' }}
            >
              {loading ? '回答中' : '发送'}
            </Button>
          </Space.Compact>
        </div>
      </Card>
    </div>
  );
}

function StatusLine({ msg }: { msg: AgentMsg }) {
  if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'idle') return null;
  if (msg.phase === 'writing' && msg.content) return null;

  const running = msg.toolCalls.find(t => !t.done);
  const text = statusMessage(msg.phase, running?.name, running?.kind);

  return (
    <div className="kc-chat-status">
      <LoadingOutlined spin /> {text}
    </div>
  );
}

function DoneActions({
  msg,
  skillLabels,
}: {
  msg: AgentMsg;
  skillLabels: Map<string, string>;
}) {
  const aggregated = aggregateCalls(msg.toolCalls);
  if (aggregated.length === 0) return null;

  return (
    <div className="kc-chat-tools">
      {aggregated.map(({ name, kind, count }) => {
        const isSkill = kind === 'skill';
        const cls = `kc-chat-tool-tag ${isSkill ? 'kc-chat-tool-skill' : 'kc-chat-tool-tool'}`;
        const label = actionLabel(name, skillLabels);
        return (
          <span key={name} className={cls}>
            {label}{count > 1 ? ` ×${count}` : ''}
          </span>
        );
      })}
    </div>
  );
}

function MsgBubble({ msg, skillLabels }: { msg: AgentMsg; skillLabels: Map<string, string> }) {
  if (msg.role === 'user') {
    return (
      <div className="kc-chat-row kc-chat-row-user">
        <div className="kc-chat-bubble-user">{msg.content}</div>
        <div className="kc-chat-avatar kc-chat-avatar-user"><UserOutlined /></div>
      </div>
    );
  }

  const isDone = msg.phase === 'done' || msg.phase === 'error';
  const totalCalls = msg.toolCalls.length;

  return (
    <div className="kc-chat-row kc-chat-row-bot">
      <div className="kc-chat-avatar kc-chat-avatar-bot"><RobotOutlined /></div>
      <div className="kc-chat-bubble-agent">
        {msg.subAgents.length > 0 && (
          <Space size={4} style={{ marginBottom: 8 }} wrap>
            {msg.subAgents.map(s => <Tag key={s.name} color="blue">{s.displayName}</Tag>)}
          </Space>
        )}

        <StatusLine msg={msg} />

        {isDone && <DoneActions msg={msg} skillLabels={skillLabels} />}

        {msg.content ? (
          <div className="kc-chat-answer">
            {msg.phase === 'error' ? (
              <span>{msg.content}</span>
            ) : (
              <MarkdownContent content={msg.content} />
            )}
            {msg.phase === 'writing' && <span className="kc-chat-cursor">▍</span>}
          </div>
        ) : null}

        {msg.citations.length > 0 && (
          <div className="kc-chat-citations">
            <div className="kc-chat-citations-title">
              <PaperClipOutlined /> 引用 ({msg.citations.length})
            </div>
            {msg.citations.map((c, i) => (
              <div key={i} className="kc-chat-citation-item">
                <span className="kc-chat-citation-score">[{Number(c.score ?? 0).toFixed(2)}]</span>
                <strong>{c.documentTitle || '未知文档'}</strong>
                <div className="kc-chat-citation-excerpt">{(c.excerpt ?? '').slice(0, 160)}</div>
              </div>
            ))}
          </div>
        )}

        {msg.latencyMs !== undefined && (
          <div className="kc-chat-meta">
            {(msg.latencyMs / 1000).toFixed(1)}s
            {totalCalls > 0 && <> · 调用 {totalCalls} 次</>}
            {msg.citations.length > 0 && <> · {msg.citations.length} 条引用</>}
          </div>
        )}
      </div>
    </div>
  );
}
