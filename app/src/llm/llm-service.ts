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
    const url = `${config.llmApiUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: config.llmModelId,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
    };

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = opts.tool_choice ?? 'auto';
    }
    if (opts.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llmApiKey}`,
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
    return { content: msg.content, tool_calls: msg.tool_calls };
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
