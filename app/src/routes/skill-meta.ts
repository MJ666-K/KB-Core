import { Hono } from 'hono';
import { searchKnowledgeTool } from '../tools/search-knowledge';
import { getDocumentTool } from '../tools/get-document';
import { getChunkTool } from '../tools/get-chunk';
import { listDocumentsTool } from '../tools/list-documents';
import { summarizeTextTool } from '../tools/summarize-text';
import { callAgentTool } from '../tools/call-agent';

/** Skill 配置页工具下拉选项（与 ToolRegistry 注册项保持一致） */
export const SKILL_TOOL_OPTIONS = [
  searchKnowledgeTool,
  getDocumentTool,
  getChunkTool,
  listDocumentsTool,
  summarizeTextTool,
  callAgentTool,
].map(t => ({ name: t.name, description: t.description }));

const app = new Hono();

app.get('/tool-options', (c) => {
  return c.json({ tools: SKILL_TOOL_OPTIONS });
});

export default app;
