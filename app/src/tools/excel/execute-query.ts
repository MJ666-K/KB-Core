/**
 * execute_query Tool
 * 
 * LLM 生成任意 SQL，在 DuckDB 上执行，返回结果。
 * 这是 LLM 深度探索数据的核心 Tool。
 */

import type { Tool, ToolContext } from '../types';
import { getDuckDBService } from '../../analyze/duckdb-service';
import { db } from '../../db/client';
import { excelProfiles } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../../utils/logger';

interface ExecuteQueryParams {
  profile_id: string;           // 关联的 DataProfile
  sql: string;                  // LLM 生成的 SQL（任意 SELECT）
  description?: string;         // LLM 说明查询目的
}

interface ExecuteQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  sql: string;
  executionTimeMs: number;
  truncated: boolean;
}

export const executeQueryTool: Tool<ExecuteQueryParams, ExecuteQueryResult> = {
  name: 'execute_query',
  description: '在 DuckDB 分析引擎上执行 SQL 查询（只允许 SELECT）。用于深度探索数据：分布分析、峰值分析、异常值检测、趋势分析、相关性分析等。支持多轮探索。',
  parameters: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'DataProfile ID（从 profile_excel 返回）',
      },
      sql: {
        type: 'string',
        description: 'SQL 查询语句（只允许 SELECT）。表名从 DataProfile 的 sheets[].duckdbTable 获取。',
      },
      description: {
        type: 'string',
        description: '查询目的说明（可选）',
      },
    },
    required: ['profile_id', 'sql'],
  },

  async execute(params: ExecuteQueryParams, _ctx: ToolContext): Promise<ExecuteQueryResult> {
    const { profile_id, sql, description } = params;

    logger.info('[execute_query] 开始', { profileId: profile_id, description, sql: sql.slice(0, 100) });

    // 获取 Profile
    const profile = await db.query.excelProfiles.findFirst({
      where: eq(excelProfiles.id, profile_id),
    });

    if (!profile) {
      throw new Error(`Profile not found: ${profile_id}`);
    }

    // 获取第一个 Sheet 的 DuckDB 表名（或合并表）
    const sheets = profile.sheets as Array<{ duckdbTable: string; documentId: string }>;
    const dbPath = `temp_${sheets[0]!.documentId}.duckdb`;
    const duckdb = getDuckDBService();
    const conn = await duckdb.getConnection(dbPath);

    // 执行查询
    const result = await duckdb.executeQuery(conn, sql);

    // 限制返回行数
    const MAX_ROWS = 10000;
    const truncated = result.rowCount > MAX_ROWS;
    const rows = result.rows.slice(0, MAX_ROWS);

    logger.info('[execute_query] 完成', {
      rowCount: result.rowCount,
      truncated,
      executionTimeMs: result.executionTimeMs,
    });

    return {
      rows,
      rowCount: result.rowCount,
      sql,
      executionTimeMs: result.executionTimeMs,
      truncated,
    };
  },
};
