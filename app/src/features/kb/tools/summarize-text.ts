import type { Tool, ToolContext } from './types';
import type { LLMService } from '@infra/llm/llm-service';

let llmInstance: LLMService | null = null;
export function setLLM(llm: LLMService): void { llmInstance = llm; }

interface SummarizeParams { text: string; instruction?: string; [key: string]: unknown; }
interface SummarizeResult { summary: string; originalLength: number; summaryLength: number; }

const DEFAULT_INSTRUCTION = '提取 3-5 个核心要点，每个要点用一句话概括';

export const summarizeTextTool: Tool<SummarizeParams, SummarizeResult | { error: string }> = {
  name: 'summarize_text',
  description: '对任意文本生成摘要。当资料太长需要压缩、用户要"总结""概括"时使用。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要总结的文本（建议 < 5000 字，超长会被截断）' },
      instruction: { type: 'string', description: '可选：自定义总结要求', default: '提取 3-5 个核心要点' },
    },
    required: ['text'],
  },
  async execute(params: SummarizeParams, _ctx: ToolContext) {
    if (!llmInstance) return { error: 'LLM not initialized' };
    const truncated = params.text.length > 10000 ? params.text.slice(0, 10000) + '\n[...文本过长，已截断...]' : params.text;
    const instruction = params.instruction?.trim() || DEFAULT_INSTRUCTION;
    const summary = await llmInstance.generate(`请总结以下文本。\n\n要求：${instruction}\n\n文本：\n${truncated}`, { temperature: 0.3 });
    return { summary, originalLength: params.text.length, summaryLength: summary.length };
  },
};
