import { ToolRegistry } from './registry';
import { searchKnowledgeTool, setRetriever } from './search-knowledge';
import { getDocumentTool } from './get-document';
import { getChunkTool } from './get-chunk';
import { listDocumentsTool } from './list-documents';
import { summarizeTextTool, setLLM } from './summarize-text';
import { callAgentTool } from './call-agent';
import { KG_TOOLS } from '../kg/tools';
import { config } from '../config';
import type { HybridRetriever } from '../retrieve/retriever';
import type { LLMService } from '../llm/llm-service';

export interface ToolRegistryOptions {
  includeCallAgent?: boolean;
}

export function createToolRegistry(
  retriever: HybridRetriever,
  llm: LLMService,
  options: ToolRegistryOptions = {},
): ToolRegistry {
  setRetriever(retriever);
  setLLM(llm);
  const registry = new ToolRegistry();
  registry.register(searchKnowledgeTool);
  registry.register(getDocumentTool);
  registry.register(getChunkTool);
  registry.register(listDocumentsTool);
  registry.register(summarizeTextTool);
  if (options.includeCallAgent) {
    registry.register(callAgentTool);
  }
  if (config.kgEnabled) {
    for (const t of KG_TOOLS) registry.register(t);
  }
  return registry;
}

export { ToolRegistry } from './registry';
export type { Tool, ToolContext, JSONSchemaProperty } from './types';
