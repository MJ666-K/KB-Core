/**
 * profile_excel Tool
 * 
 * 流式解析 Excel，提取丰富的数据画像，写入 DuckDB。
 */

import type { Tool, ToolContext } from '../types';
import { ExcelParser } from '../../parser/excel-parser';
import { getDuckDBService } from '../../analyze/duckdb-service';
import { db } from '../../db/client';
import { excelProfiles } from '../../db/schema';
import { logger } from '../../utils/logger';
import { existsSync } from 'fs';

interface ProfileExcelParams {
  file_paths: string[];          // Excel 文件路径列表
  document_ids?: string[];       // 文档 ID（可选，用于关联）
  merge_if_same?: boolean;       // 格式相同时是否合并
}

interface ProfileExcelResult {
  profileId: string;
  fileCount: number;
  fileNames: string[];
  sheetCount: number;
  totalRows: number;
  sheets: unknown[];
  merged: boolean;
  mergedDuckdbTable?: string;
}

export const profileExcelTool: Tool<ProfileExcelParams, ProfileExcelResult> = {
  name: 'profile_excel',
  description: '解析 Excel 文件，提取数据画像（列类型、统计特征、样本数据），写入 DuckDB 分析引擎。支持多文件、多 Sheet。',
  parameters: {
    type: 'object',
    properties: {
      file_paths: {
        type: 'array',
        description: 'Excel 文件路径列表（支持多文件）',
        items: { type: 'string', description: '文件路径' },
      },
      document_ids: {
        type: 'array',
        description: '文档 ID 列表（可选，用于关联）',
        items: { type: 'string', description: '文档 ID' },
      },
      merge_if_same: {
        type: 'boolean',
        description: '格式相同时是否合并（默认 true）',
        default: true,
      },
    },
    required: ['file_paths'],
  },

  async execute(params: ProfileExcelParams, _ctx: ToolContext): Promise<ProfileExcelResult> {
    const { file_paths, document_ids, merge_if_same = true } = params;

    logger.info('[profile_excel] 开始', { fileCount: file_paths.length });

    // 验证文件存在
    for (const fp of file_paths) {
      if (!existsSync(fp)) {
        throw new Error(`文件不存在: ${fp}`);
      }
    }

    const duckdb = getDuckDBService();
    await duckdb.init();
    const parser = new ExcelParser(duckdb);

    const allSheets: unknown[] = [];
    let totalRows = 0;
    const fileNames: string[] = [];

    // 解析每个文件
    for (let i = 0; i < file_paths.length; i++) {
      const filePath = file_paths[i]!;
      const fileName = filePath.split('/').pop() ?? filePath;
      const documentId = document_ids?.[i] ?? `doc_${i}`;
      const dbPath = `temp_${documentId}.duckdb`;

      fileNames.push(fileName);

      const result = await parser.parse(filePath, documentId, fileName, dbPath);
      allSheets.push(...result.sheets);
      totalRows += result.totalRows;
    }

    // 检查是否所有 Sheet 格式相同（可合并）
    let merged = false;
    let mergedDuckdbTable: string | undefined;

    if (merge_if_same && allSheets.length > 1) {
      const firstSheet = allSheets[0] as { columns: { name: string; type: string }[] };
      const allSame = allSheets.every(s => {
        const sheet = s as { columns: { name: string; type: string }[] };
        if (sheet.columns.length !== firstSheet.columns.length) return false;
        return sheet.columns.every((c, idx) => 
          c.name === firstSheet.columns[idx]!.name && c.type === firstSheet.columns[idx]!.type
        );
      });

      if (allSame) {
        // 合并所有表
        const conn = await duckdb.getConnection(`temp_${document_ids?.[0] ?? 'doc_0'}.duckdb`);
        mergedDuckdbTable = `excel_merged_${Date.now()}`;
        const tables = allSheets.map(s => (s as { duckdbTable: string }).duckdbTable);
        
        const unionSql = `
          CREATE TABLE "${mergedDuckdbTable}" AS
          ${tables.map(t => `SELECT * FROM "${t}"`).join(' UNION ALL ')}
        `;
        await conn.runQuery(unionSql);
        merged = true;

        logger.info('[profile_excel] 格式相同，已合并', { mergedTable: mergedDuckdbTable });
      }
    }

    // 存入 PostgreSQL
    const profileId = crypto.randomUUID();
    await db.insert(excelProfiles).values({
      id: profileId,
      documentIds: document_ids ?? fileNames.map((_, i) => `doc_${i}`),
      fileCount: fileNames.length,
      fileNames,
      sheets: allSheets,
      merged,
      mergedDuckdbTable,
    });

    logger.info('[profile_excel] 完成', { profileId, totalRows, sheetCount: allSheets.length });

    return {
      profileId,
      fileCount: fileNames.length,
      fileNames,
      sheetCount: allSheets.length,
      totalRows,
      sheets: allSheets,
      merged,
      mergedDuckdbTable,
    };
  },
};
