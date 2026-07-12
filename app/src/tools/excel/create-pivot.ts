/**
 * create_pivot Tool
 * 
 * 根据配置生成透视表，全量结果存入 PostgreSQL。
 * 支持 2D/3D/交叉表，输出可视化数据（D3/ECharts 可消费）。
 */

import type { Tool, ToolContext } from '../types';
import type { PivotConfig, VisualizationData } from '../../db/schema/excel';
import { getDuckDBService } from '../../analyze/duckdb-service';
import { db } from '../../db/client';
import { excelProfiles, pivotTables } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../../utils/logger';

interface CreatePivotParams {
  profile_id: string;
  config: PivotConfig;
  name: string;
  description?: string;
}

interface CreatePivotResult {
  pivotTableId: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  sql: string;
  sourceSheets: string[];
  visualization?: VisualizationData;
}

export const createPivotTool: Tool<CreatePivotParams, CreatePivotResult> = {
  name: 'create_pivot',
  description: '生成透视表（支持 2D/3D/交叉表）。根据配置执行 SQL 聚合，全量结果存入数据库。可输出可视化数据（D3/ECharts）。',
  parameters: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'DataProfile ID',
      },
      config: {
        type: 'object',
        description: '透视表配置',
        properties: {
          rowFields: {
            type: 'array',
            description: '行维度字段',
            items: { type: 'string', description: '字段名' },
          },
          columnFields: {
            type: 'array',
            description: '列维度字段（交叉表）',
            items: { type: 'string', description: '字段名' },
          },
          pageFields: {
            type: 'array',
            description: '页维度字段（3D 透视表）',
            items: { type: 'string', description: '字段名' },
          },
          valueField: {
            type: 'string',
            description: '值字段',
          },
          aggregation: {
            type: 'string',
            description: '聚合方式',
            enum: ['sum', 'avg', 'count', 'min', 'max'],
          },
          filters: {
            type: 'object',
            description: '过滤条件',
          },
          chartType: {
            type: 'string',
            description: '可视化类型',
            enum: ['bar', 'line', 'pie', 'heatmap', 'treemap', 'sunburst', 'sankey', 'radar', 'scatter', 'waterfall', 'funnel', 'gauge'],
          },
        },
        required: ['rowFields', 'valueField', 'aggregation'],
      },
      name: {
        type: 'string',
        description: '透视表名称',
      },
      description: {
        type: 'string',
        description: '透视表描述（可选）',
      },
    },
    required: ['profile_id', 'config', 'name'],
  },

  async execute(params: CreatePivotParams, _ctx: ToolContext): Promise<CreatePivotResult> {
    const { profile_id, config, name, description } = params;

    logger.info('[create_pivot] 开始', { profileId: profile_id, name });

    // 获取 Profile
    const profile = await db.query.excelProfiles.findFirst({
      where: eq(excelProfiles.id, profile_id),
    });

    if (!profile) {
      throw new Error(`Profile not found: ${profile_id}`);
    }

    const sheets = profile.sheets as Array<{ duckdbTable: string; documentId: string; sheetName: string }>;
    const tableName = profile.merged && profile.mergedDuckdbTable
      ? profile.mergedDuckdbTable
      : sheets[0]!.duckdbTable;

    const dbPath = `temp_${sheets[0]!.documentId}.duckdb`;
    const duckdb = getDuckDBService();
    const conn = await duckdb.getConnection(dbPath);

    // 构建 SQL
    const aggFunc = config.aggregation.toUpperCase();
    const rowFields = config.rowFields.map(f => `"${f}"`).join(', ');
    const whereClause = config.filters
      ? ' WHERE ' + Object.entries(config.filters)
          .map(([k, v]) => `"${k}" = '${v}'`)
          .join(' AND ')
      : '';

    let sql: string;
    if (config.pageFields && config.pageFields.length > 0) {
      // 3D 透视表
      const pageFields = config.pageFields.map(f => `"${f}"`).join(', ');
      sql = `SELECT ${pageFields}, ${rowFields}, ${aggFunc}(CAST("${config.valueField}" AS DOUBLE)) as "${config.valueField}_${config.aggregation}"
             FROM "${tableName}"${whereClause}
             GROUP BY ${pageFields}, ${rowFields}
             ORDER BY ${pageFields}, ${rowFields}`;
    } else if (config.columnFields && config.columnFields.length > 0) {
      // 交叉表
      const colFields = config.columnFields.map(f => `"${f}"`).join(', ');
      sql = `SELECT ${rowFields}, ${colFields}, ${aggFunc}(CAST("${config.valueField}" AS DOUBLE)) as "${config.valueField}_${config.aggregation}"
             FROM "${tableName}"${whereClause}
             GROUP BY ${rowFields}, ${colFields}
             ORDER BY ${rowFields}, ${colFields}`;
    } else {
      // 2D 简单表
      sql = `SELECT ${rowFields}, ${aggFunc}(CAST("${config.valueField}" AS DOUBLE)) as "${config.valueField}_${config.aggregation}", COUNT(*) as "记录数"
             FROM "${tableName}"${whereClause}
             GROUP BY ${rowFields}
             ORDER BY "${config.valueField}_${config.aggregation}" DESC`;
    }

    // 执行查询
    const result = await duckdb.executeQuery(conn, sql);

    // 生成可视化数据
    const visualization = generateVisualization(config, result.rows);

    // 存入 PostgreSQL
    const pivotTableId = crypto.randomUUID();
    const sourceSheets = sheets.map(s => `${s.documentId}:${s.sheetName}`);

    await db.insert(pivotTables).values({
      id: pivotTableId,
      profileId: profile_id,
      name,
      description,
      config,
      rows: result.rows,
      rowCount: result.rowCount,
      visualization,
      sql,
      sourceSheets,
    });

    logger.info('[create_pivot] 完成', { pivotTableId, rowCount: result.rowCount });

    return {
      pivotTableId,
      rowCount: result.rowCount,
      rows: result.rows,
      sql,
      sourceSheets,
      visualization,
    };
  },
};

/**
 * 生成可视化数据
 */
function generateVisualization(
  config: PivotConfig,
  rows: Record<string, unknown>[]
): VisualizationData {
  const chartType = config.chartType ?? 'bar';
  const valueKey = `${config.valueField}_${config.aggregation}`;

  if (chartType === 'bar' || chartType === 'line' || chartType === 'pie') {
    // 标准图表
    const categories = rows.map(r => String(r[config.rowFields[0]!]));
    const data = rows.map(r => Number(r[valueKey]) || 0);
    return {
      chartType,
      categories,
      series: [{ name: `${config.valueField} (${config.aggregation})`, data }],
      title: `${config.rowFields.join(', ')} - ${config.valueField}`,
      xAxisName: config.rowFields.join(', '),
      yAxisName: `${config.valueField} (${config.aggregation})`,
    };
  }

  if (chartType === 'heatmap' && config.columnFields) {
    // 热力图
    const heatmapData = rows.map(r => ({
      x: String(r[config.rowFields[0]!]),
      y: String(r[config.columnFields![0]!]),
      value: Number(r[valueKey]) || 0,
    }));
    return { chartType: 'heatmap', heatmapData };
  }

  if (chartType === 'treemap' || chartType === 'sunburst') {
    // 层级数据
    const hierarchy = rows.map(r => ({
      name: String(r[config.rowFields[0]!]),
      value: Number(r[valueKey]) || 0,
    }));
    return { chartType, hierarchyData: hierarchy };
  }

  if (chartType === 'scatter') {
    // 散点图
    const scatterData = rows.map(r => ({
      x: Number(r[config.rowFields[0]!]) || 0,
      y: Number(r[valueKey]) || 0,
      label: String(r[config.rowFields[0]!]),
    }));
    return { chartType: 'scatter', scatterData };
  }

  // 默认返回 bar
  const categories = rows.map(r => String(r[config.rowFields[0]!]));
  const data = rows.map(r => Number(r[valueKey]) || 0);
  return {
    chartType: 'bar',
    categories,
    series: [{ name: `${config.valueField} (${config.aggregation})`, data }],
  };
}
