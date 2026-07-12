/**
 * generate_report Tool
 * 
 * 基于 DataProfile + 探索结果 + 透视表，生成分析报告。
 * 支持 Markdown / JSON / Excel 格式。
 */

import type { Tool, ToolContext } from '../types';
import { db } from '../../db/client';
import { excelProfiles, pivotTables, excelReports } from '../../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { logger } from '../../utils/logger';

interface GenerateReportParams {
  profile_id: string;
  pivot_table_ids?: string[];
  exploration_summary?: string;    // LLM 总结的探索发现
  format: 'markdown' | 'json' | 'excel';
  sections?: Array<'summary' | 'statistics' | 'pivot_tables' | 'insights'>;
}

interface GenerateReportResult {
  reportId: string;
  format: string;
  content: string;
  insights: string[];
}

export const generateReportTool: Tool<GenerateReportParams, GenerateReportResult> = {
  name: 'generate_report',
  description: '生成数据分析报告。基于 DataProfile、探索结果和透视表，生成 Markdown/JSON/Excel 格式的分析报告。',
  parameters: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'DataProfile ID',
      },
      pivot_table_ids: {
        type: 'array',
        description: '透视表 ID 列表（可选）',
        items: { type: 'string', description: '透视表 ID' },
      },
      exploration_summary: {
        type: 'string',
        description: 'LLM 总结的探索发现（可选）',
      },
      format: {
        type: 'string',
        description: '报告格式',
        enum: ['markdown', 'json', 'excel'],
        default: 'markdown',
      },
      sections: {
        type: 'array',
        description: '报告包含的章节',
        items: {
          type: 'string',
          enum: ['summary', 'statistics', 'pivot_tables', 'insights'],
        },
        default: ['summary', 'statistics', 'pivot_tables', 'insights'],
      },
    },
    required: ['profile_id'],
  },

  async execute(params: GenerateReportParams, _ctx: ToolContext): Promise<GenerateReportResult> {
    const {
      profile_id,
      pivot_table_ids = [],
      exploration_summary,
      format = 'markdown',
      sections = ['summary', 'statistics', 'pivot_tables', 'insights'],
    } = params;

    logger.info('[generate_report] 开始', { profileId: profile_id, format });

    // 获取 Profile
    const profile = await db.query.excelProfiles.findFirst({
      where: eq(excelProfiles.id, profile_id),
    });

    if (!profile) {
      throw new Error(`Profile not found: ${profile_id}`);
    }

    // 获取透视表
    let pivots: Array<{ id: string; name: string; rows: unknown; rowCount: number; visualization: unknown }> = [];
    if (pivot_table_ids.length > 0) {
      pivots = await db.query.pivotTables.findMany({
        where: inArray(pivotTables.id, pivot_table_ids),
      }) as typeof pivots;
    }

    // 生成报告内容
    let content: string;
    const insights: string[] = [];

    if (format === 'markdown') {
      content = generateMarkdownReport(profile, pivots, sections, exploration_summary, insights);
    } else if (format === 'json') {
      content = generateJsonReport(profile, pivots, sections, exploration_summary, insights);
    } else {
      // excel 格式先转为 markdown，后续可导出
      content = generateMarkdownReport(profile, pivots, sections, exploration_summary, insights);
    }

    // 存入 PostgreSQL
    const reportId = crypto.randomUUID();
    await db.insert(excelReports).values({
      id: reportId,
      profileId: profile_id,
      title: `Excel 分析报告 - ${profile.fileNames.join(', ')}`,
      format,
      content,
      pivotTableIds: pivot_table_ids,
      insights,
    });

    logger.info('[generate_report] 完成', { reportId, format });

    return {
      reportId,
      format,
      content,
      insights,
    };
  },
};

function generateMarkdownReport(
  profile: { fileNames: string[]; sheets: unknown; businessContext: string | null },
  pivots: Array<{ id: string; name: string; rows: unknown; rowCount: number }>,
  sections: string[],
  explorationSummary?: string,
  insights?: string[]
): string {
  const sheets = profile.sheets as Array<{ sheetName: string; rowCount: number; columns: Array<{ name: string; type: string }> }>;
  const lines: string[] = [];

  lines.push(`# Excel 数据分析报告\n`);
  lines.push(`**分析文件**: ${profile.fileNames.join(', ')}\n`);
  lines.push(`**生成时间**: ${new Date().toISOString()}\n`);

  if (profile.businessContext) {
    lines.push(`**业务场景**: ${profile.businessContext}\n`);
  }

  // Summary
  if (sections.includes('summary')) {
    lines.push(`## 一、数据概览\n`);
    lines.push(`- **文件数量**: ${profile.fileNames.length}`);
    lines.push(`- **Sheet 数量**: ${sheets.length}`);
    
    let totalRows = 0;
    for (const sheet of sheets) {
      lines.push(`- **${sheet.sheetName}**: ${sheet.rowCount} 行, ${sheet.columns.length} 列`);
      totalRows += sheet.rowCount;
    }
    lines.push(`- **总行数**: ${totalRows}\n`);
  }

  // Statistics
  if (sections.includes('statistics')) {
    lines.push(`## 二、统计摘要\n`);
    
    for (const sheet of sheets) {
      lines.push(`### ${sheet.sheetName}\n`);
      lines.push(`| 列名 | 类型 | 说明 |`);
      lines.push(`|------|------|------|`);
      
      for (const col of sheet.columns) {
        const desc = col.type === 'number' ? '数值型' : col.type === 'date' ? '日期型' : col.type === 'boolean' ? '布尔型' : '文本型';
        lines.push(`| ${col.name} | ${col.type} | ${desc} |`);
      }
      lines.push('');
    }
  }

  // Pivot Tables
  if (sections.includes('pivot_tables') && pivots.length > 0) {
    lines.push(`## 三、透视表\n`);
    
    for (const pivot of pivots) {
      lines.push(`### ${pivot.name}\n`);
      lines.push(`**行数**: ${pivot.rowCount}\n`);
      
      const rows = pivot.rows as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]!);
        lines.push(`| ${headers.join(' | ')} |`);
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
        
        for (const row of rows.slice(0, 20)) {
          const vals = headers.map(h => String(row[h] ?? ''));
          lines.push(`| ${vals.join(' | ')} |`);
        }
        
        if (rows.length > 20) {
          lines.push(`\n*（显示前 20 行，共 ${rows.length} 行）*\n`);
        }
      }
    }
  }

  // Insights
  if (sections.includes('insights')) {
    lines.push(`## 四、分析洞察\n`);
    
    if (explorationSummary) {
      lines.push(explorationSummary);
      insights?.push(explorationSummary);
    } else {
      lines.push(`*（未提供探索总结）*\n`);
    }
  }

  return lines.join('\n');
}

function generateJsonReport(
  profile: { fileNames: string[]; sheets: unknown; businessContext: string | null },
  pivots: Array<{ id: string; name: string; rows: unknown; rowCount: number }>,
  sections: string[],
  explorationSummary?: string,
  insights?: string[]
): string {
  const sheets = profile.sheets as Array<{ sheetName: string; rowCount: number; columns: unknown[] }>;
  
  const report: Record<string, unknown> = {
    title: `Excel 数据分析报告 - ${profile.fileNames.join(', ')}`,
    generatedAt: new Date().toISOString(),
    fileNames: profile.fileNames,
    businessContext: profile.businessContext,
  };

  if (sections.includes('summary')) {
    report.summary = {
      fileCount: profile.fileNames.length,
      sheetCount: sheets.length,
      totalRows: sheets.reduce((sum, s) => sum + s.rowCount, 0),
      sheets: sheets.map(s => ({ name: s.sheetName, rows: s.rowCount, columns: s.columns.length })),
    };
  }

  if (sections.includes('statistics')) {
    report.statistics = sheets.map(s => ({
      sheetName: s.sheetName,
      columns: s.columns,
    }));
  }

  if (sections.includes('pivot_tables')) {
    report.pivotTables = pivots.map(p => ({
      id: p.id,
      name: p.name,
      rowCount: p.rowCount,
      rows: p.rows,
    }));
  }

  if (sections.includes('insights')) {
    report.insights = explorationSummary ? [explorationSummary] : [];
    if (insights) insights.push(...(report.insights as string[]));
  }

  return JSON.stringify(report, null, 2);
}
