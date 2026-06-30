export interface SplitConfig {
  maxChunkSize: number;
  overlapSize: number;
  minChunkSize: number;
  lengthFunction: (text: string) => number;
  separators: string[][];
}

export interface ChunkUnit {
  text: string;
  tokenCount: number;
  isParent: boolean;
  parentChunkIndex: number;
  childIndexWithinParent: number | null;
  startOffset: number;
  endOffset: number;
  contentHash: string;
  metadata: Record<string, unknown>;
}
