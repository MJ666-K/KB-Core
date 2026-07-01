-- chunks 表补 start_offset / end_offset（原文锚定，回溯高亮用）
-- 对应 Step 41（chunks offset 持久化，入库时记录原文锚点）
-- ChunkUnit 已在 splitter 计算了 offset，但此前未持久化

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS start_offset integer;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS end_offset integer;

-- 历史数据无 offset（NULL），前端按"offset 不可用"降级处理
-- 新入库数据由 ingest-pipeline 写入
