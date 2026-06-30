import { ToolRegistry } from './registry';
import { searchKnowledgeTool, setRetriever } from './search-knowledge';
import { getDocumentTool } from './get-document';
import { getChunkTool } from './get-chunk';
import { listDocumentsTool } from './list-documents';
import { summarizeTextTool, setLLM } from './summarize-text';
import type { HybridRetriever } from '../retrieve/retriever';
import type { LLMService } from '../llm/llm-service';

export function createToolRegistry(retriever: HybridRetriever, llm: LLMService): ToolRegistry {
  setRetriever(retriever);
  setLLM(llm);
  const registry = new ToolRegistry();
  registry.register(searchKnowledgeTool);
  registry.register(getDocumentTool);
  registry.register(getChunkTool);
  registry.register(listDocumentsTool);
  registry.register(summarizeTextTool);
  return registry;
}

export { ToolRegistry } from './registry';
export type { Tool, ToolContext, JSONSchemaProperty } from './types';
