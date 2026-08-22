export interface DatasetChunkConfig {
  parentTokens?: number;
  childTokens?: number;
  overlapTokens?: number;
}

export interface DatasetRetrieveConfig {
  searchTopK?: number;
  denseTopKMultiplier?: number;
  rrfK?: number;
  rerankTopK?: number;
  denseMinSimilarity?: number;
  rerankMinScore?: number;
}

export interface DatasetMember {
  datasetId: string;
  userId: string;
  role: 'viewer' | 'editor' | 'manager';
  grantedBy?: string | null;
  createdAt: string;
}

export interface Dataset {
  id: string;
  name: string;
  description?: string | null;
  kind: 'document' | 'kg';
  ownerId: string;
  visibility: 'private' | 'shared' | 'public';
  chunkConfig?: Partial<DatasetChunkConfig> | null;
  retrieveConfig?: Partial<DatasetRetrieveConfig> | null;
  createdAt: string;
  updatedAt: string;
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
  ownerId: string;
  visibility: 'private' | 'shared' | 'public';
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
