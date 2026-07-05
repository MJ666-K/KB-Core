import type { Dataset } from './types';
import { authFetch } from './auth/AuthContext';

const headers = { 'Content-Type': 'application/json' };
const json = <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  return r.json() as Promise<T>;
};

export const api = {
  getDatasets: () => authFetch('/api/datasets').then(json<{ datasets: Dataset[] }>),
  getStats: () => authFetch('/api/stats').then(json<{
    documentCount: number;
    chunkCount: number;
    embeddingCount: number;
    queryCount: number;
    todayQueryCount: number;
    agentCount: number;
    modelCount: number;
    skillCount: number;
    userCount: number;
    sessionCount: number;
    datasetStats?: Array<{ name: string; docCount: number; chunkCount: number }>;
  }>),

  getAgents: () => authFetch('/api/agents').then(json<{ agents: any[] }>),
  getAgent: (id: string) => authFetch(`/api/agents/${id}`).then(json<any>),
  createAgent: (data: any) =>
    authFetch('/api/agents', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建失败'))),
  updateAgent: (id: string, data: any) =>
    authFetch(`/api/agents/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('更新失败'))),
  deleteAgent: (id: string) =>
    authFetch(`/api/agents/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),

  getModels: () => authFetch('/api/models').then(json<{ models: any[] }>),
  getModel: (id: string) => authFetch(`/api/models/${id}`).then(json<any>),
  createModel: (data: any) =>
    authFetch('/api/models', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建失败'))),
  updateModel: (id: string, data: any) =>
    authFetch(`/api/models/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('更新失败'))),
  deleteModel: (id: string) =>
    authFetch(`/api/models/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),

  getSkills: () => authFetch('/api/skills').then(json<{ skills: any[] }>),
  getSkill: (id: string) => authFetch(`/api/skills/${id}`).then(json<any>),
  createSkill: (data: any) =>
    authFetch('/api/skills', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建失败'))),
  updateSkill: (id: string, data: any) =>
    authFetch(`/api/skills/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('更新失败'))),
  deleteSkill: (id: string) =>
    authFetch(`/api/skills/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),
  getSkillToolOptions: () =>
    authFetch('/api/skill-meta/tool-options').then(json<{ tools: Array<{ name: string; description: string }> }>),

  getDocuments: () => authFetch('/api/documents').then(json<{ documents: any[] }>),
  getDocument: (id: string) => authFetch(`/api/documents/${id}`).then(json<any>),
  getDocumentChunks: (id: string) => authFetch(`/api/documents/${id}/chunks`).then(json<{ chunks: any[] }>),
  getDocumentContent: (id: string) => authFetch(`/api/documents/${id}/content`).then(r => r.text()),
  deleteDocument: (id: string) =>
    authFetch(`/api/documents/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),
  reingestDocument: (id: string) =>
    authFetch(`/api/documents/${id}/reingest`, { method: 'POST' }).then(r => r.ok ? r.json() : Promise.reject(new Error('重新嵌入失败'))),
  uploadDocument: (file: File, datasetName?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (datasetName) fd.append('dataset', datasetName);
    return authFetch('/ingest', { method: 'POST', body: fd }).then(r => r.ok ? r.json() : Promise.reject(new Error('上传失败')));
  },

  getSettings: () => authFetch('/api/settings').then(json<{ settings: Record<string, unknown>; defaults: Record<string, unknown> }>),
  updateSettings: (data: Record<string, unknown>) =>
    authFetch('/api/settings', { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('保存失败'))),

  getSessions: () => authFetch('/api/sessions').then(json<{ sessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }> }>),
  getSession: (id: string) => authFetch(`/api/sessions/${id}`).then(json<{
    session: { id: string; title: string; createdAt: string; updatedAt: string };
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      citations: unknown[];
      meta: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] };
      sortOrder: number;
      createdAt: string;
    }>;
  }>),
  createSession: (data: { question?: string; title?: string }) =>
    authFetch('/api/sessions', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建会话失败'))),
  addSessionMessage: (sessionId: string, data: {
    role: 'user' | 'assistant';
    content: string;
    citations?: unknown[];
    meta?: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] };
  }) =>
    authFetch(`/api/sessions/${sessionId}/messages`, { method: 'POST', headers, body: JSON.stringify(data) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('保存消息失败'))),
  updateSessionMessage: (sessionId: string, messageId: string, data: {
    content?: string;
    citations?: unknown[];
    meta?: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] };
  }) =>
    authFetch(`/api/sessions/${sessionId}/messages/${messageId}`, { method: 'PATCH', headers, body: JSON.stringify(data) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('更新消息失败'))),
  deleteSession: (id: string) =>
    authFetch(`/api/sessions/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),

  getActiveQueryJob: (sessionId: string) =>
    authFetch(`/api/query/sessions/${sessionId}/active`).then(json<{
      active: boolean;
      jobId?: string;
      status?: string;
      partialAnswer?: string;
    }>),

  getQueryJob: (jobId: string, since = 0) =>
    authFetch(`/api/query/jobs/${jobId}?since=${since}`).then(json<{
      job: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
      nextSince: number;
    }>),

  getUsers: () => authFetch('/api/users').then(json<{ users: Array<{
    id: string;
    username: string;
    role: string;
    roleLabel?: string;
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
  }> }>),
  getAssignableRoles: () => authFetch('/api/users/assignable-roles').then(json<{ roles: Array<{
    id: string;
    key: string;
    label: string;
    description: string;
    permissions: string[];
  }> }>),
  createUser: (data: { username: string; password: string; role: string }) =>
    authFetch('/api/users', { method: 'POST', headers, body: JSON.stringify(data) }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '创建失败');
      }
      return r.json();
    }),
  updateUser: (id: string, data: { role?: string; password?: string; disabled?: boolean }) =>
    authFetch(`/api/users/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '更新失败');
      }
      return r.json();
    }),
  deleteUser: (id: string) =>
    authFetch(`/api/users/${id}`, { method: 'DELETE' }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '删除失败');
      }
      return r.json();
    }),

  getRoles: () => authFetch('/api/roles').then(json<{ roles: Array<{
    id: string;
    key: string;
    label: string;
    description: string;
    isSystem: boolean;
    permissions: string[];
    userCount?: number;
  }> }>),
  getRoleMeta: () => authFetch('/api/roles/meta').then(json<{
    permissions: Array<{ key: string; label: string }>;
    groups: Array<{ title: string; permissions: Array<{ key: string; label: string }> }>;
  }>),
  createRole: (data: { key: string; label: string; description?: string; permissions: string[] }) =>
    authFetch('/api/roles', { method: 'POST', headers, body: JSON.stringify(data) }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '创建失败');
      }
      return r.json();
    }),
  updateRole: (id: string, data: { label?: string; description?: string; permissions?: string[] }) =>
    authFetch(`/api/roles/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '更新失败');
      }
      return r.json();
    }),
  deleteRole: (id: string) =>
    authFetch(`/api/roles/${id}`, { method: 'DELETE' }).then(async r => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '删除失败');
      }
      return r.json();
    }),
};
