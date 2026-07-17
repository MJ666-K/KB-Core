export interface SplitConfig {
  maxChunkSize: number;
  overlapSize: number;
  minChunkSize: number;
  lengthFunction: (text: string) => number;
  separators: ReadonlyArray<ReadonlyArray<string | RegExp>>;
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
  /** 法律文档结构化层级（编/章/节/条），非法律文档全为 undefined */
  structure?: {
    bian?: string;
    zhang?: string;
    jie?: string;
    tiao?: string;
  };
}
