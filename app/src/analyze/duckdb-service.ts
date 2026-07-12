/**
 * DuckDB 分析引擎
 * 
 * 使用 @duckdb/node-api 的正确 API：
 * - DuckDBInstance.create() 创建实例
 * - instance.connect() 获取连接
 * - connection.runAndReadAll(sql) 执行查询
 * - result.getRowObjectsJson() 获取行数据
 */

import { DuckDBInstance, type DuckDBConnection as DuckDBConn } from '@duckdb/node-api';
import { logger } from '../utils/logger';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DUCKDB_DIR = './data/duckdb';

export class DuckDBService {
  private instances = new Map<string, DuckDBInstance>();
  private connections = new Map<string, DuckDBConn>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!existsSync(DUCKDB_DIR)) {
      mkdirSync(DUCKDB_DIR, { recursive: true });
    }
    this.initialized = true;
    logger.info('[DuckDB] 服务初始化完成');
  }

  async getConnection(dbPath: string): Promise<DuckDBConn> {
    await this.init();
    
    if (this.connections.has(dbPath)) {
      return this.connections.get(dbPath)!;
    }

    const fullPath = join(DUCKDB_DIR, dbPath);
    if (!existsSync(DUCKDB_DIR)) {
      mkdirSync(DUCKDB_DIR, { recursive: true });
    }

    const instance = await DuckDBInstance.create(fullPath);
    const conn = await instance.connect();
    
    this.instances.set(dbPath, instance);
    this.connections.set(dbPath, conn);
    
    logger.info(`[DuckDB] 连接创建: ${dbPath}`);
    return conn;
  }

  /**
   * 执行 SQL 查询（只允许 SELECT）
   */
  async executeQuery(conn: DuckDBConn, sql: string): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTimeMs: number;
  }> {
    const start = Date.now();

    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error('只允许 SELECT 查询');
    }

    const reader = await conn.runAndReadAll(sql);
    const rows = reader.getRowObjectsJson();

    const executionTimeMs = Date.now() - start;
    logger.info(`[DuckDB] 查询完成 (${executionTimeMs}ms)`, { rowCount: rows.length });

    return { rows: rows as Record<string, unknown>[], rowCount: rows.length, executionTimeMs };
  }

  /**
   * 执行任意 SQL（包括 CREATE TABLE、INSERT 等）
   */
  async executeRaw(conn: DuckDBConn, sql: string): Promise<void> {
    await conn.run(sql);
  }

  /**
   * 批量写入数据
   */
  async insertChunk(
    conn: DuckDBConn,
    tableName: string,
    columns: string[],
    chunk: Record<string, unknown>[]
  ): Promise<void> {
    if (chunk.length === 0) return;

    const colList = columns.map(c => `"${c}"`).join(', ');
    const values = chunk.map(row => {
      const vals = columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return String(val);
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        const escaped = String(val).replace(/'/g, "''");
        return `'${escaped}'`;
      });
      return `(${vals.join(', ')})`;
    }).join(', ');

    const sql = `INSERT INTO "${tableName}" (${colList}) VALUES ${values}`;
    await conn.run(sql);
  }

  /**
   * 创建表
   */
  async createTable(
    conn: DuckDBConn,
    tableName: string,
    columns: { name: string; type: string }[]
  ): Promise<void> {
    const colDefs = columns.map(c => `"${c.name}" ${c.type}`).join(', ');
    const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`;
    await conn.run(sql);
    logger.info(`[DuckDB] 表创建: ${tableName} (${columns.length} 列)`);
  }

  /**
   * 关闭连接
   */
  async close(dbPath?: string): Promise<void> {
    if (dbPath) {
      const conn = this.connections.get(dbPath);
      if (conn) { conn.closeSync(); this.connections.delete(dbPath); }
      const instance = this.instances.get(dbPath);
      if (instance) { instance.closeSync(); this.instances.delete(dbPath); }
    } else {
      for (const [, conn] of this.connections) conn.closeSync();
      for (const [, instance] of this.instances) instance.closeSync();
      this.connections.clear();
      this.instances.clear();
    }
  }
}

let instance: DuckDBService | null = null;

export function getDuckDBService(): DuckDBService {
  if (!instance) instance = new DuckDBService();
  return instance;
}
