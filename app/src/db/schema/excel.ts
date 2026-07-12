import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

/**
 * Excel 数据画像（元数据）
 * 存储 Excel 文件的结构信息、列特征、统计摘要，供 LLM 理解数据。
 * 支持多文件、多 Sheet。
 */
export const excelProfiles = pgTable('excel_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 支持多文件
  documentIds: uuid('document_ids').array().notNull(),
  datasetId: uuid('dataset_id'),

  // 文件元数据
  fileCount: integer('file_count').notNull(),
  fileNames: text('file_names').array().notNull(),

  // 每个文件的每个 Sheet 一个 Profile（JSON）
  sheets: jsonb('sheets').notNull(),

  // 合并标记（多文件格式相同时为 true）
  merged: boolean('merged').notNull().default(false),
  mergedDuckdbTable: text('merged_duckdb_table'),

  // LLM 推断的业务含义
  businessContext: text('business_context'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
});

/**
 * 透视表（聚合结果，全量存储）
 */
export const pivotTables = pgTable('pivot_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull(),

  name: text('name').notNull(),
  description: text('description'),

  // 透视表配置
  config: jsonb('config').notNull(),

  // 聚合结果（全量，不截断）
  rows: jsonb('rows').notNull(),
  rowCount: integer('row_count').notNull(),

  // 可视化数据（D3/ECharts 可直接消费）
  visualization: jsonb('visualization'),

  // 生成 SQL（可复现）
  sql: text('sql').notNull(),
  sourceSheets: text('source_sheets').array().notNull().default([]),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * 分析报告
 */
export const excelReports = pgTable('excel_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull(),

  title: text('title').notNull(),
  format: text('format').notNull(), // markdown | json | excel
  content: text('content').notNull(),

  pivotTableIds: uuid('pivot_table_ids').array().notNull().default([]),
  insights: jsonb('insights'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── 类型定义 ───

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

export interface ColumnProfile {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  nullable: boolean;
  nullCount: number;
  uniqueCount: number;
  numericStats?: {
    min: number;
    max: number;
    avg: number;
    median: number;
    std: number;
    percentiles: {
      P25: number;
      P50: number;
      P75: number;
      P90: number;
      P95: number;
      P99: number;
    };
  };
  topValues?: { value: string; count: number }[];
  frequencyDistribution?: Record<string, number>;
  dateRange?: { min: string; max: string };
  granularity?: 'day' | 'week' | 'month' | 'year';
  sampleValues?: unknown[];
}

export interface PivotConfig {
  rowFields: string[];
  columnFields?: string[];
  pageFields?: string[];
  valueField: string;
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  filters?: Record<string, unknown>;
  sortBy?: { field: string; order: 'asc' | 'desc' };
  sourceDocuments?: string[];
  sourceSheets?: string[];
  chartType?: string;
}

export interface VisualizationData {
  chartType: string;
  series?: { name: string; data: number[] }[];
  categories?: string[];
  heatmapData?: { x: string; y: string; value: number }[];
  hierarchyData?: { name: string; value?: number; children?: unknown[] }[];
  sankeyData?: {
    nodes: { name: string }[];
    links: { source: string; target: string; value: number }[];
  };
  scatterData?: { x: number; y: number; size?: number; label?: string }[];
  pages?: { pageValue: string; rows: Record<string, unknown>[] }[];
  title?: string;
  xAxisName?: string;
  yAxisName?: string;
}
