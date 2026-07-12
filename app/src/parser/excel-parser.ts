/**
 * Excel 流式解析器
 * 
 * 职责：
 * - 流式解析 Excel 文件（xlsx 库）
 * - 自动推断列类型
 * - 提取丰富的数据画像（分位数、频次分布等）
 * - 写入 DuckDB
 */

import * as XLSX from 'xlsx';
import type { DuckDBService } from '../analyze/duckdb-service';
import { logger } from '../utils/logger';
import type { DuckDBConnection } from '@duckdb/node-api';

// ─── 类型定义 ───

export interface ColumnProfile {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  nullable: boolean;
  nullCount: number;
  uniqueCount: number;
  numericStats?: {
    min: number; max: number; avg: number; median: number; std: number;
    percentiles: { P25: number; P50: number; P75: number; P90: number; P95: number; P99: number };
  };
  topValues?: { value: string; count: number }[];
  frequencyDistribution?: Record<string, number>;
  dateRange?: { min: string; max: string };
  granularity?: 'day' | 'week' | 'month' | 'year';
  sampleValues?: unknown[];
}

export interface SheetProfile {
  documentId: string;
  fileName: string;
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  columns: ColumnProfile[];
  sampleData: Record<string, unknown>[];
  duckdbTable: string;
}

export interface ParseResult {
  sheets: SheetProfile[];
  totalRows: number;
}

// ─── ExcelParser ───

export class ExcelParser {
  constructor(private duckdb: DuckDBService) {}

  async parse(
    filePath: string,
    documentId: string,
    fileName: string,
    dbPath: string
  ): Promise<ParseResult> {
    logger.info(`[ExcelParser] 开始解析: ${fileName}`, { documentId });

    const conn = await this.duckdb.getConnection(dbPath);
    const workbook = XLSX.readFile(filePath);
    const sheets: SheetProfile[] = [];
    let totalRows = 0;

    for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex++) {
      const sheetName = workbook.SheetNames[sheetIndex]!;
      const worksheet = workbook.Sheets[sheetName]!;

      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: null,
        raw: false,
      });

      if (jsonData.length === 0) {
        logger.warn(`[ExcelParser] Sheet "${sheetName}" 为空，跳过`);
        continue;
      }

      const columns = Object.keys(jsonData[0]!);
      const columnProfiles = this.inferColumnTypes(jsonData, columns);

      const tableName = `excel_${documentId.replace(/-/g, '')}_${sheetIndex}`;
      await this.writeToDuckDB(conn, tableName, columns, jsonData);
      await this.enrichColumnProfiles(conn, tableName, columnProfiles);

      const sampleData = jsonData.slice(0, 10);

      sheets.push({
        documentId,
        fileName,
        sheetName,
        sheetIndex,
        rowCount: jsonData.length,
        columns: columnProfiles,
        sampleData,
        duckdbTable: tableName,
      });

      totalRows += jsonData.length;
      logger.info(`[ExcelParser] Sheet "${sheetName}" 完成`, { rows: jsonData.length, columns: columns.length });
    }

    return { sheets, totalRows };
  }

  private inferColumnTypes(data: Record<string, unknown>[], columns: string[]): ColumnProfile[] {
    return columns.map(colName => {
      const sample = data.slice(0, 1000);
      const values = sample.map(row => row[colName]).filter(v => v !== null && v !== undefined);

      let type: 'string' | 'number' | 'date' | 'boolean' = 'string';
      
      if (values.length > 0) {
        const firstVal = values[0];
        if (typeof firstVal === 'number') {
          type = 'number';
        } else if (typeof firstVal === 'boolean') {
          type = 'boolean';
        } else if (typeof firstVal === 'string') {
          if (/^\d{4}-\d{2}-\d{2}/.test(firstVal)) {
            type = 'date';
          } else {
            const numCount = values.filter(v => !isNaN(Number(v))).length;
            if (numCount > values.length * 0.8) type = 'number';
          }
        }
      }

      const allValues = data.map(row => row[colName]);
      const nullCount = allValues.filter(v => v === null || v === undefined).length;
      const uniqueValues = new Set(allValues.filter(v => v !== null && v !== undefined).map(String));

      return {
        name: colName,
        type,
        nullable: nullCount > 0,
        nullCount,
        uniqueCount: uniqueValues.size,
      };
    });
  }

  private async writeToDuckDB(
    conn: DuckDBConnection,
    tableName: string,
    columns: string[],
    data: Record<string, unknown>[]
  ): Promise<void> {
    const colDefs = columns.map(c => ({ name: c, type: 'VARCHAR' }));
    await this.duckdb.createTable(conn, tableName, colDefs);

    const chunkSize = 1000;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      await this.duckdb.insertChunk(conn, tableName, columns, chunk);
    }
  }

  private async enrichColumnProfiles(
    conn: DuckDBConnection,
    tableName: string,
    profiles: ColumnProfile[]
  ): Promise<void> {
    for (const profile of profiles) {
      try {
        if (profile.type === 'number') {
          const statsSql = `
            SELECT
              MIN(CAST("${profile.name}" AS DOUBLE)) as min_val,
              MAX(CAST("${profile.name}" AS DOUBLE)) as max_val,
              AVG(CAST("${profile.name}" AS DOUBLE)) as avg_val,
              MEDIAN(CAST("${profile.name}" AS DOUBLE)) as median_val,
              STDDEV(CAST("${profile.name}" AS DOUBLE)) as std_val,
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CAST("${profile.name}" AS DOUBLE)) as p25,
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY CAST("${profile.name}" AS DOUBLE)) as p50,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CAST("${profile.name}" AS DOUBLE)) as p75,
              PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY CAST("${profile.name}" AS DOUBLE)) as p90,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CAST("${profile.name}" AS DOUBLE)) as p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY CAST("${profile.name}" AS DOUBLE)) as p99
            FROM "${tableName}"
            WHERE "${profile.name}" IS NOT NULL AND "${profile.name}" != ''
          `;
          const statsResult = await this.duckdb.executeQuery(conn, statsSql);
          
          if (statsResult.rows.length > 0) {
            const s = statsResult.rows[0] as Record<string, number>;
            profile.numericStats = {
              min: s.min_val ?? 0, max: s.max_val ?? 0, avg: s.avg_val ?? 0,
              median: s.median_val ?? 0, std: s.std_val ?? 0,
              percentiles: {
                P25: s.p25 ?? 0, P50: s.p50 ?? 0, P75: s.p75 ?? 0,
                P90: s.p90 ?? 0, P95: s.p95 ?? 0, P99: s.p99 ?? 0,
              },
            };

            const topSql = `
              SELECT "${profile.name}" as val, COUNT(*) as cnt
              FROM "${tableName}" WHERE "${profile.name}" IS NOT NULL
              GROUP BY "${profile.name}" ORDER BY CAST("${profile.name}" AS DOUBLE) DESC LIMIT 10
            `;
            const topResult = await this.duckdb.executeQuery(conn, topSql);
            profile.topValues = topResult.rows.map(r => ({
              value: String((r as Record<string, unknown>).val),
              count: Number((r as Record<string, unknown>).cnt),
            }));
          }
        } else if (profile.type === 'string') {
          const freqSql = `
            SELECT "${profile.name}" as val, COUNT(*) as cnt
            FROM "${tableName}" WHERE "${profile.name}" IS NOT NULL AND "${profile.name}" != ''
            GROUP BY "${profile.name}" ORDER BY cnt DESC
          `;
          const freqResult = await this.duckdb.executeQuery(conn, freqSql);
          const freq: Record<string, number> = {};
          for (const row of freqResult.rows) {
            const r = row as Record<string, unknown>;
            freq[String(r.val)] = Number(r.cnt);
          }
          profile.frequencyDistribution = freq;
          profile.sampleValues = Object.keys(freq).slice(0, 5);
        } else if (profile.type === 'date') {
          const dateSql = `
            SELECT MIN("${profile.name}") as min_date, MAX("${profile.name}") as max_date
            FROM "${tableName}" WHERE "${profile.name}" IS NOT NULL AND "${profile.name}" != ''
          `;
          const dateResult = await this.duckdb.executeQuery(conn, dateSql);
          if (dateResult.rows.length > 0) {
            const dates = dateResult.rows[0] as Record<string, string>;
            if (dates.min_date && dates.max_date) {
              profile.dateRange = { min: dates.min_date, max: dates.max_date };
              const daysDiff = (new Date(dates.max_date).getTime() - new Date(dates.min_date).getTime()) / 86400000;
              if (daysDiff <= 31) profile.granularity = 'day';
              else if (daysDiff <= 365) profile.granularity = 'week';
              else if (daysDiff <= 1825) profile.granularity = 'month';
              else profile.granularity = 'year';
            }
          }
        }
      } catch (err) {
        logger.warn(`[ExcelParser] 列 "${profile.name}" 统计失败`, { error: String(err) });
      }
    }
  }
}
