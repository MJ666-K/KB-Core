export interface Dataset {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  parentId: string | null;
  parentChunkIndex: number | null;
  childIndexWithinParent: number | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  startOffset: number | null;
  endOffset: number | null;
  embeddingStatus: 'pending' | 'done' | 'failed';
}

export interface Agent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  datasetIds: string[];
  modelId: string;
  model: { id: string; name: string; displayName: string; provider: string; modelId: string; } | null;
  skillNames: string[];
  enabled: boolean;
}

export interface Model {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  modelId: string;
  apiUrl: string | null;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

export interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tools: string[];
  instructions: string;
  enabled: boolean;
  version: number;
  updatedAt?: string;
}
