import { useEffect, useRef, useState, useCallback } from 'react';
import { Input, Button, Card, Space, Collapse, Tag, Spin } from 'antd';
import { SendOutlined, PaperClipOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';

const { TextArea } = Input;

interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
}

interface SubAgent { name: string; displayName: string }

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
  streaming?: boolean;
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

export default function Chat() {
  const [question, setQuestion] = useState('');
  const [, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const currentRef = useRef<AgentMsg | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    return () => { wsRef.current?.close(); };
  }, []);

  const updateCurrent = (fn: (m: AgentMsg) => AgentMsg) => {
    if (!currentRef.current) return;
    currentRef.current = fn(currentRef.current);
    setMessages(prev => [...prev].map((msg, i) => i === prev.length - 1 ? currentRef.current! : msg));
  };

  const handleMsg = (data: Record<string, unknown>) => {
    const sub = data.subAgent as SubAgent | undefined;
    const type = data.type as string;
    const m = currentRef.current;
    if (!m) return;

    if (sub) {
      if (!m.subAgents.find(s => s.name === sub.name)) {
        updateCurrent(msg => ({ ...msg, subAgents: [...msg.subAgents, sub!] }));
      }
      if (type === 'thinking') {
        const token = data.token as string | undefined;
        if (token) updateCurrent(msg => ({ ...msg, thinking: [...msg.thinking, `[${sub.displayName}] ${token}`] }));
      } else if (type === 'step') {
        updateCurrent(msg => ({ ...msg, toolCalls: [...msg.toolCalls, { name: data.action as string, kind: data.kind as string, done: false }] }));
      } else if (type === 'step_end') {
        const name = data.action as string;
        updateCurrent(msg => ({ ...msg, toolCalls: msg.toolCalls.map(t => t.name === name && !t.done ? { ...t, done: true } : t) }));
      }
      return;
    }

    if (type === 'thinking') {
      const token = data.token as string | undefined;
      if (token) updateCurrent(msg => ({ ...msg, thinking: [...msg.thinking, token] }));
    } else if (type === 'step') {
      updateCurrent(msg => ({ ...msg, toolCalls: [...msg.toolCalls, { name: data.action as string, kind: data.kind as string, done: false }] }));
    } else if (type === 'step_end') {
      const name = data.action as string;
      updateCurrent(msg => ({ ...msg, toolCalls: msg.toolCalls.map(t => t.name === name && !t.done ? { ...t, done: true } : t) }));
    } else if (type === 'token') {
      const token = data.token as string | undefined;
      if (token) updateCurrent(msg => ({ ...msg, content: msg.content + token, streaming: true }));
    } else if (type === 'result') {
      const citations = (data.citations as Citation[]) ?? [];
      const latencyMs = data.latencyMs as number;
      const termination = data.termination as string;
      const finalContent = m.content || (data.answer as string) || '';
      updateCurrent(msg => ({ ...msg, content: finalContent, citations, latencyMs, termination, streaming: false }));
      historyRef.current = [...historyRef.current, { role: 'assistant', content: finalContent }];
      setHistory(historyRef.current);
      currentRef.current = null;
      setLoading(false);
    } else if (type === 'error') {
      updateCurrent(msg => ({ ...msg, content: `❌ ${data.error as string}`, streaming: false }));
      currentRef.current = null;
      setLoading(false);
    }
  };

  const send = useCallback(async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || loading) return;

    const userMsg: AgentMsg = { id: newId(), role: 'user', content: text, thinking: [], toolCalls: [], subAgents: [], citations: [] };
    const botMsg: AgentMsg = { id: newId(), role: 'assistant', content: '', thinking: [], toolCalls: [], subAgents: [], citations: [], streaming: true };
    setMessages(prev => [...prev, userMsg, botMsg]);
    currentRef.current = botMsg;
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    setHistory(historyRef.current);
    setQuestion('');
    setLoading(true);

    const sendQuery = (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: 'query', question: text, options: { history: historyRef.current.slice(-20), topK: 5 } }));
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendQuery(wsRef.current);
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => { sendQuery(ws); };
    ws.onmessage = ev => { try { handleMsg(JSON.parse(ev.data)); } catch { } };
    ws.onerror = () => {
      if (currentRef.current) {
        updateCurrent(msg => ({ ...msg, content: '❌ 连接失败，请检查后端服务', streaming: false }));
        currentRef.current = null;
        setLoading(false);
      }
    };
    ws.onclose = () => {
      if (currentRef.current && currentRef.current.streaming) {
        updateCurrent(msg => ({ ...msg, content: msg.content || '⚠️ 连接已断开', streaming: false }));
        currentRef.current = null;
        setLoading(false);
      }
    };
  }, [question, loading]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)' }}>
      <Card bordered={false} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 } }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '80px 20px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚖️</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>智能问答</div>
              <div style={{ color: '#00000073', fontSize: 13, marginBottom: 24 }}>输入法律问题，系统自动选择专家智能体解答</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {HINTS.map(h => (
                  <div key={h} style={{ background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 16, padding: '6px 14px', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}
                    onClick={() => send(h)}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#1677ff'; e.currentTarget.style.color = '#1677ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#d9d9d9'; e.currentTarget.style.color = 'inherit'; }}
                  >{h}</div>
                ))}
              </div>
            </div>
          )}
          {messages.map(m => <MsgBubble key={m.id} msg={m} />)}
          <div ref={endRef} />
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="输入法律问题..."
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={loading}
              style={{ borderRadius: '6px 0 0 6px' }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => send()} disabled={loading || !question.trim()} style={{ height: 'auto', minHeight: 36 }}>
              {loading ? '回答中' : '发送'}
            </Button>
          </Space.Compact>
        </div>
      </Card>
    </div>
  );
}

function MsgBubble({ msg }: { msg: AgentMsg }) {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 10 }}>
        <div style={{ background: '#1677ff', color: 'white', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', maxWidth: '70%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1677ff', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}><UserOutlined /></div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', marginBottom: 20, gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f0f5ff', color: '#1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid #d6e4ff', fontSize: 14 }}><RobotOutlined /></div>
      <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: '14px 14px 14px 4px', padding: '14px 16px', maxWidth: '85%' }}>
        {msg.subAgents.length > 0 && (
          <Space size={4} style={{ marginBottom: 8 }} wrap>
            {msg.subAgents.map(s => <Tag key={s.name} color="blue">📡 {s.displayName}</Tag>)}
          </Space>
        )}
        {msg.thinking.length > 0 && (
          <Collapse size="small" style={{ marginBottom: 10, background: '#fafafa' }} bordered={false}>
            <Collapse.Panel header="💭 思考过程" key="t">
              <pre style={{ fontSize: 11, color: '#00000073', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'ui-monospace, Menlo, monospace' }}>{msg.thinking.join('')}</pre>
            </Collapse.Panel>
          </Collapse>
        )}
        {msg.toolCalls.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {msg.toolCalls.map((t, i) => (
              <Tag key={i} color={t.done ? 'success' : 'processing'} style={{ marginBottom: 4 }}>
                {t.done ? '✅' : <Spin size="small" style={{ marginRight: 4 }} />}
                {t.name}
                <Tag color="default" bordered={false} style={{ marginLeft: 4, padding: '0 6px' }}>{t.kind}</Tag>
              </Tag>
            ))}
          </div>
        )}
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14 }}>
          {msg.content || (msg.streaming && <Spin size="small" />)}
        </div>
        {msg.citations.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #f0f0f0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              <PaperClipOutlined style={{ marginRight: 6, color: '#1677ff' }} />引用 ({msg.citations.length})
            </div>
            {msg.citations.map((c, i) => (
              <div key={i} style={{ fontSize: 12, padding: '8px 10px', background: '#fafafa', borderRadius: 6, marginBottom: 6, borderLeft: '3px solid #1677ff' }}>
                <span style={{ color: '#1677ff', fontWeight: 600, fontFamily: 'monospace', marginRight: 8 }}>[{c.score.toFixed(2)}]</span>
                <strong>{c.documentTitle}</strong>
                <div style={{ marginTop: 4, color: '#00000073' }}>{c.excerpt.slice(0, 120)}</div>
              </div>
            ))}
          </div>
        )}
        {msg.latencyMs !== undefined && (
          <div style={{ fontSize: 11, color: '#00000045', marginTop: 10 }}>
            ⏱ {msg.latencyMs}ms · {msg.termination} · {msg.citations.length} 引用
          </div>
        )}
      </div>
    </div>
  );
}
