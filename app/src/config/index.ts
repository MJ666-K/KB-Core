import { z } from 'zod';

const envSchema = z.object({
  appPort: z.coerce.number().int().positive().default(3000),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  databaseUrl: z.string().url(),
  redisUrl: z.string().url().default('redis://localhost:6379/0'),

  llmApiUrl: z.string().url(),
  llmApiKey: z.string().min(1, 'LLM_API_KEY is required'),
  llmModelId: z.string().default('qwen-plus'),

  embeddingApiUrl: z.string().url(),
  embeddingApiKey: z.string().min(1, 'EMBEDDING_API_KEY is required'),
  embeddingModelId: z.string().default('text-embedding-v3'),
  embeddingDim: z.coerce.number().int().positive().default(1024),
  embeddingBatchSize: z.coerce.number().int().positive().default(16),

  rerankApiUrl: z.string().url(),
  rerankApiKey: z.string().min(1, 'RERANK_API_KEY is required'),
  rerankModelId: z.string().default('qwen3-rerank'),

  chunkParentTokens: z.coerce.number().int().positive().default(1200),
  chunkChildTokens: z.coerce.number().int().positive().default(300),
  chunkOverlapTokens: z.coerce.number().int().positive().default(50),

  searchTopK: z.coerce.number().int().positive().default(10),
  denseTopKMultiplier: z.coerce.number().int().positive().default(3),
  rrfK: z.coerce.number().int().positive().default(60),
  rerankTopK: z.coerce.number().int().positive().default(20),

  agentMaxIterations: z.coerce.number().int().positive().default(5),
  agentMaxToolCalls: z.coerce.number().int().positive().default(10),

  embeddingCacheMax: z.coerce.number().int().positive().default(2000),
  resultCacheMax: z.coerce.number().int().positive().default(500),
  resultCacheTtlMs: z.coerce.number().int().positive().default(60_000),
});

const rawEnv = {
  appPort: process.env.APP_PORT,
  logLevel: process.env.LOG_LEVEL,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  llmApiUrl: process.env.LLM_API_URL,
  llmApiKey: process.env.LLM_API_KEY,
  llmModelId: process.env.LLM_MODEL_ID,
  embeddingApiUrl: process.env.EMBEDDING_API_URL,
  embeddingApiKey: process.env.EMBEDDING_API_KEY,
  embeddingModelId: process.env.EMBEDDING_MODEL_ID,
  embeddingDim: process.env.EMBEDDING_DIM,
  embeddingBatchSize: process.env.EMBEDDING_BATCH_SIZE,
  rerankApiUrl: process.env.RERANK_API_URL,
  rerankApiKey: process.env.RERANK_API_KEY,
  rerankModelId: process.env.RERANK_MODEL_ID,
  chunkParentTokens: process.env.CHUNK_PARENT_TOKENS,
  chunkChildTokens: process.env.CHUNK_CHILD_TOKENS,
  chunkOverlapTokens: process.env.CHUNK_OVERLAP_TOKENS,
  searchTopK: process.env.SEARCH_TOP_K,
  denseTopKMultiplier: process.env.DENSE_TOP_K_MULTIPLIER,
  rrfK: process.env.RRF_K,
  rerankTopK: process.env.RERANK_TOP_K,
  agentMaxIterations: process.env.AGENT_MAX_ITERATIONS,
  agentMaxToolCalls: process.env.AGENT_MAX_TOOL_CALLS,
  embeddingCacheMax: process.env.EMBEDDING_CACHE_MAX,
  resultCacheMax: process.env.RESULT_CACHE_MAX,
  resultCacheTtlMs: process.env.RESULT_CACHE_TTL_MS,
};

const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
