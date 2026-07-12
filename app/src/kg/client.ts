/**
 * Neo4j 客户端封装（单例 Driver + withSession helper）
 *
 * - Driver 全局单例，连接池复用
 * - withSession 自动 close session，避免泄漏
 * - 应用启动时调用 ensureKgReady() 建约束/索引（幂等）
 * - kgEnabled=false 时所有 helper 退化为 noop
 */
import neo4j, { Driver, Session } from 'neo4j-driver';
import { config } from '../config';
import { logger as log } from '../utils/logger';

let driver: Driver | null = null;

export function getNeo4j(): Driver {
  if (!config.kgEnabled) {
    throw new Error('Neo4j is disabled (KG_ENABLED=false)');
  }
  if (!driver) {
    driver = neo4j.driver(
      config.neo4jUrl,
      neo4j.auth.basic(config.neo4jUser, config.neo4jPassword),
      {
        maxConnectionPoolSize: 50,
        connectionTimeout: 5_000,
      },
    );
    log.info('Neo4j driver created', { url: config.neo4jUrl });
  }
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    log.info('Neo4j driver closed');
  }
}

/**
 * 在 Session 内执行 Cypher，自动关闭
 */
export async function withSession<T>(
  fn: (session: Session) => Promise<T>,
  accessMode: 'READ' | 'WRITE' = 'READ',
): Promise<T> {
  const session = getNeo4j().session({ defaultAccessMode: neo4j.session[accessMode] });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/** Cypher 节点投影片段（变量名可替换） */
export function cypherNodeProjection(v = 'n'): string {
  return `{
  id: ${v}.id,
  label: ${v}.label,
  category: ${v}.category,
  type: labels(${v})[0],
  chunkId: ${v}.chunkId,
  stepOrder: ${v}.stepOrder,
  meta: {
    law: ${v}.meta_law,
    case: ${v}.meta_case,
    output_doc: ${v}.meta_output_doc,
    duration: ${v}.meta_duration
  }
}`;
}

/** @deprecated 使用 cypherNodeProjection('n') */
export const CYPHER_NODE_PROJECTION = cypherNodeProjection('n');

export function normalizeNodeMeta(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return meta;
  for (const [k, v] of Object.entries(raw)) {
    if (v != null && String(v).trim() !== '') meta[k] = v;
  }
  return meta;
}

/**
 * 把 Neo4j Record 中的节点转成前端友好的纯对象
 */
export function nodeToPlain(rec: {
  id: string;
  label: string;
  category: string;
  type: KgNode['type'];
  chunkId?: string | null;
  stepOrder?: number | null;
  meta?: Record<string, unknown> | null;
}): KgNode {
  return {
    id: rec.id,
    label: rec.label,
    category: rec.category,
    type: rec.type,
    chunkId: rec.chunkId ?? null,
    stepOrder: rec.stepOrder ?? null,
    meta: normalizeNodeMeta(rec.meta),
  };
}

export function edgeToPlain(rec: any): KgEdge {
  return {
    from: rec.from,
    to: rec.to,
    type: rec.type,
    solid: Boolean(rec.solid),
    label: rec.label ?? null,
  };
}

/**
 * 应用启动时执行一次：建约束 + 索引（幂等，可重复跑）
 */
export async function ensureKgReady(): Promise<void> {
  if (!config.kgEnabled) {
    log.info('KG disabled, skip ensureKgReady');
    return;
  }
  await withSession(async (session) => {
    const stmts = [
      // 唯一性约束（按 Label 拆开，避免 id 跨类型冲突）
      `CREATE CONSTRAINT flow_id IF NOT EXISTS FOR (n:Flow) REQUIRE n.id IS UNIQUE`,
      `CREATE CONSTRAINT law_id IF NOT EXISTS FOR (n:Law) REQUIRE n.id IS UNIQUE`,
      `CREATE CONSTRAINT ev_id IF NOT EXISTS FOR (n:Evidence) REQUIRE n.id IS UNIQUE`,
      `CREATE CONSTRAINT case_id IF NOT EXISTS FOR (n:Case) REQUIRE n.id IS UNIQUE`,
      // 业务索引
      `CREATE INDEX flow_category IF NOT EXISTS FOR (n:Flow) ON (n.category)`,
      `CREATE INDEX flow_step IF NOT EXISTS FOR (n:Flow) ON (n.stepOrder)`,
      `CREATE INDEX law_category IF NOT EXISTS FOR (n:Law) ON (n.category)`,
      `CREATE INDEX ev_category IF NOT EXISTS FOR (n:Evidence) ON (n.category)`,
      `CREATE INDEX case_category IF NOT EXISTS FOR (n:Case) ON (n.category)`,
      `CREATE INDEX node_dataset IF NOT EXISTS FOR (n:Flow) ON (n.datasetId)`,
      `CREATE INDEX law_dataset IF NOT EXISTS FOR (n:Law) ON (n.datasetId)`,
      `CREATE INDEX ev_dataset IF NOT EXISTS FOR (n:Evidence) ON (n.datasetId)`,
      `CREATE INDEX case_dataset IF NOT EXISTS FOR (n:Case) ON (n.datasetId)`,
      // 全文索引（Neo4j 5.x）
      `CREATE FULLTEXT INDEX node_fulltext IF NOT EXISTS
         FOR (n:Flow|Law|Evidence|Case) ON EACH [n.label, n.category]`,
    ];
    for (const stmt of stmts) {
      try {
        await session.run(stmt);
      } catch (e: any) {
        // 全文索引要求非空数据库；空库时会报错但不影响后续
        if (e.message?.includes('fulltext') && e.message?.includes('requires the database to be online')) {
          log.warn('Fulltext index requires data, skip', { stmt });
          continue;
        }
        throw e;
      }
    }
  }, 'WRITE');
  log.info('Neo4j constraints and indexes ensured');
}

// ===== 类型定义（导出给 Tool / 路由用） =====

export interface KgNode {
  id: string;
  label: string;
  category: string;
  type: 'Flow' | 'Law' | 'Evidence' | 'Case';
  chunkId: string | null;
  stepOrder: number | null;
  meta: Record<string, unknown>;
}

export interface KgEdge {
  from: string;
  to: string;
  type: string;
  solid: boolean;
  label: string | null;
}

export interface KgSubgraph {
  nodes: KgNode[];
  edges: KgEdge[];
}

export type KgNodeType = KgNode['type'];