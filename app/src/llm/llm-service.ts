import { config } from '../config';
import { logger } from '../utils/logger';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface FunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ChatOptions {
  messages: Message[];
  tools?: FunctionDefinition[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  topK?: number | null;
  topP?: number | null;
  frequencyPenalty?: number | null;
  presencePenalty?: number | null;
  model?: string;
  apiKey?: string | null;
  apiUrl?: string | null;
}

const MAX_RETRIES = 3;

async function fetchWithRetry(url: string, options: RequestInit, label: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const delay = Math.pow(2, attempt) * 1000;
      if (isLastAttempt) throw err;
      logger.warn(`[${label}] attempt ${attempt} failed, retrying in ${delay}ms: ${err}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export class LLMService {
  async chat(opts: ChatOptions): Promise<ChatResponse> {
    const url = `${opts.apiUrl ?? config.llmApiUrl}/chat/completions`;
    const apiKey = opts.apiKey ?? config.llmApiKey;
    const model = opts.model ?? config.llmModelId;
    const callStart = Date.now();
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
    };

    const hasTools = !!(opts.tools && opts.tools.length > 0);
    logger.info(`[LLM] chat 开始`, {
      model,
      url: opts.apiUrl ?? config.llmApiUrl,
      customApiKey: !!opts.apiKey,
      messagesCount: opts.messages.length,
      temperature: body.temperature,
      maxTokens: opts.maxTokens,
      topK: opts.topK,
      topP: opts.topP,
      frequencyPenalty: opts.frequencyPenalty,
      presencePenalty: opts.presencePenalty,
      toolsCount: hasTools ? opts.tools!.length : 0,
      toolChoice: hasTools ? (opts.tool_choice ?? 'auto') : 'none',
    });

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = opts.tool_choice ?? 'auto';
    }
    if (opts.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }
    if (opts.topK && opts.topK > 0) {
      body.top_k = opts.topK;
    }
    if (opts.topP != null && opts.topP > 0) {
      body.top_p = opts.topP;
    }
    if (opts.frequencyPenalty != null && opts.frequencyPenalty !== 0) {
      body.frequency_penalty = opts.frequencyPenalty;
    }
    if (opts.presencePenalty != null && opts.presencePenalty !== 0) {
      body.presence_penalty = opts.presencePenalty;
    }

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'LLM');

    if (!res.ok) {
      const errorBody = await res.text();
      logger.error('LLM API error', { status: res.status, body: errorBody });
      throw new Error(`LLM API error: ${res.status} ${errorBody}`);
    }

    const json = await res.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
    };

    if (!json.choices?.[0]) {
      throw new Error('LLM API returned no choices');
    }

    const msg = json.choices[0].message;
    const elapsed = Date.now() - callStart;
    logger.info(`[LLM] chat 完成 (${elapsed}ms)`, {
      model,
      contentLen: msg.content?.length ?? 0,
      toolCallsCount: msg.tool_calls?.length ?? 0,
      toolCalls: (msg.tool_calls ?? []).map(tc => tc.function.name).join(','),
    });
    return { content: msg.content, tool_calls: msg.tool_calls };
  }

  async *chatStream(opts: ChatOptions): AsyncIterable<StreamChunk> {
    const url = `${opts.apiUrl ?? config.llmApiUrl}/chat/completions`;
    const apiKey = opts.apiKey ?? config.llmApiKey;
    const model = opts.model ?? config.llmModelId;
    const streamStart = Date.now();
    const hasTools = !!(opts.tools && opts.tools.length > 0);
    logger.info(`[LLM] stream 开始`, {
      model,
      url: opts.apiUrl ?? config.llmApiUrl,
      customApiKey: !!opts.apiKey,
      messagesCount: opts.messages.length,
      temperature: opts.temperature ?? 0.2,
      maxTokens: opts.maxTokens,
      topK: opts.topK,
      topP: opts.topP,
      frequencyPenalty: opts.frequencyPenalty,
      presencePenalty: opts.presencePenalty,
      toolsCount: hasTools ? opts.tools!.length : 0,
      toolChoice: hasTools ? (opts.tool_choice ?? 'auto') : 'none',
    });
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
      stream: true,
    };

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = opts.tool_choice ?? 'auto';
    }
    if (opts.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }
    if (opts.topK && opts.topK > 0) {
      body.top_k = opts.topK;
    }
    if (opts.topP != null && opts.topP > 0) {
      body.top_p = opts.topP;
    }
    if (opts.frequencyPenalty != null && opts.frequencyPenalty !== 0) {
      body.frequency_penalty = opts.frequencyPenalty;
    }
    if (opts.presencePenalty != null && opts.presencePenalty !== 0) {
      body.presence_penalty = opts.presencePenalty;
    }

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'LLM-stream');

    if (!res.ok) {
      const errorBody = await res.text();
      logger.error('LLM Stream error', { status: res.status, body: errorBody });
      throw new Error(`LLM API error: ${res.status} ${errorBody}`);
    }

    if (!res.body) {
      throw new Error('LLM stream: no response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallsAcc = new Map<number, { id: string; name: string; arguments: string }>();
    let tokenCount = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6);
        try {
          const chunk = JSON.parse(jsonStr) as SSEChunk;
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          if (choice.delta?.content) {
            tokenCount++;
            yield { type: 'token', content: choice.delta.content };
          }

          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const acc = toolCallsAcc.get(tc.index) ?? { id: '', name: '', arguments: '' };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
              toolCallsAcc.set(tc.index, acc);
            }
          }

          if (choice.finish_reason === 'tool_calls') {
            const toolCalls: ToolCall[] = [...toolCallsAcc.values()].map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            }));
            const elapsed = Date.now() - streamStart;
            logger.info(`[LLM] stream 完成 (${elapsed}ms)`, {
              model,
              tokens: tokenCount,
              decision: `工具: ${toolCalls.map(tc => tc.function.name).join(',')}`,
            });
            yield { type: 'done', tool_calls: toolCalls };
            return;
          }

          if (choice.finish_reason === 'stop') {
            const elapsed = Date.now() - streamStart;
            logger.info(`[LLM] stream 完成 (${elapsed}ms)`, {
              model,
              tokens: tokenCount,
              decision: '直接回答',
            });
            yield { type: 'done' };
            return;
          }
        } catch {
          // skip malformed SSE
        }
      }
    }
    const elapsed = Date.now() - streamStart;
    logger.debug(`[LLM] stream 结束 (${elapsed}ms)`, { model, tokens: tokenCount });
  }

  async generate(
    prompt: string,
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const res = await this.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
    });
    return res.content ?? '';
  }
}

export type StreamChunk =
  | { type: 'token'; content: string }
  | { type: 'done'; tool_calls?: ToolCall[] };

interface SSEChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
}
