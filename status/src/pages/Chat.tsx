import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Input, Button, Card, Space, Typography, Popconfirm, message, Spin, Collapse,
} from 'antd';
import {
  SendOutlined, PaperClipOutlined, RobotOutlined, UserOutlined, LoadingOutlined,
  PlusOutlined, DeleteOutlined, MessageOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import MarkdownContent from '../MarkdownContent';
import { sanitizeAnswerContent } from '../sanitizeAnswerContent';
import { actionLabel, statusMessage, aggregateCalls, shouldShowAction } from '../chatLabels';
import {
  groupSessions, SESSION_GROUP_ORDER, SESSION_GROUP_LABELS,
  type SessionSummary,
} from '../chatSessions';
import { buildChatHints, CHAT_INTRO } from '../chatHints';

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
  followUpQuestions?: string[];
}

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/query`;

let idSeq = 0;
const newId = () => `msg-${Date.now()}-${idSeq++}`;

const HINTS_FALLBACK = [
  '劳动合同法关于加班工资的规定？',
  '民法典中合同解除的条件有哪些？',
  '公司股东转让股权需要哪些程序？',
  '劳动争议申请仲裁的时效是多久？',
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

function dbToAgentMsg(m: {
  id: string;
  role: string;
  content: string;
  citations: unknown[] | null;
  meta: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] } | null;
}): AgentMsg {
  const meta = m.meta ?? {};
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content ?? '',
    thinking: [],
    toolCalls: (meta.toolCalls ?? []).map(t => ({ ...t, done: true })),
    subAgents: [],
    citations: Array.isArray(m.citations) ? (m.citations as Citation[]) : [],
    latencyMs: meta.latencyMs,
    termination: meta.termination,
    followUpQuestions: Array.isArray(meta.followUpQuestions) ? meta.followUpQuestions : [],
    phase: 'done',
  };
}

export default function Chat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState('正在处理...');
  const [inputWhileLoading, setInputWhileLoading] = useState(false);
  const [skillLabels, setSkillLabels] = useState<Map<string, string>>(new Map());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [hints, setHints] = useState<string[]>(HINTS_FALLBACK);

  const wsRef = useRef<WebSocket | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const querySessionIdRef = useRef<string | null>(null);
  const assistantDraftRef = useRef<AgentMsg | null>(null);
  const finishedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const pendingSessionNavRef = useRef<string | null>(null);
  const pendingAssistantRef = useRef<AgentMsg | null>(null);
  const savedAssistantMsgIdRef = useRef<string | null>(null);
  const pendingAssistantPersistRef = useRef<Promise<string | null> | null>(null);
  const assistantPersistedRef = useRef(false);

  const setSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const { sessions: list } = await api.getSessions();
      setSessions(list.map(s => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })));
    } catch {
      /* 列表加载失败时静默 */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    api.getSkills()
      .then(r => {
        const map = new Map<string, string>();
        for (const s of r.skills ?? []) {
          if (s.name && s.displayName) map.set(s.name, s.displayName);
        }
        setSkillLabels(map);
      })
      .catch(() => { /* fallback */ });
    void refreshSessions();
    api.getDocuments()
      .then(r => setHints(buildChatHints(r.documents ?? [])))
      .catch(() => { /* 使用默认推荐 */ });
  }, [refreshSessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const patchAssistant = useCallback((fn: (m: AgentMsg) => AgentMsg) => {
    const id = assistantIdRef.current;
    if (!id) return;
    setMessages(prev => prev.map(msg => {
      if (msg.id !== id) return msg;
      const next = fn(msg);
      assistantDraftRef.current = next;
      const running = next.toolCalls.find(t => !t.done);
      if (next.phase === 'thinking' || next.phase === 'tool' || next.phase === 'writing') {
        setLoadingHint(statusMessage(next.phase, running?.name, running?.kind));
      }
      setInputWhileLoading(next.phase === 'writing');
      return next;
    }));
  }, []);

  const persistAssistant = useCallback(async (msg: AgentMsg, sid: string): Promise<string | null> => {
    try {
      const { message: savedMessage } = await api.addSessionMessage(sid, {
        role: 'assistant',
        content: msg.content,
        citations: msg.citations ?? [],
        meta: {
          latencyMs: msg.latencyMs,
          termination: msg.termination,
          toolCalls: msg.toolCalls.map(t => ({ name: t.name, kind: t.kind })),
          followUpQuestions: msg.followUpQuestions,
        },
      });
      void refreshSessions();
      return savedMessage.id as string;
    } catch (err) {
      message.warning(`回答未能保存到会话：${err instanceof Error ? err.message : '未知错误'}`);
      return null;
    }
  }, [refreshSessions]);

  const updateAssistantFollowUps = useCallback(async (sid: string, messageId: string, questions: string[]) => {
    try {
      await api.updateSessionMessage(sid, messageId, {
        meta: { followUpQuestions: questions },
      });
    } catch {
      /* 推荐问题更新失败不影响主回答 */
    }
  }, []);

  const finishAssistant = useCallback((patch: Partial<AgentMsg> & { content: string }) => {
    const assistantId = assistantIdRef.current;
    const sid = querySessionIdRef.current ?? sessionIdRef.current;
    if (!assistantId || finishedRef.current) return;
    finishedRef.current = true;
    assistantIdRef.current = null;
    pendingAssistantRef.current = null;
    setLoading(false);
    setInputWhileLoading(false);
    setLoadingHint('正在处理...');

    const draft = assistantDraftRef.current;
    assistantDraftRef.current = null;

    let saved: AgentMsg | undefined;
    setMessages(prev => prev.map(msg => {
      if (msg.id !== assistantId) return msg;
      saved = { ...msg, ...patch, phase: patch.phase ?? 'done' } as AgentMsg;
      return saved;
    }));

    if (!saved && draft) {
      saved = { ...draft, ...patch, id: assistantId, phase: patch.phase ?? 'done' } as AgentMsg;
      setMessages(prev => {
        const has = prev.some(m => m.id === assistantId);
        if (has) return prev.map(m => (m.id === assistantId ? saved! : m));
        return [...prev, saved!];
      });
    }

    if (saved && sid) {
      historyRef.current = [...historyRef.current, { role: 'assistant', content: patch.content }];
      if (!assistantPersistedRef.current) {
        assistantPersistedRef.current = true;
        const payload = { ...saved, content: sanitizeAnswerContent(patch.content) };
        pendingAssistantPersistRef.current = persistAssistant(payload, sid).then(id => {
          if (id) savedAssistantMsgIdRef.current = id;
          return id;
        });
      }
    } else if (saved && !sid) {
      message.warning('回答未能保存：会话 ID 丢失');
    }
    querySessionIdRef.current = null;
  }, [persistAssistant]);

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
    if (type === 'follow_up') {
      const questions = Array.isArray(data.questions)
        ? (data.questions as unknown[]).filter((q): q is string => typeof q === 'string')
        : [];
      setMessages(prev => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i];
          if (msg?.role !== 'assistant') continue;
          return [...prev.slice(0, i), { ...msg, followUpQuestions: questions }, ...prev.slice(i + 1)];
        }
        return prev;
      });
      const sid = sessionIdRef.current;
      void (async () => {
        const messageId = savedAssistantMsgIdRef.current
          ?? await pendingAssistantPersistRef.current?.catch(() => null);
        if (sid && messageId) {
          await updateAssistantFollowUps(sid, messageId, questions);
        }
      })();
      return;
    }
    if (type === 'result') {
      const answer = typeof data.answer === 'string' ? data.answer : '';
      const citations = (data.citations as Citation[]) ?? [];
      const followUpQuestions = Array.isArray(data.followUpQuestions)
        ? (data.followUpQuestions as unknown[]).filter((q): q is string => typeof q === 'string')
        : undefined;
      finishAssistant({
        content: sanitizeAnswerContent(answer),
        citations,
        followUpQuestions,
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
      return;
    }
  }, [patchAssistant, finishAssistant, updateAssistantFollowUps]);

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
        const draft = assistantDraftRef.current;
        finishAssistant({
          content: draft?.content || '⚠️ 连接已断开',
          citations: draft?.citations ?? [],
          latencyMs: draft?.latencyMs,
          termination: draft?.termination,
          phase: draft?.content ? 'done' : 'error',
        });
      }
    };
  }, [finishAssistant, patchAssistant]);

  const startNewChat = useCallback(() => {
    if (loading) {
      message.info('请等待当前回答完成');
      return;
    }
    pendingSessionNavRef.current = null;
    querySessionIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    historyRef.current = [];
    setQuestion('');
    navigate('/chat');
  }, [loading, navigate, setSessionId]);

  const loadSession = useCallback(async (id: string) => {
    if (loading) {
      message.info('请等待当前回答完成');
      return;
    }
    if (assistantIdRef.current && querySessionIdRef.current === id) {
      return;
    }
    setLoadingSession(true);
    try {
      const { messages: rows } = await api.getSession(id);
      const loaded = rows.map(dbToAgentMsg);
      setSessionId(id);
      setMessages(loaded);
      historyRef.current = loaded.map(m => ({ role: m.role, content: m.content }));
      if (loaded.length === 0) {
        message.info('该会话暂无已保存的消息');
      }
    } catch (err) {
      message.error(`加载会话失败：${err instanceof Error ? err.message : '未知错误'}`);
      navigate('/chat', { replace: true });
    } finally {
      setLoadingSession(false);
    }
  }, [loading, navigate, setSessionId]);

  useEffect(() => {
    if (loading) return;

    if (!urlSessionId) {
      if (pendingSessionNavRef.current || querySessionIdRef.current) return;
      if (activeSessionId !== null) {
        setSessionId(null);
        setMessages([]);
        historyRef.current = [];
        setQuestion('');
      }
      return;
    }

    if (pendingSessionNavRef.current === urlSessionId) {
      pendingSessionNavRef.current = null;
      if (activeSessionId !== urlSessionId) {
        setSessionId(urlSessionId);
      }
      return;
    }

    if (assistantIdRef.current && querySessionIdRef.current === urlSessionId) return;
    if (urlSessionId === activeSessionId) return;
    void loadSession(urlSessionId);
  }, [urlSessionId, activeSessionId, loading, loadSession, setSessionId]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id);
      if (activeSessionId === id) startNewChat();
      void refreshSessions();
    } catch {
      message.error('删除失败');
    }
  }, [activeSessionId, startNewChat, refreshSessions]);

  const send = useCallback(async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || loading) return;

    let sessionId = sessionIdRef.current;
    if (!sessionId) {
      try {
        const { session } = await api.createSession({ question: text });
        sessionId = session.id as string;
        pendingSessionNavRef.current = sessionId;
        querySessionIdRef.current = sessionId;
        setSessionId(sessionId);
        navigate(`/chat/${sessionId}`, { replace: true });
        void refreshSessions();
      } catch {
        message.error('创建会话失败');
        return;
      }
    }

    try {
      await api.addSessionMessage(sessionId, { role: 'user', content: text });
    } catch {
      message.warning('消息保存失败，但仍将继续回答');
    }

    const userMsg: AgentMsg = {
      id: newId(), role: 'user', content: text,
      thinking: [], toolCalls: [], subAgents: [], citations: [], phase: 'done',
    };
    const botMsg = emptyAssistant();
    pendingAssistantRef.current = botMsg;
    assistantDraftRef.current = botMsg;
    assistantIdRef.current = botMsg.id;
    finishedRef.current = false;
    savedAssistantMsgIdRef.current = null;
    pendingAssistantPersistRef.current = null;
    assistantPersistedRef.current = false;
    querySessionIdRef.current = sessionId;
    setMessages(prev => [...prev, userMsg, botMsg]);
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    setQuestion('');
    setLoading(true);
    setLoadingHint('正在理解您的问题...');
    setInputWhileLoading(false);
    void refreshSessions();

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
  }, [question, loading, bindWs, refreshSessions, navigate, setSessionId]);

  const grouped = groupSessions(sessions);
  const isDraft = activeSessionId === null && messages.length === 0;
  const showIntro =
    (isDraft && !loadingSession) ||
    (!isDraft && !loadingSession && messages.length === 0 && activeSessionId !== null);

  return (
    <div className="kc-chat">
    <div className="kc-chat-layout">
      <aside className="kc-chat-sidebar">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          className="kc-chat-new-btn"
          onClick={startNewChat}
        >
          新会话
        </Button>
        <div className="kc-chat-session-list">
          {sessionsLoading ? (
            <div className="kc-chat-session-loading"><Spin size="small" /></div>
          ) : sessions.length === 0 ? (
            <Text type="secondary" className="kc-chat-session-empty">暂无历史会话</Text>
          ) : (
            SESSION_GROUP_ORDER.map(key => {
              const items = grouped[key];
              if (!items?.length) return null;
              return (
                <div key={key} className="kc-chat-session-group">
                  <div className="kc-chat-session-group-title">{SESSION_GROUP_LABELS[key]}</div>
                  {items.map(s => (
                    <div
                      key={s.id}
                      className={`kc-chat-session-item${activeSessionId === s.id ? ' active' : ''}`}
                      onClick={() => { navigate(`/chat/${s.id}`); }}
                      onKeyDown={e => { if (e.key === 'Enter') navigate(`/chat/${s.id}`); }}
                      role="button"
                      tabIndex={0}
                    >
                      <MessageOutlined className="kc-chat-session-icon" />
                      <span className="kc-chat-session-title">{s.title}</span>
                      <Popconfirm
                        title="删除此会话？"
                        onConfirm={e => { e?.stopPropagation(); void deleteSession(s.id); }}
                        onCancel={e => e?.stopPropagation()}
                      >
                        <Button
                          type="text"
                          size="small"
                          className="kc-chat-session-del"
                          icon={<DeleteOutlined />}
                          onClick={e => e.stopPropagation()}
                        />
                      </Popconfirm>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </aside>

      <div className="kc-chat-main">
        <Card bordered={false} className="kc-chat-card" styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, minHeight: 0 } }}>
          <div className="kc-chat-messages-wrap">
            {loadingSession && (
              <div className="kc-chat-loading-mask">
                <Spin />
              </div>
            )}
            <div className={`kc-chat-messages${showIntro ? ' kc-chat-messages--intro' : ''}`}>
              <div className="kc-chat-messages-inner">
                {isDraft && !loadingSession && (
                  <div className="kc-chat-empty">
                    <div className="kc-chat-empty-icon">⚖️</div>
                    <div className="kc-chat-empty-title">法律助手</div>
                    <Text type="secondary">{CHAT_INTRO}</Text>
                    <div className="kc-chat-hints">
                      {hints.map(h => (
                        <button key={h} type="button" className="kc-chat-hint" onClick={() => { void send(h); }}>{h}</button>
                      ))}
                    </div>
                  </div>
                )}
                {!isDraft && !loadingSession && messages.length === 0 && activeSessionId && (
                  <div className="kc-chat-empty kc-chat-empty-short">
                    <Text type="secondary">该会话暂无消息，继续提问吧</Text>
                  </div>
                )}
                {messages.map(m => (
                  <MsgBubble
                    key={m.id}
                    msg={m}
                    skillLabels={skillLabels}
                    onFollowUp={q => { void send(q); }}
                  />
                ))}
                <div ref={endRef} />
              </div>
            </div>
          </div>

          <div className="kc-chat-input-bar">
            <div className="kc-chat-input-inner">
              <Space.Compact style={{ width: '100%' }}>
              <TextArea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder="输入法律问题，Enter 发送，Shift+Enter 换行..."
                autoSize={{ minRows: 1, maxRows: 4 }}
                disabled={loading && !inputWhileLoading}
                style={{ borderRadius: '8px 0 0 8px' }}
              />
              <Button
                type="primary"
                icon={loading ? <LoadingOutlined /> : <SendOutlined />}
                onClick={() => { void send(); }}
                disabled={(loading && !inputWhileLoading) || !question.trim()}
                style={{ height: 'auto', minHeight: 40, borderRadius: '0 8px 8px 0' }}
              >
                {loading ? loadingHint : '发送'}
              </Button>
            </Space.Compact>
            </div>
            <p className="kc-chat-disclaimer">
            以上内容仅供参考，不构成法律意见。具体问题请咨询专业律师。
            </p>
          </div>
        </Card>
      </div>
    </div>
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

function MsgBubble({
  msg,
  skillLabels,
  onFollowUp,
}: {
  msg: AgentMsg;
  skillLabels: Map<string, string>;
  onFollowUp?: (q: string) => void;
}) {
  if (msg.role === 'user') {
    return (
      <div className="kc-chat-row kc-chat-row-user">
        <div className="kc-chat-bubble-user">{msg.content}</div>
        <div className="kc-chat-avatar kc-chat-avatar-user"><UserOutlined /></div>
      </div>
    );
  }

  const isDone = msg.phase === 'done' || msg.phase === 'error';
  const visibleCalls = msg.toolCalls.filter(t => shouldShowAction(t.name));
  const totalCalls = visibleCalls.length;

  return (
    <div className="kc-chat-row kc-chat-row-bot">
      <div className="kc-chat-avatar kc-chat-avatar-bot"><RobotOutlined /></div>
      <div className="kc-chat-bubble-agent">
        <StatusLine msg={msg} />

        {isDone && <DoneActions msg={msg} skillLabels={skillLabels} />}

        {!msg.content && !isDone ? (
          <div className="kc-chat-answer-skeleton" aria-hidden="true">
            <span /><span /><span />
          </div>
        ) : null}

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
          <Collapse
            ghost
            className="kc-chat-citations-collapse"
            items={[{
              key: 'citations',
              label: (
                <span className="kc-chat-citations-label">
                  <PaperClipOutlined /> 引用来源 ({msg.citations.length})
                </span>
              ),
              children: (
                <div className="kc-chat-citations">
                  {msg.citations.map((c, i) => (
                    <div key={i} className="kc-chat-citation-item">
                      <span className="kc-chat-citation-index">[{i + 1}]</span>
                      <span className="kc-chat-citation-score">{Number(c.score ?? 0).toFixed(2)}</span>
                      <strong>{c.documentTitle || '未知文档'}</strong>
                      <div className="kc-chat-citation-excerpt">{(c.excerpt ?? '').slice(0, 200)}</div>
                    </div>
                  ))}
                </div>
              ),
            }]}
          />
        )}

        {isDone && (msg.followUpQuestions?.length ?? 0) > 0 && (
          <div className="kc-chat-followups">
            <div className="kc-chat-followups-title">您可能还想问</div>
            <div className="kc-chat-hints">
              {msg.followUpQuestions!.map(q => (
                <button
                  key={q}
                  type="button"
                  className="kc-chat-hint"
                  onClick={() => { onFollowUp?.(q); }}
                >
                  {q}
                </button>
              ))}
            </div>
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
