import type { Dataset } from './types';

const headers = { 'Content-Type': 'application/json' };
const json = <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  return r.json() as Promise<T>;
};

export const api = {
  getDatasets: () => fetch('/api/datasets').then(json<{ datasets: Dataset[] }>),
  getStats: () => fetch('/api/stats').then(json<Record<string, any>>),

  getAgents: () => fetch('/api/agents').then(json<{ agents: any[] }>),
  getAgent: (id: string) => fetch(`/api/agents/${id}`).then(json<any>),
  createAgent: (data: any) =>
    fetch('/api/agents', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建失败'))),
  updateAgent: (id: string, data: any) =>
    fetch(`/api/agents/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('更新失败'))),
  deleteAgent: (id: string) =>
    fetch(`/api/agents/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),

  getModels: () => fetch('/api/models').then(json<{ models: any[] }>),
  getModel: (id: string) => fetch(`/api/models/${id}`).then(json<any>),
  createModel: (data: any) =>
    fetch('/api/models', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建失败'))),
  updateModel: (id: string, data: any) =>
    fetch(`/api/models/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('更新失败'))),
  deleteModel: (id: string) =>
    fetch(`/api/models/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),

  getSkills: () => fetch('/api/skills').then(json<{ skills: any[] }>),
  getSkill: (id: string) => fetch(`/api/skills/${id}`).then(json<any>),
  createSkill: (data: any) =>
    fetch('/api/skills', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建失败'))),
  updateSkill: (id: string, data: any) =>
    fetch(`/api/skills/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('更新失败'))),
  deleteSkill: (id: string) =>
    fetch(`/api/skills/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),
  getSkillToolOptions: () =>
    fetch('/api/skill-meta/tool-options').then(json<{ tools: Array<{ name: string; description: string }> }>),

  getDocuments: () => fetch('/api/documents').then(json<{ documents: any[] }>),
  getDocument: (id: string) => fetch(`/api/documents/${id}`).then(json<any>),
  getDocumentChunks: (id: string) => fetch(`/api/documents/${id}/chunks`).then(json<{ chunks: any[] }>),
  getDocumentContent: (id: string) => fetch(`/api/documents/${id}/content`).then(r => r.text()),
  deleteDocument: (id: string) =>
    fetch(`/api/documents/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),
  reingestDocument: (id: string) =>
    fetch(`/api/documents/${id}/reingest`, { method: 'POST' }).then(r => r.ok ? r.json() : Promise.reject(new Error('重新嵌入失败'))),
  uploadDocument: (file: File, datasetId?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (datasetId) fd.append('datasetId', datasetId);
    return fetch('/ingest', { method: 'POST', body: fd }).then(r => r.ok ? r.json() : Promise.reject(new Error('上传失败')));
  },

  getSettings: () => fetch('/api/settings').then(json<{ settings: Record<string, unknown>; defaults: Record<string, unknown> }>),
  updateSettings: (data: Record<string, unknown>) =>
    fetch('/api/settings', { method: 'PUT', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('保存失败'))),

  getSessions: () => fetch('/api/sessions').then(json<{ sessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }> }>),
  getSession: (id: string) => fetch(`/api/sessions/${id}`).then(json<{
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
    fetch('/api/sessions', { method: 'POST', headers, body: JSON.stringify(data) }).then(r => r.ok ? r.json() : Promise.reject(new Error('创建会话失败'))),
  addSessionMessage: (sessionId: string, data: {
    role: 'user' | 'assistant';
    content: string;
    citations?: unknown[];
    meta?: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] };
  }) =>
    fetch(`/api/sessions/${sessionId}/messages`, { method: 'POST', headers, body: JSON.stringify(data) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('保存消息失败'))),
  updateSessionMessage: (sessionId: string, messageId: string, data: {
    content?: string;
    citations?: unknown[];
    meta?: { latencyMs?: number; termination?: string; toolCalls?: Array<{ name: string; kind: string }>; followUpQuestions?: string[] };
  }) =>
    fetch(`/api/sessions/${sessionId}/messages/${messageId}`, { method: 'PATCH', headers, body: JSON.stringify(data) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('更新消息失败'))),
  deleteSession: (id: string) =>
    fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then(r => r.ok ? r.json() : Promise.reject(new Error('删除失败'))),
};
