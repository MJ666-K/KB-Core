/**
 * kg-data.json → Neo4j + Postgres（chunks for 法条原文）入库脚本
 *
 * 用法：
 *   bun run src/kg/ingest.ts <kg-data.json>
 *
 * 流程：
 *   1. zod 校验 kg-data.json 结构（容忍装饰行 string）
 *   2. 确保目标 dataset 存在（kind='kg'），不存在则创建；Neo4j datasetId = name 的 sha256 前 32 bit
 *   3. 清空该 dataset 下的旧节点和边（DETACH DELETE）
 *   4. 批量入库节点（按 Label 分组，UNWIND 加速）
 *   5. 批量入库边（apoc.create.relationship 动态决定关系类型）
 *   6. 法规节点的 law 字段 → splitter + embedding → chunks，回填 kgNodeId
 *   7. 反向回写 Neo4j 节点的 chunkId
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, pool } from '@core/db/client';
import { chunks, datasets, documents } from '@core/db/schema';
import { ensureKgReady, withSession, closeNeo4j } from './client';
import { logger as log } from '@core/utils/logger';

// ===== zod schemas =====

const KgNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['流程', '法规', '证据', '案例']),
  category: z.string().min(1),
  step_order: z.number().int().optional(),
  law: z.string().optional(),
  case: z.string().optional(),
  output_doc: z.string().optional(),
  duration: z.string().optional(),
}).passthrough();

const KgEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(['solid', 'dashed']),
  label: z.string().optional(),
}).passthrough();

const KgDataSchema = z.object({
  meta: z.record(z.string(), z.any()).optional(),
  nodes: z.array(z.union([KgNodeSchema, z.string()])),
  edges: z.array(z.union([KgEdgeSchema, z.string()])),
});

type KgNode = z.infer<typeof KgNodeSchema>;
type KgEdge = z.infer<typeof KgEdgeSchema>;

interface IngestContext {
  datasetName: string;
  datasetUuid: string;     // Postgres datasets.id
  neo4jDatasetId: number;  // Neo4j 节点的 datasetId 属性（int）
}

// ===== 主流程 =====

export async function ingestKgData(filePath: string): Promise<void> {
  const parsed = KgDataSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  const nodes = parsed.nodes.filter((n): n is KgNode => typeof n !== 'string');
  const edges = parsed.edges.filter((e): e is KgEdge => typeof e !== 'string');
  log.info('parsed kg-data.json', { filePath, nodes: nodes.length, edges: edges.length });

  const ctx = await ensureKgDataset(path.basename(filePath, '.json'));
  log.info('target dataset ready', ctx as unknown as Record<string, unknown>);

  await ensureKgReady();

  await withSession(async (session) => {
    await session.run(
      'MATCH (n {datasetId: $did}) DETACH DELETE n',
      { did: ctx.neo4jDatasetId },
    );
  }, 'WRITE');
  log.info('cleared old nodes/edges', { did: ctx.neo4jDatasetId });

  await ingestNodes(ctx.neo4jDatasetId, nodes);
  await ingestEdges(edges);

  const lawNodes = nodes.filter((n) => n.type === '法规' && n.law);
  log.info('ingesting law texts into chunks', { count: lawNodes.length });
  for (const node of lawNodes) {
    await ingestLawChunk(ctx, node);
  }

  await backfillChunkIds();
  log.info('✅ ingest complete', { datasetName: ctx.datasetName, nodes: nodes.length, edges: edges.length });
}

async function ensureKgDataset(name: string): Promise<IngestContext> {
  const neo4jDatasetId = nameToDatasetId(name);
  const found = await db.select().from(datasets).where(eq(datasets.name, name)).limit(1);
  if (found.length > 0) {
    const row = found[0]!;
    if (row.kind !== 'kg') {
      await db.update(datasets).set({ kind: 'kg' }).where(eq(datasets.id, row.id));
    }
    return { datasetName: name, datasetUuid: row.id, neo4jDatasetId };
  }
  const inserted = await db.insert(datasets).values({
    name,
    kind: 'kg',
    description: '知识图谱数据集（kg-data.json 入库）',
  }).returning({ id: datasets.id });
  const row = inserted[0]!;
  return { datasetName: name, datasetUuid: row.id, neo4jDatasetId };
}

/** dataset name → Neo4j datasetId（int）。同一 name 永远映射到同一 int，避免外部映射表 */
function nameToDatasetId(name: string): number {
  return createHash('sha256').update(name).digest().readUInt32BE(0);
}

async function ingestNodes(datasetId: number, nodes: KgNode[]) {
  const groups: Array<[string, KgNode[]]> = [
    ['Flow',     nodes.filter((n) => n.type === '流程')],
    ['Law',      nodes.filter((n) => n.type === '法规')],
    ['Evidence', nodes.filter((n) => n.type === '证据')],
    ['Case',     nodes.filter((n) => n.type === '案例')],
  ];
  await withSession(async (session) => {
    for (const [label, list] of groups) {
      if (list.length === 0) continue;
      await session.run(
        `
        UNWIND $nodes AS n
        CREATE (node:${label} {
          id: n.id,
          label: n.label,
          category: n.category,
          datasetId: $did,
          stepOrder: n.step_order,
          chunkId: null,
          meta_law: n.law,
          meta_case: n.case,
          meta_output_doc: n.output_doc,
          meta_duration: n.duration
        })
        `,
        { nodes: list, did: datasetId },
      );
      log.info('ingested nodes', { label, count: list.length });
    }
  }, 'WRITE');
}

/** edge.label → 关系类型枚举（见 docs/知识图谱设计.md §4.2） */
function mapRelType(label: string | undefined, edgeType: 'solid' | 'dashed'): string {
  if (!label) return edgeType === 'solid' ? 'NEXT' : 'REQUIRES';
  if (['下一步', '同意调解', '达成一致', '申请司法确认', '归档'].includes(label)) return 'NEXT';
  if (label.includes('拒绝') || label.includes('未达成一致')) return 'BRANCH_TO';
  if (label === '法律依据') return 'APPLIES_TO';
  if (label.includes('关键证据')) return 'KEY_EVIDENCE';
  if (['需要核对', '需要材料'].includes(label)) return 'REQUIRES';
  if (label.includes('需采集') || label.includes('需调取') || label.includes('需提供') || label.includes('企业需提供') || label.includes('员工需提供')) return 'REQUIRES';
  if (label.includes('可选')) return 'MAY_REQUIRE';
  if (label.includes('参考案例')) return 'REFERS_TO';
  if (label.includes('援引')) return 'CITES';
  return 'RELATED';
}

async function ingestEdges(edges: KgEdge[]) {
  if (edges.length === 0) return;
  const enriched = edges.map((e) => ({
    from: e.from,
    to: e.to,
    type: e.type,
    label: e.label ?? '',
    relType: mapRelType(e.label, e.type),
  }));
  await withSession(async (session) => {
    await session.run(
      `
      UNWIND $edges AS e
      MATCH (from {id: e.from})
      MATCH (to   {id: e.to})
      CALL apoc.create.relationship(
        from, e.relType,
        { solid: (e.type = 'solid'), label: e.label },
        to
      ) YIELD rel
      RETURN count(rel) AS created
      `,
      { edges: enriched },
    );
  }, 'WRITE');
  log.info('ingested edges', { count: edges.length });
}

/** 法规节点的 law 字段 → document + 1 个 chunk（单条不分片，带 kgNodeId 回填） */
async function ingestLawChunk(ctx: IngestContext, node: KgNode) {
  if (!node.law) return;
  try {

  const { EmbeddingService } = await import('@infra/embedding/embedding-service');
  const { countTokens } = await import('@features/kb/splitter/token-counter');

  const law = node.law!;

  // 1. 虚拟文档（一个 law 节点一个 doc）
  const docTitle = `[KG] ${node.label}（${node.id}）`;
  let documentId: string;
  const existingDoc = await db.select().from(documents).where(eq(documents.title, docTitle)).limit(1);
  if (existingDoc.length > 0) {
    documentId = existingDoc[0]!.id;
  } else {
    const inserted = await db.insert(documents).values({
      datasetId: ctx.datasetUuid,
      title: docTitle,
      docType: 'kg_law',
      sourcePath: `kg://${node.id}`,
      fileHash: createHash('sha256').update(law).digest('hex'),
      contentHash: createHash('sha256').update(law).digest('hex'),
      fileSize: Buffer.byteLength(law),
      status: 'ready',
      embeddingModel: process.env.EMBEDDING_MODEL_ID ?? 'text-embedding-v3',
    }).returning({ id: documents.id });
    documentId = inserted[0]!.id;
  }

  // 2. embedding（一条 law 一个向量）
  const embeddingService = new EmbeddingService();
  const [embedding] = await embeddingService.embedBatch([law]);

  // 3. 单条 child chunk（parentChunkIndex=0，childIndexWithinParent=0，无 parent_id）
  //    用最小化 schema：parentChunkIndex + childIndexWithinParent 都给具体值，避免 null/empty 冲突
  const contentHash = createHash('sha256').update(law).digest('hex');
  const tokenCount = countTokens(law);

  // 清理该 document 下旧 chunks（避免重复入库触发 unique 冲突）
  await db.delete(chunks).where(eq(chunks.documentId, documentId));

  await db.insert(chunks).values([{
    documentId,
    datasetId: ctx.datasetUuid,
    parentChunkIndex: 0,
    childIndexWithinParent: 0,
    content: law,
    contentHash,
    tokenCount,
    embeddingStatus: 'done' as const,
    embedding,
    kgNodeId: node.id,
  }]);
  log.info('law chunks ingested', { nodeId: node.id });
  } catch (e: any) {
    log.error('insert chunk failed', {
      nodeId: node.id,
      errCode: e?.cause?.code ?? e?.code,
      errMsg: (e?.cause?.message ?? e?.message ?? '').slice(0, 500),
      detail: e?.cause?.detail ?? e?.detail,
    });
    throw e;
  }
}

/** 反向回写：从 Postgres chunks 表里捞 kgNodeId 对应的第一个 chunk id，写回 Neo4j 节点 */
async function backfillChunkIds() {
  const result = await db.execute<{ kg_node_id: string; id: string }>(sql`
    SELECT DISTINCT ON (kg_node_id) kg_node_id, id
    FROM chunks
    WHERE kg_node_id IS NOT NULL
    ORDER BY kg_node_id, parent_chunk_index, child_index_within_parent NULLS FIRST
  `);
  const rows = (result as any).rows ?? result;
  if (rows.length === 0) return;
  await withSession(async (session) => {
    await session.run(
      `
      UNWIND $rows AS r
      MATCH (n {id: r.kg_node_id})
      SET n.chunkId = r.id
      RETURN count(n) AS updated
      `,
      { rows },
    );
  }, 'WRITE');
  log.info('backfilled chunkId on Neo4j nodes', { updated: rows.length });
}

// ===== CLI 入口 =====

if (import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: bun run src/kg/ingest.ts <kg-data.json>');
    process.exit(1);
  }
  try {
    await ingestKgData(filePath);
  } catch (e) {
    log.error('ingest failed', { err: (e as Error).message, stack: (e as Error).stack });
    process.exit(1);
  } finally {
    await closeNeo4j();
    await pool.end();
  }
}