import { Hono } from 'hono';
import type { AuthEnv } from '@infra/auth/middleware';
import { requirePermission } from '@infra/auth/middleware';
import { searchKnowledgeTool } from '@features/kb/tools/search-knowledge';
import { getDocumentTool } from '@features/kb/tools/get-document';
import { getChunkTool } from '@features/kb/tools/get-chunk';
import { listDocumentsTool } from '@features/kb/tools/list-documents';
import { summarizeTextTool } from '@features/kb/tools/summarize-text';
import { callAgentTool } from '@features/chat/tools/call-agent';

/** Skill 配置页工具下拉选项（与 ToolRegistry 注册项保持一致） */
export const SKILL_TOOL_OPTIONS = [
  searchKnowledgeTool,
  getDocumentTool,
  getChunkTool,
  listDocumentsTool,
  summarizeTextTool,
  callAgentTool,
].map(t => ({ name: t.name, description: t.description }));

const app = new Hono<AuthEnv>();
app.use('*', requirePermission('skills:manage'));

app.get('/tool-options', (c) => {
  return c.json({ tools: SKILL_TOOL_OPTIONS });
});

export default app;
