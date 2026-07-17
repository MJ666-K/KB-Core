import type { Tool, ToolContext } from '../types';
import { getDuckDBService } from '../../analyze/duckdb-service';
import { db } from '../../db/client';
import { excelProfiles } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { LLMService } from '../../llm/llm-service';
import { logger } from '../../utils/logger';

interface QueryExcelParams {
  profileId: string;
  question: string;
}

interface QueryExcelResult {
  success: boolean;
  sql?: string;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
  explanation?: string;
}

// 智能类型转换：根据列类型生成正确的 SQL 表达式
function generateColumnExpression(columnName: string, columnType: string, operation?: string): string {
  const quotedName = `"${columnName}"`;
  
  if (operation === 'aggregate') {
    // 聚合操作需要类型转换
    if (columnType === 'number') {
      return `CAST(${quotedName} AS DOUBLE)`;
    } else if (columnType === 'date') {
      return `CAST(${quotedName} AS DATE)`;
    }
  }
  
  return quotedName;
}

// 生成智能 SQL
async function generateSmartSQL(
  tableName: string,
  columns: Array<{ name: string; type: string }>,
  question: string
): Promise<{ sql: string; explanation: string }> {
  const llm = new LLMService();
  
  const schemaDesc = columns.map(c => {
    const aggExpr = generateColumnExpression(c.name, c.type, 'aggregate');
    return `- ${c.name} (${c.type}) → 聚合时使用: ${aggExpr}`;
  }).join('\n');

  const prompt = `你是一个数据分析专家。根据用户问题生成 DuckDB SQL 查询。

表结构：
表名: ${tableName}
列信息（包含类型转换规则）:
${schemaDesc}

用户问题: ${question}

要求：
1. 数值列聚合必须使用 CAST("列名" AS DOUBLE)，例如: SUM(CAST("金额" AS DOUBLE))
2. 日期列使用 CAST("列名" AS DATE)
3. 字符串列直接使用 "列名"
4. 返回 JSON 格式: {"sql": "SQL语句", "explanation": "查询说明"}

示例：
问题: "按区域统计销售额"
回答: {"sql": "SELECT \\"区域\\", SUM(CAST(\\"金额\\" AS DOUBLE)) as 总销售额 FROM table GROUP BY \\"区域\\" ORDER BY 总销售额 DESC", "explanation": "按区域分组，计算每个区域的销售额总和"}

请返回 JSON 格式：`;

  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    let content = response.content || '';
    
    // 清理 markdown 代码块标记
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sql: parsed.sql || '',
        explanation: parsed.explanation || '',
      };
    }
  } catch (err) {
    logger.error('[Excel Query] JSON 解析失败:', err);
  }

  // 降级：直接提取 SQL
  const sqlMatch = content.match(/SELECT[\s\S]+?(?=;|$)/i);
  return {
    sql: sqlMatch ? sqlMatch[0].trim() : '',
    explanation: '自动生成的查询',
  };
}

export const queryExcelTool: Tool<QueryExcelParams, QueryExcelResult> = {
  name: 'query_excel',
  description: '查询 Excel 数据。支持自然语言提问，自动转换为 SQL 并执行。智能处理类型转换。',
  parameters: {
    type: 'object',
    properties: {
      profileId: {
        type: 'string',
        description: 'Excel Profile ID',
      },
      question: {
        type: 'string',
        description: '自然语言问题，例如："按区域统计销售额"',
      },
    },
    required: ['profileId', 'question'],
  },

  async execute(params: QueryExcelParams, _ctx: ToolContext): Promise<QueryExcelResult> {
    const { profileId, question } = params;

    logger.info('[Excel Query] 开始查询:', { profileId, question });

    try {
      // 获取 Profile
      const profile = await db.query.excelProfiles.findFirst({
        where: eq(excelProfiles.id, profileId),
      });

      if (!profile) {
        return { success: false, error: 'Profile not found' };
      }

      const sheets = profile.sheets as Array<{
        duckdbTable: string;
        documentId: string;
        columns: Array<{ name: string; type: string }>;
      }>;

      const tableName = sheets[0]!.duckdbTable;
      const columns = sheets[0]!.columns;
      const dbPath = `excel_${sheets[0]!.documentId.replace(/-/g, '')}.duckdb`;

      // 生成智能 SQL
      logger.info('[Excel Query] 生成 SQL...');
      const { sql, explanation } = await generateSmartSQL(tableName, columns, question);
      logger.info('[Excel Query] 生成的 SQL:', sql);

      if (!sql) {
        return { success: false, error: '无法生成 SQL' };
      }

      // 执行查询
      logger.info('[Excel Query] 执行 SQL...');
      const duckdb = getDuckDBService();
      const conn = await duckdb.getConnection(dbPath);
      const result = await duckdb.executeQuery(conn, sql);

      logger.info('[Excel Query] 查询完成:', { rowCount: result.rowCount });

      return {
        success: true,
        sql,
        rows: result.rows,
        rowCount: result.rowCount,
        explanation,
      };

    } catch (err) {
      logger.error('[Excel Query] 查询失败:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : '查询失败',
      };
    }
  },
};
