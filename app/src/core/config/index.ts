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
  embeddingBatchSize: z.coerce.number().int().positive().default(10),

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
  denseMinSimilarity: z.coerce.number().min(0).max(1).default(0.65),
  rerankMinScore: z.coerce.number().min(0).max(1).default(0.5),

  agentMaxIterations: z.coerce.number().int().positive().default(5),
  agentMaxToolCalls: z.coerce.number().int().positive().default(15),

  embeddingCacheMax: z.coerce.number().int().positive().default(2000),
  resultCacheMax: z.coerce.number().int().positive().default(500),
  resultCacheTtlMs: z.coerce.number().int().positive().default(300_000),

  jwtSecret: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  jwtAccessTtlSec: z.coerce.number().int().positive().default(900),
  jwtRefreshTtlSec: z.coerce.number().int().positive().default(604_800),
  queryJobTtlSec: z.coerce.number().int().positive().default(3600),
  authDefaultUsername: z.string().min(1).default('admin'),
  authDefaultPassword: z.string().min(6).default('admin123'),
  /** 服务端永久 Token，仅用于脚本/集成，不在前端暴露 */
  apiServiceToken: z.string().min(16).optional(),

  ossAccessKeyId: z.string().min(1).optional(),
  ossAccessKeySecret: z.string().min(1).optional(),
  ossEndpoint: z.string().url().optional(),
  ossBucketName: z.string().min(1).optional(),
  ossPrefix: z.string().default('knowledge_core/'),

  // ===== Knowledge Graph (Neo4j) =====
  neo4jUrl: z.string().default('bolt://localhost:7687'),
  neo4jUser: z.string().default('neo4j'),
  neo4jPassword: z.string().default('neo4j_dev_password'),
  kgEnabled: z.coerce.boolean().default(true),
  kgDefaultRootLabor: z.string().default('flow_labor_apply'),
  kgDefaultRootNeighbor: z.string().default('flow_neighbor_register'),
}).transform((data) => ({
  ...data,
  ossEnabled: Boolean(
    data.ossAccessKeyId &&
    data.ossAccessKeySecret &&
    data.ossEndpoint &&
    data.ossBucketName,
  ),
}));

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
  denseMinSimilarity: process.env.DENSE_MIN_SIMILARITY,
  rerankMinScore: process.env.RERANK_MIN_SCORE,
  agentMaxIterations: process.env.AGENT_MAX_ITERATIONS,
  agentMaxToolCalls: process.env.AGENT_MAX_TOOL_CALLS,
  embeddingCacheMax: process.env.EMBEDDING_CACHE_MAX,
  resultCacheMax: process.env.RESULT_CACHE_MAX,
  resultCacheTtlMs: process.env.RESULT_CACHE_TTL_MS,
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessTtlSec: process.env.JWT_ACCESS_TTL_SEC,
  jwtRefreshTtlSec: process.env.JWT_REFRESH_TTL_SEC,
  queryJobTtlSec: process.env.QUERY_JOB_TTL_SEC,
  authDefaultUsername: process.env.AUTH_DEFAULT_USERNAME,
  authDefaultPassword: process.env.AUTH_DEFAULT_PASSWORD,
  apiServiceToken: process.env.API_SERVICE_TOKEN,
  ossAccessKeyId: process.env.OSS_ACCESS_KEY_ID,
  ossAccessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  ossEndpoint: process.env.OSS_ENDPOINT,
  ossBucketName: process.env.OSS_BUCKET_NAME,
  ossPrefix: process.env.OSS_PREFIX,

  neo4jUrl: process.env.NEO4J_URL,
  neo4jUser: process.env.NEO4J_USER,
  neo4jPassword: process.env.NEO4J_PASSWORD,
  kgEnabled: process.env.KG_ENABLED,
  kgDefaultRootLabor: process.env.KG_DEFAULT_ROOT_LABOR,
  kgDefaultRootNeighbor: process.env.KG_DEFAULT_ROOT_NEIGHBOR,
};

const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
