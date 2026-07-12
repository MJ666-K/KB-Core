import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Input, Button, Card, Typography, Popconfirm, message, Spin, Collapse,
} from 'antd';
import {
  SendOutlined, PaperClipOutlined, RobotOutlined, UserOutlined, LoadingOutlined,
  PlusOutlined, DeleteOutlined, MessageOutlined, StopOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { kgApi } from '../api/kgApi';
import MarkdownContent from '../MarkdownContent';
import { sanitizeAnswerContent } from '../sanitizeAnswerContent';
import { statusMessage, shouldShowAction } from '../chatLabels';
import {
  groupSessions, SESSION_GROUP_ORDER, SESSION_GROUP_LABELS,
  type SessionSummary,
} from '../chatSessions';
import { buildChatHints, CHAT_INTRO } from '../chatHints';
import { getAuthToken } from '../auth/storage';

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

const PERSISTED_MSG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPersistedMessageId(id: string): boolean {
  return PERSISTED_MSG_ID.test(id);
}

/** 从已加载消息中找到最后一条已入库的 assistant 消息 id */
function findLastPersistedAssistantId(msgs: AgentMsg[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === 'assistant' && isPersistedMessageId(m.id)) return m.id;
  }
  return null;
}

function findLastUserIndex(msgs: AgentMsg[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === 'user') return i;
  }
  return -1;
}

/** 进行中任务对应的 assistant：优先 persistedId，否则取最后一轮 user 之后的 assistant */
function findAssistantForActiveJob(msgs: AgentMsg[], persistedId?: string | null): AgentMsg | null {
  if (persistedId) {
    const found = msgs.find(m => m.id === persistedId && m.role === 'assistant');
    if (found) return found;
  }
  const lastUserIdx = findLastUserIndex(msgs);
  for (let i = msgs.length - 1; i > lastUserIdx; i--) {
    const m = msgs[i];
    if (m?.role === 'assistant') return m;
  }
  return null;
}

/** 去掉最后一轮 user 之后多余的 assistant，只保留 keepId */
function dedupeTrailingAssistants(msgs: AgentMsg[], keepId: string): AgentMsg[] {
  const lastUserIdx = findLastUserIndex(msgs);
  return msgs.filter((m, i) => {
    if (i <= lastUserIdx) return true;
    if (m.role !== 'assistant') return true;
    return m.id === keepId;
  });
}

function syncAssistantLocalId(localId: string, dbId: string, draft: AgentMsg | null): AgentMsg | null {
  if (!draft || draft.id !== localId) return draft;
  return { ...draft, id: dbId };
}

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

function assistantPersistBody(msg: AgentMsg, contentOverride?: string) {
  return {
    content: sanitizeAnswerContent(contentOverride ?? msg.content),
    citations: msg.citations ?? [],
    meta: {
      latencyMs: msg.latencyMs,
      termination: msg.termination,
      toolCalls: msg.toolCalls.map(t => ({ name: t.name, kind: t.kind })),
      followUpQuestions: msg.followUpQuestions,
    },
  };
}

function dbToAgentMsg(m: {
  id: string;
  role: string;
  content: string;
  citations: unknown[] | null;
  meta: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] } | null;
}): AgentMsg {
  const meta = m.meta ?? {};
  const isAssistant = m.role === 'assistant';
  // 无 termination 表示回答未结束（含流式中途保存的部分内容）
  const incomplete = isAssistant && !meta.termination;
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
    phase: incomplete ? 'writing' : 'done',
  };
}

export default function Chat() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [hints, setHints] = useState<string[]>(HINTS_FALLBACK);
  const [kgNodeInitialQuery, setKgNodeInitialQuery] = useState<string | null>(null);

  // 处理 ?kgNode=xxx 入参：从图谱跳到 Chat 时预填问题
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const kgNodeId = searchParams.get('kgNode');
    if (!kgNodeId) {
      setKgNodeInitialQuery(null);
      return;
    }
    let cancelled = false;
    kgApi.getNode(kgNodeId)
      .then(({ node }) => {
        if (cancelled || !node) return;
        const question = `请介绍一下「${node.label}」节点（${node.type} · ${node.category}）的相关内容，包括它的法律依据、关联证据和参考案例。`;
        setKgNodeInitialQuery(question);
      })
      .catch(() => { /* ignore */ })
      .finally(() => {
        // 清掉 URL 参数，避免重复触发
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('kgNode');
          setSearchParams(next, { replace: true });
        }
      });
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams]);

  const wsRef = useRef<WebSocket | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const querySessionIdRef = useRef<string | null>(null);
  const assistantDraftRef = useRef<AgentMsg | null>(null);
  const finishedRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const stoppedByUserRef = useRef(false);
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const pendingSessionNavRef = useRef<string | null>(null);
  const pendingAssistantRef = useRef<AgentMsg | null>(null);
  const savedAssistantMsgIdRef = useRef<string | null>(null);
  const pendingAssistantPersistRef = useRef<Promise<string | null> | null>(null);
  const syncDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushAssistantDraftRef = useRef<() => Promise<void>>(async () => {});
  const wsAuthedRef = useRef(false);
  const pendingWsPayloadRef = useRef<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const jobPollSinceRef = useRef(0);
  const jobPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopJobPollingRef = useRef<() => void>(() => {});
  const startJobPollingRef = useRef<(jobId: string) => void>(() => {});

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
    void refreshSessions();
    api.getDocuments()
      .then(r => setHints(buildChatHints(r.documents ?? [])))
      .catch(() => { /* 使用默认推荐 */ });
  }, [refreshSessions]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = messagesScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [messages]);

  useEffect(() => () => {
    stopJobPollingRef.current();
    wsRef.current?.close();
  }, []);

  const patchAssistant = useCallback((fn: (m: AgentMsg) => AgentMsg) => {
    const id = assistantIdRef.current;
    if (!id) return;
    setMessages(prev => prev.map(msg => {
      if (msg.id !== id) return msg;
      const next = fn(msg);
      assistantDraftRef.current = next;
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

  const resolveAssistantMsgId = useCallback(async (): Promise<string | null> => {
    if (savedAssistantMsgIdRef.current) return savedAssistantMsgIdRef.current;
    if (pendingAssistantPersistRef.current) {
      return pendingAssistantPersistRef.current.catch(() => null);
    }
    return null;
  }, []);

  const ensureAssistantMessage = useCallback(async (): Promise<string | null> => {
    const existing = await resolveAssistantMsgId();
    if (existing) return existing;

    const sid = querySessionIdRef.current ?? sessionIdRef.current;
    const draft = assistantDraftRef.current;
    if (!sid || !draft) return null;

    if (!pendingAssistantPersistRef.current) {
      const localId = assistantIdRef.current;
      pendingAssistantPersistRef.current = persistAssistant(
        { ...draft, content: draft.content || '' },
        sid,
      ).then(id => {
        if (id) {
          savedAssistantMsgIdRef.current = id;
          if (localId && localId !== id) {
            assistantIdRef.current = id;
            assistantDraftRef.current = syncAssistantLocalId(localId, id, assistantDraftRef.current);
            pendingAssistantRef.current = syncAssistantLocalId(localId, id, pendingAssistantRef.current);
            setMessages(prev => prev.map(m => (m.id === localId ? { ...m, id } : m)));
          }
        }
        return id;
      }).finally(() => {
        pendingAssistantPersistRef.current = null;
      });
    }
    return pendingAssistantPersistRef.current;
  }, [persistAssistant, resolveAssistantMsgId]);

  const flushAssistantDraft = useCallback(async () => {
    if (syncDraftTimerRef.current) {
      clearTimeout(syncDraftTimerRef.current);
      syncDraftTimerRef.current = null;
    }
    const sid = querySessionIdRef.current ?? sessionIdRef.current;
    const draft = assistantDraftRef.current;
    if (!sid || !draft || finishedRef.current) return;

    const body = assistantPersistBody(draft);
    if (!body.content.trim()) return;

    const msgId = await resolveAssistantMsgId();
    if (!msgId) return;

    try {
      await api.updateSessionMessage(sid, msgId, body);
    } catch {
      /* 流式增量保存失败时静默，最终完成时会再试 */
    }
  }, [resolveAssistantMsgId]);

  flushAssistantDraftRef.current = flushAssistantDraft;

  const scheduleSyncDraft = useCallback(() => {
    if (syncDraftTimerRef.current) clearTimeout(syncDraftTimerRef.current);
    syncDraftTimerRef.current = setTimeout(() => {
      syncDraftTimerRef.current = null;
      void flushAssistantDraft();
    }, 600);
  }, [flushAssistantDraft]);

  const finalizeAssistantPersist = useCallback(async (msg: AgentMsg, sid: string) => {
    const body = assistantPersistBody(msg);
    const msgId = await resolveAssistantMsgId();
    if (msgId) {
      try {
        await api.updateSessionMessage(sid, msgId, body);
        savedAssistantMsgIdRef.current = msgId;
        void refreshSessions();
        return msgId;
      } catch (err) {
        message.warning(`回答未能保存到会话：${err instanceof Error ? err.message : '未知错误'}`);
        return null;
      }
    }
    const id = await persistAssistant(msg, sid);
    if (id) savedAssistantMsgIdRef.current = id;
    return id;
  }, [persistAssistant, resolveAssistantMsgId, refreshSessions]);

  useEffect(() => {
    const onBeforeUnload = () => {
      const sid = sessionIdRef.current;
      const msgId = savedAssistantMsgIdRef.current;
      const draft = assistantDraftRef.current;
      if (!sid || !msgId || !draft?.content?.trim() || finishedRef.current) return;
      const body = assistantPersistBody(draft);
      const token = getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      fetch(`/api/sessions/${sid}/messages/${msgId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => { /* 页面卸载时尽力保存 */ });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const finishAssistant = useCallback((patch: Partial<AgentMsg> & { content: string }) => {
    const assistantId = assistantIdRef.current;
    const sid = querySessionIdRef.current ?? sessionIdRef.current;
    if (!assistantId || finishedRef.current) return;
    finishedRef.current = true;
    assistantIdRef.current = null;
    pendingAssistantRef.current = null;
    activeJobIdRef.current = null;
    stopJobPollingRef.current();
    setLoading(false);

    const draft = assistantDraftRef.current;
    assistantDraftRef.current = null;

    let saved: AgentMsg | undefined;
    setMessages(prev => {
      const mapped = prev.map(msg => {
        if (msg.id !== assistantId) return msg;
        saved = { ...msg, ...patch, phase: patch.phase ?? 'done' } as AgentMsg;
        return saved;
      });
      return dedupeTrailingAssistants(mapped, assistantId);
    });

    if (!saved && draft) {
      saved = { ...draft, ...patch, id: assistantId, phase: patch.phase ?? 'done' } as AgentMsg;
      setMessages(prev => {
        const has = prev.some(m => m.id === assistantId);
        const next = has
          ? prev.map(m => (m.id === assistantId ? saved! : m))
          : [...prev, saved!];
        return dedupeTrailingAssistants(next, assistantId);
      });
    }

    if (saved && sid) {
      historyRef.current = [...historyRef.current, { role: 'assistant', content: patch.content }];
      if (syncDraftTimerRef.current) {
        clearTimeout(syncDraftTimerRef.current);
        syncDraftTimerRef.current = null;
      }
      const payload = { ...saved, content: sanitizeAnswerContent(patch.content) };
      pendingAssistantPersistRef.current = finalizeAssistantPersist(payload, sid).then(id => id);
    } else if (saved && !sid) {
      message.warning('回答未能保存：会话 ID 丢失');
    }
    querySessionIdRef.current = null;
  }, [finalizeAssistantPersist]);

  const handleMsg = useCallback((data: Record<string, unknown>) => {
    const type = data.type as string;
    const sub = data.subAgent as SubAgent | undefined;
    const token = data.token as string | undefined;
    const apply = (fn: (m: AgentMsg) => AgentMsg) => patchAssistant(fn);

    if (type === 'auth_ok') {
      wsAuthedRef.current = true;
      const ws = wsRef.current;
      if (ws && pendingWsPayloadRef.current) {
        ws.send(pendingWsPayloadRef.current);
        pendingWsPayloadRef.current = null;
      }
      return;
    }
    if (type === 'job_started') {
      activeJobIdRef.current = typeof data.jobId === 'string' ? data.jobId : null;
      return;
    }
    if (type === 'resume_ok') {
      const status = data.status as string | undefined;
      if (status === 'running' && activeJobIdRef.current) {
        if (typeof data.eventCount === 'number') {
          jobPollSinceRef.current = data.eventCount;
        }
        startJobPollingRef.current(activeJobIdRef.current);
      }
      return;
    }
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
      if (!savedAssistantMsgIdRef.current) {
        void ensureAssistantMessage();
      }
      return;
    }
    if (type === 'token' && token) {
      apply(msg => ({ ...msg, phase: 'writing', content: msg.content + token }));
      if (!savedAssistantMsgIdRef.current) {
        void ensureAssistantMessage().then(() => { scheduleSyncDraft(); });
      } else {
        scheduleSyncDraft();
      }
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
      if (finishedRef.current) return;
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
      if (finishedRef.current) return;
      const detail = data.detail ? `: ${JSON.stringify(data.detail)}` : '';
      finishAssistant({
        content: `❌ ${data.error as string}${detail}`,
        phase: 'error',
      });
      return;
    }
  }, [patchAssistant, finishAssistant, updateAssistantFollowUps, ensureAssistantMessage, scheduleSyncDraft]);

  const handleMsgRef = useRef(handleMsg);
  handleMsgRef.current = handleMsg;

  const stopJobPolling = useCallback(() => {
    if (jobPollTimerRef.current) {
      clearInterval(jobPollTimerRef.current);
      jobPollTimerRef.current = null;
    }
  }, []);
  stopJobPollingRef.current = stopJobPolling;

  const startJobPolling = useCallback((jobId: string) => {
    stopJobPolling();
    jobPollTimerRef.current = setInterval(() => {
      void (async () => {
        try {
          const { events, nextSince, job } = await api.getQueryJob(jobId, jobPollSinceRef.current);
          jobPollSinceRef.current = nextSince;
          for (const ev of events) {
            handleMsgRef.current(ev);
          }
          if (job.status === 'completed') {
            stopJobPolling();
            activeJobIdRef.current = null;
            if (job.result && typeof job.result === 'object') {
              handleMsgRef.current(job.result as Record<string, unknown>);
            }
          } else if (job.status === 'failed') {
            stopJobPolling();
            activeJobIdRef.current = null;
            finishAssistant({
              content: `❌ ${typeof job.error === 'string' ? job.error : '查询失败'}`,
              phase: 'error',
            });
          }
        } catch {
          stopJobPolling();
        }
      })();
    }, 1500);
  }, [stopJobPolling, finishAssistant]);
  startJobPollingRef.current = startJobPolling;

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
      wsAuthedRef.current = false;
      if (stoppedByUserRef.current) {
        stoppedByUserRef.current = false;
        return;
      }
      if (!assistantIdRef.current || finishedRef.current) return;
      void flushAssistantDraftRef.current();
      if (activeJobIdRef.current) {
        startJobPollingRef.current(activeJobIdRef.current);
        return;
      }
      const draft = assistantDraftRef.current;
      if (!draft?.content?.trim()) return;
      finishAssistant({
        content: draft.content,
        citations: draft.citations ?? [],
        latencyMs: draft.latencyMs,
        termination: draft.termination,
        phase: 'done',
      });
    };
  }, [finishAssistant]);

  const connectWsWithPayload = useCallback((payload: string) => {
    const dispatch = (ws: WebSocket) => {
      if (wsAuthedRef.current) {
        ws.send(payload);
      } else {
        pendingWsPayloadRef.current = payload;
        ws.send(JSON.stringify({ type: 'auth', token: getAuthToken() }));
      }
    };

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      bindWs(wsRef.current);
      dispatch(wsRef.current);
      return;
    }

    wsAuthedRef.current = false;
    pendingWsPayloadRef.current = payload;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    bindWs(ws);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: getAuthToken() }));
    };
  }, [bindWs]);

  const resumeActiveJob = useCallback(async (
    sessionId: string,
    jobId: string,
    partialAnswer: string,
    persistedAssistantId?: string | null,
  ) => {
    let eventSince = 0;
    try {
      const detail = await api.getQueryJob(jobId, 0);
      eventSince = detail.nextSince;
    } catch {
      return;
    }
    jobPollSinceRef.current = eventSince;
    activeJobIdRef.current = jobId;
    querySessionIdRef.current = sessionId;
    finishedRef.current = false;
    pendingAssistantPersistRef.current = null;
    savedAssistantMsgIdRef.current =
      persistedAssistantId && isPersistedMessageId(persistedAssistantId)
        ? persistedAssistantId
        : null;

    setMessages(prev => {
      const target = findAssistantForActiveJob(prev, persistedAssistantId);
      if (target) {
        assistantIdRef.current = target.id;
        if (isPersistedMessageId(target.id)) {
          savedAssistantMsgIdRef.current = target.id;
        }
        const content = partialAnswer.length > target.content.length ? partialAnswer : target.content;
        const merged: AgentMsg = {
          ...target,
          content,
          phase: 'writing',
          termination: undefined,
        };
        assistantDraftRef.current = merged;
        pendingAssistantRef.current = merged;
        const withoutDupes = dedupeTrailingAssistants(prev, target.id);
        return withoutDupes.map(m => (m.id === target.id ? merged : m));
      }
      const bot = emptyAssistant();
      if (partialAnswer) {
        bot.content = partialAnswer;
        bot.phase = 'writing';
      }
      assistantIdRef.current = bot.id;
      assistantDraftRef.current = bot;
      pendingAssistantRef.current = bot;
      return [...prev, bot];
    });

    setLoading(true);
    stickToBottomRef.current = true;
    if (!savedAssistantMsgIdRef.current) {
      void ensureAssistantMessage();
    }

    connectWsWithPayload(JSON.stringify({
      type: 'resume',
      jobId,
      sessionId,
      since: eventSince,
    }));
  }, [connectWsWithPayload, ensureAssistantMessage]);

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
      const lastPersistedAssistantId = findLastPersistedAssistantId(loaded);
      setSessionId(id);
      setMessages(loaded);
      historyRef.current = loaded.map(m => ({ role: m.role, content: m.content }));
      if (loaded.length === 0) {
        message.info('该会话暂无已保存的消息');
      }

      try {
        const jobInfo = await api.getActiveQueryJob(id);
        if (jobInfo.active && jobInfo.jobId) {
          await resumeActiveJob(
            id,
            jobInfo.jobId,
            jobInfo.partialAnswer ?? '',
            lastPersistedAssistantId,
          );
        }
      } catch {
        /* 无进行中的查询时忽略 */
      }
    } catch (err) {
      message.error(`加载会话失败：${err instanceof Error ? err.message : '未知错误'}`);
      navigate('/chat', { replace: true });
    } finally {
      setLoadingSession(false);
    }
  }, [loading, navigate, setSessionId, resumeActiveJob]);

  useEffect(() => {
    if (loading) return;

    if (!urlSessionId) {
      if (pendingSessionNavRef.current || querySessionIdRef.current) return;
      if (activeSessionId !== null) {
        setSessionId(null);
        setMessages([]);
        historyRef.current = [];
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

  const send = useCallback(async (q: string) => {
    const text = q.trim();
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
    if (syncDraftTimerRef.current) {
      clearTimeout(syncDraftTimerRef.current);
      syncDraftTimerRef.current = null;
    }
    querySessionIdRef.current = sessionId;
    setMessages(prev => [...prev, userMsg, botMsg]);
    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    setLoading(true);
    stickToBottomRef.current = true;
    void refreshSessions();

    const payload = JSON.stringify({
      type: 'query',
      question: text,
      sessionId,
      options: { history: historyRef.current.slice(0, -1).slice(-20), topK: 5 },
    });

    connectWsWithPayload(payload);
  }, [loading, connectWsWithPayload, refreshSessions, navigate, setSessionId]);

  const stopGeneration = useCallback(() => {
    if (!loading || finishedRef.current) return;
    stoppedByUserRef.current = true;
    stopJobPollingRef.current();
    if (syncDraftTimerRef.current) {
      clearTimeout(syncDraftTimerRef.current);
      syncDraftTimerRef.current = null;
    }
    const draft = assistantDraftRef.current;
    const partial = draft?.content?.trim();
    finishAssistant({
      content: partial || '（已停止生成）',
      citations: draft?.citations ?? [],
      termination: 'cancelled',
      phase: 'done',
    });
    wsRef.current?.close();
  }, [loading, finishAssistant]);

  const sendRef = useRef(send);
  sendRef.current = send;
  const handleFollowUp = useCallback((q: string) => { void sendRef.current(q); }, []);

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
            <div
              ref={messagesScrollRef}
              className={`kc-chat-messages${showIntro ? ' kc-chat-messages--intro' : ''}`}
              onScroll={handleMessagesScroll}
            >
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
                    onFollowUp={handleFollowUp}
                  />
                ))}
                <div ref={endRef} />
              </div>
            </div>
          </div>

          <div className="kc-chat-input-bar">
            <ChatInputBar
              key={activeSessionId ?? 'draft'}
              loading={loading}
              onSend={send}
              onStop={stopGeneration}
              initialQuery={kgNodeInitialQuery ?? undefined}
            />
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

function AgentProgress({ msg }: { msg: AgentMsg }) {
  const isDone = msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'idle';
  if (isDone) return null;

  const hasContent = msg.content.length > 0;
  const running = msg.toolCalls.find(t => !t.done);
  const text = msg.phase === 'thinking' || msg.phase === 'tool' || msg.phase === 'writing'
    ? statusMessage(msg.phase, running?.name, running?.kind)
    : '处理中...';
  const hideStatus = msg.phase === 'writing' && hasContent;

  return (
    <div className="kc-chat-progress">
      <div className={`kc-chat-progress-inner${hideStatus ? ' kc-chat-progress-inner--hidden' : ''}`}>
        <LoadingOutlined spin className="kc-chat-progress-icon" />
        <span className="kc-chat-progress-text">{text}</span>
      </div>
      <div className={`kc-chat-progress-placeholder${hasContent ? ' kc-chat-progress-placeholder--hidden' : ''}`} aria-hidden="true">
        <span /><span /><span />
      </div>
    </div>
  );
}

function msgBubbleEqual(
  prev: Readonly<{ msg: AgentMsg; onFollowUp?: (q: string) => void }>,
  next: Readonly<{ msg: AgentMsg; onFollowUp?: (q: string) => void }>,
): boolean {
  const a = prev.msg;
  const b = next.msg;
  return a.id === b.id
    && a.content === b.content
    && a.phase === b.phase
    && a.citations.length === b.citations.length
    && (a.followUpQuestions?.length ?? 0) === (b.followUpQuestions?.length ?? 0)
    && a.latencyMs === b.latencyMs
    && a.toolCalls.length === b.toolCalls.length
    && prev.onFollowUp === next.onFollowUp;
}

const MsgBubble = memo(function MsgBubble({
  msg,
  onFollowUp,
}: {
  msg: AgentMsg;
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
        <AgentProgress msg={msg} />

        <div className={`kc-chat-answer-area${!msg.content && !isDone ? ' kc-chat-answer-area--empty' : ''}`}>
          {msg.content ? (
            <div className="kc-chat-answer">
              {msg.phase === 'error' ? (
                <span>{msg.content}</span>
              ) : (
                <MarkdownContent content={msg.content} streaming={msg.phase === 'writing'} />
              )}
              {msg.phase === 'writing' && <span className="kc-chat-cursor">▍</span>}
            </div>
          ) : null}
        </div>

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
}, msgBubbleEqual);

const ChatInputBar = memo(function ChatInputBar({
  loading,
  onSend,
  onStop,
  initialQuery,
}: {
  loading: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  initialQuery?: string;
}) {
  const [question, setQuestion] = useState('');

  // 从图谱跳转来时预填问题
  useEffect(() => {
    if (initialQuery) setQuestion(initialQuery);
  }, [initialQuery]);

  const submit = useCallback(() => {
    const text = question.trim();
    if (!text || loading) return;
    setQuestion('');
    onSend(text);
  }, [question, loading, onSend]);

  return (
    <div className="kc-chat-input-inner">
      <div className="kc-chat-input-row">
        <TextArea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onPressEnter={e => {
            if (!e.shiftKey) {
              e.preventDefault();
              if (loading) return;
              submit();
            }
          }}
          placeholder="输入法律问题，Enter 发送，Shift+Enter 换行..."
          className="kc-chat-input-field"
        />
        {loading ? (
          <Button
            danger
            type="primary"
            icon={<StopOutlined />}
            onClick={onStop}
            className="kc-chat-stop-btn"
          >
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={submit}
            disabled={!question.trim()}
            className="kc-chat-send-btn"
          >
            发送
          </Button>
        )}
      </div>
    </div>
  );
});
