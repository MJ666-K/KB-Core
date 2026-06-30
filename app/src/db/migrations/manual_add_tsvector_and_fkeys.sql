-- tsvector 生成列 + GIN 索引（稀疏检索核心）
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS chunk_tsv_idx ON chunks USING GIN(tsv);

-- parent_id 自引用外键（Drizzle 写不了自引用，这里补）
ALTER TABLE chunks
  DROP CONSTRAINT IF EXISTS chunks_parent_id_fkey;

ALTER TABLE chunks
  ADD CONSTRAINT chunks_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES chunks(id)
  ON DELETE CASCADE;
