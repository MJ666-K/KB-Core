import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ExcelParser } from '../parser/excel-parser';
import { getDuckDBService } from '../analyze/duckdb-service';
import { db } from '../db/client';
import { excelProfiles, pivotTables, excelReports } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { queryExcelTool } from '../tools/excel/query-excel';
import { generateCodeTool } from '../tools/excel/generate-code';
import { logger } from '../utils/logger';
import { LLMService } from '../llm/llm-service';

const app = new Hono();
const UPLOAD_DIR = './data/excel-uploads';

if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 获取历史分析列表
app.get('/list', async (c) => {
  try {
    const profiles = await db.query.excelProfiles.findMany({
      orderBy: [desc(excelProfiles.createdAt)],
      limit: 50,
    });

    const list = profiles.map(p => ({
      id: p.id,
      fileNames: p.fileNames,
      fileCount: p.fileCount,
      totalRows: (p.sheets as Array<{ rowCount: number }>).reduce((sum, s) => sum + s.rowCount, 0),
      createdAt: p.createdAt,
    }));

    return c.json({ success: true, list });
  } catch (err) {
    logger.error('[Excel] 获取列表失败:', err);
    return c.json({ error: '获取列表失败', success: false }, 500);
  }
});

// 上传并自动分析
app.post('/upload', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];
    
    if (!file || !(file instanceof File)) {
      return c.json({ error: '请上传文件' }, 400);
    }

    const fileName = file.name;
    logger.info(`[Excel] 开始上传: ${fileName}`);
    
    const filePath = join(UPLOAD_DIR, `${Date.now()}-${fileName}`);
    const buffer = await file.arrayBuffer();
    await Bun.write(filePath, buffer);

    logger.info(`[Excel] 文件已保存: ${filePath}`);

    // 解析 Excel
    logger.info(`[Excel] 步骤 1: 解析 Excel 文件...`);
    const duckdb = getDuckDBService();
    await duckdb.init();
    const parser = new ExcelParser(duckdb);
    const documentId = crypto.randomUUID();
    const dbPath = `excel_${documentId.replace(/-/g, '')}.duckdb`;

    const result = await parser.parse(filePath, documentId, fileName, dbPath);
    logger.info(`[Excel] 解析完成: ${result.totalRows} 行, ${result.sheets.length} 个 Sheet`);

    // 保存 Profile
    const profileId = crypto.randomUUID();
    await db.insert(excelProfiles).values({
      id: profileId,
      documentIds: [documentId],
      fileCount: 1,
      fileNames: [fileName],
      sheets: result.sheets,
      merged: false,
    });
    logger.info(`[Excel] 步骤 2: Profile 已保存: ${profileId}`);

    // 自动生成透视表
    logger.info(`[Excel] 步骤 3: 自动生成透视表...`);
    const pivots = await generatePivots(profileId, result.sheets, documentId, dbPath);
    logger.info(`[Excel] 透视表生成完成: ${pivots.length} 个`);

    // 自动生成分析报告
    logger.info(`[Excel] 步骤 4: 生成分析报告...`);
    const report = await generateReport(profileId, fileName, result.sheets, pivots);
    logger.info(`[Excel] 分析报告生成完成`);

    return c.json({
      success: true,
      profileId,
      fileName,
      sheetCount: result.sheets.length,
      totalRows: result.totalRows,
      sheets: result.sheets,
      pivots,
      report,
    });

  } catch (err) {
    logger.error('[Excel] 上传失败:', err);
    return c.json({ 
      error: err instanceof Error ? err.message : '上传失败',
      success: false,
    }, 500);
  }
});

// 获取完整分析结果
app.get('/result/:id', async (c) => {
  try {
    const profileId = c.req.param('id');
    
    const profile = await db.query.excelProfiles.findFirst({
      where: eq(excelProfiles.id, profileId),
    });

    if (!profile) {
      return c.json({ error: 'Profile not found' }, 404);
    }

    const pivots = await db.query.pivotTables.findMany({
      where: eq(pivotTables.profileId, profileId),
    });

    const report = await db.query.excelReports.findFirst({
      where: eq(excelReports.profileId, profileId),
    });

    return c.json({
      success: true,
      profile,
      pivots,
      report,
    });

  } catch (err) {
    logger.error('[Excel] 获取结果失败:', err);
    return c.json({ error: '获取结果失败', success: false }, 500);
  }
});

// 数据预览
app.get('/preview/:id', async (c) => {
  const profileId = c.req.param('id');
  const limit = Number(c.req.query('limit') || '100');
  
  const profile = await db.query.excelProfiles.findFirst({
    where: eq(excelProfiles.id, profileId),
  });

  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404);
  }

  const sheets = profile.sheets as Array<{ duckdbTable: string; documentId: string }>;
  const tableName = sheets[0]!.duckdbTable;
  const dbPath = `excel_${sheets[0]!.documentId.replace(/-/g, '')}.duckdb`;
  
  const duckdb = getDuckDBService();
  const conn = await duckdb.getConnection(dbPath);
  
  const result = await duckdb.executeQuery(conn, 
    `SELECT * FROM "${tableName}" LIMIT ${limit}`
  );

  return c.json({
    rows: result.rows,
    rowCount: result.rowCount,
  });
});

// 自然语言查询（使用 query_excel Tool）
app.post('/query', async (c) => {
  try {
    const { profileId, question, useCode } = await c.req.json();
    
    if (!profileId || !question) {
      return c.json({ error: '缺少参数' }, 400);
    }

    logger.info(`[Excel Query] 问题: ${question}`);

    if (useCode) {
      // 使用代码生成
      const result = await generateCodeTool.execute(
        { profileId, question },
        { datasetId: '', datasetIds: [] }
      );

      if (!result.success) {
        return c.json({ success: false, error: result.error });
      }

      return c.json({
        success: true,
        code: result.code,
        output: result.output,
      });
    } else {
      // 使用 SQL 查询
      const result = await queryExcelTool.execute(
        { profileId, question },
        { datasetId: '', datasetIds: [] }
      );

      if (!result.success) {
        return c.json({ success: false, error: result.error });
      }

      return c.json({
        success: true,
        sql: result.sql,
        rows: result.rows,
        rowCount: result.rowCount,
        explanation: result.explanation,
      });
    }

  } catch (err) {
    logger.error('[Excel Query] 查询失败:', err);
    return c.json({ 
      error: err instanceof Error ? err.message : '查询失败',
      success: false,
    }, 500);
  }
});

// 流式查询（SSE）
app.post('/query/stream', async (c) => {
  const { profileId, question, useCode, history } = await c.req.json();
  
  if (!profileId || !question) {
    return c.json({ error: '缺少参数' }, 400);
  }

  logger.info(`[Excel Query Stream] 问题: ${question}`);

  return streamSSE(c, async (stream) => {
    try {
      // 发送开始事件
      await stream.writeSSE({ event: 'start', data: JSON.stringify({ question }) });

      // 获取 Profile
      const profile = await db.query.excelProfiles.findFirst({
        where: eq(excelProfiles.id, profileId),
      });

      if (!profile) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Profile not found' }) });
        return;
      }

      const sheets = profile.sheets as Array<{
        duckdbTable: string;
        documentId: string;
        columns: Array<{ name: string; type: string }>;
        sheetName: string;
        rowCount: number;
      }>;

      const sheet = sheets[0]!;
      const tableName = sheet.duckdbTable;
      const columns = sheet.columns;

      // 发送思考事件
      await stream.writeSSE({ 
        event: 'thinking', 
        data: JSON.stringify({ message: '正在分析您的问题...' }) 
      });

      if (useCode) {
        // 代码模式
        await stream.writeSSE({ 
          event: 'thinking', 
          data: JSON.stringify({ message: '生成 Python 代码...' }) 
        });

        const result = await generateCodeTool.execute(
          { profileId, question },
          { datasetId: '', datasetIds: [] }
        );

        if (!result.success) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: result.error }) });
          return;
        }

        await stream.writeSSE({ 
          event: 'code', 
          data: JSON.stringify({ code: result.code }) 
        });

        await stream.writeSSE({ 
          event: 'output', 
          data: JSON.stringify({ output: result.output }) 
        });

        // 生成解释
        const explanation = await generateExplanation(question, result.output || '');
        await stream.writeSSE({ 
          event: 'explanation', 
          data: JSON.stringify({ explanation }) 
        });

      } else {
        // SQL 模式
        await stream.writeSSE({ 
          event: 'thinking', 
          data: JSON.stringify({ message: '生成 SQL 查询...' }) 
        });

        const result = await queryExcelTool.execute(
          { profileId, question },
          { datasetId: '', datasetIds: [] }
        );

        if (!result.success) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: result.error }) });
          return;
        }

        await stream.writeSSE({ 
          event: 'sql', 
          data: JSON.stringify({ sql: result.sql }) 
        });

        await stream.writeSSE({ 
          event: 'data', 
          data: JSON.stringify({ 
            rows: result.rows,
            rowCount: result.rowCount 
          }) 
        });

        // 生成解释
        const explanation = await generateExplanation(question, result.rows, result.explanation);
        await stream.writeSSE({ 
          event: 'explanation', 
          data: JSON.stringify({ explanation }) 
        });
      }

      // 生成推荐问题
      const suggestions = await generateSuggestions(profileId, sheet, question);
      await stream.writeSSE({ 
        event: 'suggestions', 
        data: JSON.stringify({ suggestions }) 
      });

      // 完成
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ success: true }) });

    } catch (err) {
      logger.error('[Excel Query Stream] 失败:', err);
      await stream.writeSSE({ 
        event: 'error', 
        data: JSON.stringify({ error: err instanceof Error ? err.message : '查询失败' }) 
      });
    }
  });
});

// 生成推荐问题
async function generateSuggestions(
  profileId: string,
  sheet: { sheetName: string; rowCount: number; columns: Array<{ name: string; type: string }> },
  lastQuestion: string
): Promise<string[]> {
  const llm = new LLMService();
  
  const columnsDesc = sheet.columns.map(c => `${c.name}(${c.type})`).join(', ');
  
  const prompt = `你是一个数据分析助手。根据以下 Excel 数据和用户刚才的问题，生成 3 个相关的推荐问题。

数据信息：
- Sheet: ${sheet.sheetName}
- 行数: ${sheet.rowCount}
- 列: ${columnsDesc}

用户刚才的问题: ${lastQuestion}

要求：
1. 问题要与当前数据相关
2. 问题要有分析价值
3. 问题要简洁明了
4. 返回 JSON 数组格式: ["问题1", "问题2", "问题3"]

示例：
["按区域统计销售额", "哪个产品销量最高", "最近一个月的趋势如何"]

请返回 JSON 数组：`;

  try {
    const response = await llm.chat({
      messages: [{ role: 'user', content: prompt }],
    });

    let content = response.content || '';
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 3);
      }
    }
  } catch (err) {
    logger.error('[Excel Suggestions] 生成失败:', err);
  }

  return ['按主要维度统计汇总', '找出异常值', '分析时间趋势'];
}

// 生成解释
async function generateExplanation(
  question: string,
  data: Record<string, unknown>[] | string,
  sqlExplanation?: string
): Promise<string> {
  const llm = new LLMService();
  
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data.slice(0, 10));
  
  const prompt = `你是一个数据分析专家。根据用户问题和查询结果，生成简洁的分析解释。

用户问题: ${question}
${sqlExplanation ? `SQL 说明: ${sqlExplanation}` : ''}
查询结果: ${dataStr}

要求：
1. 解释要简洁明了（2-3 句话）
2. 突出关键发现
3. 提供业务洞察
4. 使用中文

请返回解释文本：`;

  try {
    const response = await llm.chat({
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content || '查询完成';
  } catch (err) {
    logger.error('[Excel Explanation] 生成失败:', err);
    return '查询完成';
  }
}

// 自动生成透视表
async function generatePivots(
  profileId: string,
  sheets: Array<{
    sheetName: string;
    rowCount: number;
    columns: Array<{ name: string; type: string; uniqueCount: number }>;
    duckdbTable: string;
  }>,
  documentId: string,
  dbPath: string
) {
  const sheet = sheets[0]!;
  const tableName = sheet.duckdbTable;
  const conn = await getDuckDBService().getConnection(dbPath);

  const categoricalCols = sheet.columns.filter(c => c.type === 'string' && c.uniqueCount <= 20);
  const numericCols = sheet.columns.filter(c => c.type === 'number');
  const dateCol = sheet.columns.find(c => c.type === 'date');

  const pivots: Array<{
    pivotId: string;
    name: string;
    rowCount: number;
    rows: Record<string, unknown>[];
    visualization: Record<string, unknown>;
    sql: string;
  }> = [];

  if (categoricalCols.length > 0 && numericCols.length > 0) {
    const mainCategory = categoricalCols[0]!.name;
    const mainValue = numericCols.find(c => 
      c.name.includes('金额') || c.name.includes('销售额') || c.name.includes('数量')
    )?.name || numericCols[0]!.name;

    logger.info(`[Excel Pivot] 生成 ${mainCategory} 汇总...`);
    
    // 使用 CAST 进行类型转换
    const pivot1Sql = `SELECT "${mainCategory}", SUM(CAST("${mainValue}" AS DOUBLE)) as "总计", COUNT(*) as "记录数" FROM "${tableName}" GROUP BY "${mainCategory}" ORDER BY "总计" DESC`;
    const pivot1Result = await getDuckDBService().executeQuery(conn, pivot1Sql);

    const pivotId1 = crypto.randomUUID();
    await db.insert(pivotTables).values({
      id: pivotId1,
      profileId,
      name: `${mainCategory}汇总`,
      config: { rowFields: [mainCategory], valueField: mainValue, aggregation: 'sum' },
      rows: pivot1Result.rows,
      rowCount: pivot1Result.rowCount,
      visualization: {
        chartType: 'bar',
        categories: pivot1Result.rows.map(r => String(r[mainCategory])),
        series: [{ name: mainValue, data: pivot1Result.rows.map(r => Number(r['总计'])) }],
      },
      sql: pivot1Sql,
      sourceSheets: [`${documentId}:${sheet.sheetName}`],
    });

    pivots.push({
      pivotId: pivotId1,
      name: `${mainCategory}汇总`,
      rowCount: pivot1Result.rowCount,
      rows: pivot1Result.rows,
      visualization: {
        chartType: 'bar',
        categories: pivot1Result.rows.map(r => String(r[mainCategory])),
        series: [{ name: mainValue, data: pivot1Result.rows.map(r => Number(r['总计'])) }],
      },
      sql: pivot1Sql,
    });

    if (categoricalCols.length > 1) {
      const secondCategory = categoricalCols[1]!.name;
      logger.info(`[Excel Pivot] 生成 ${mainCategory}×${secondCategory} 交叉分析...`);
      const pivot2Sql = `SELECT "${mainCategory}", "${secondCategory}", SUM(CAST("${mainValue}" AS DOUBLE)) as "总计" FROM "${tableName}" GROUP BY "${mainCategory}", "${secondCategory}" ORDER BY "${mainCategory}", "总计" DESC`;
      const pivot2Result = await getDuckDBService().executeQuery(conn, pivot2Sql);

      const pivotId2 = crypto.randomUUID();
      await db.insert(pivotTables).values({
        id: pivotId2,
        profileId,
        name: `${mainCategory}×${secondCategory}`,
        config: { rowFields: [mainCategory], columnFields: [secondCategory], valueField: mainValue, aggregation: 'sum' },
        rows: pivot2Result.rows,
        rowCount: pivot2Result.rowCount,
        visualization: {
          chartType: 'heatmap',
          heatmapData: pivot2Result.rows.map(r => ({
            x: String(r[mainCategory]),
            y: String(r[secondCategory]),
            value: Number(r['总计']),
          })),
        },
        sql: pivot2Sql,
        sourceSheets: [`${documentId}:${sheet.sheetName}`],
      });

      pivots.push({
        pivotId: pivotId2,
        name: `${mainCategory}×${secondCategory}`,
        rowCount: pivot2Result.rowCount,
        rows: pivot2Result.rows,
        visualization: {
          chartType: 'heatmap',
          heatmapData: pivot2Result.rows.map(r => ({
            x: String(r[mainCategory]),
            y: String(r[secondCategory]),
            value: Number(r['总计']),
          })),
        },
        sql: pivot2Sql,
      });
    }

    if (dateCol) {
      logger.info(`[Excel Pivot] 生成时间趋势...`);
      const trendSql = `SELECT CAST("${dateCol.name}" AS DATE) as "时间", COUNT(*) as "记录数", SUM(CAST("${mainValue}" AS DOUBLE)) as "总计" FROM "${tableName}" GROUP BY "时间" ORDER BY "时间" LIMIT 30`;
      const trendResult = await getDuckDBService().executeQuery(conn, trendSql);

      const pivotId3 = crypto.randomUUID();
      await db.insert(pivotTables).values({
        id: pivotId3,
        profileId,
        name: '时间趋势',
        config: { rowFields: [dateCol.name], valueField: mainValue, aggregation: 'sum' },
        rows: trendResult.rows,
        rowCount: trendResult.rowCount,
        visualization: {
          chartType: 'line',
          categories: trendResult.rows.map(r => String(r['时间'])),
          series: [{ name: mainValue, data: trendResult.rows.map(r => Number(r['总计'])) }],
        },
        sql: trendSql,
        sourceSheets: [`${documentId}:${sheet.sheetName}`],
      });

      pivots.push({
        pivotId: pivotId3,
        name: '时间趋势',
        rowCount: trendResult.rowCount,
        rows: trendResult.rows,
        visualization: {
          chartType: 'line',
          categories: trendResult.rows.map(r => String(r['时间'])),
          series: [{ name: mainValue, data: trendResult.rows.map(r => Number(r['总计'])) }],
        },
        sql: trendSql,
      });
    }
  }

  return pivots;
}

// 生成分析报告
async function generateReport(
  profileId: string,
  fileName: string,
  sheets: Array<{
    sheetName: string;
    rowCount: number;
    columns: Array<{ name: string; type: string }>;
  }>,
  pivots: Array<{ name: string; rowCount: number }>
) {
  const sheet = sheets[0]!;
  const columns = sheet.columns;
  
  const prompt = `你是一个数据分析专家。请根据以下 Excel 数据信息，生成一份专业的数据分析报告。

文件信息：
- 文件名：${fileName}
- 总行数：${sheet.rowCount}
- 列信息：${columns.map(c => `${c.name}(${c.type})`).join(', ')}

已生成的透视表：
${pivots.map(p => `- ${p.name}: ${p.rowCount} 行`).join('\n')}

请生成一份包含以下内容的分析报告（使用 Markdown 格式）：

## 一、数据概览
简要描述数据的基本情况

## 二、数据结构分析
分析各列的数据特征

## 三、关键发现
基于透视表结果，总结 3-5 个关键发现

## 四、业务洞察
从业务角度解读数据，给出有价值的洞察

## 五、建议
基于分析结果，给出 2-3 条可操作的建议

请确保报告专业、简洁、有洞察力。`;

  logger.info(`[Excel Report] 调用 LLM 生成分析报告...`);
  
  const { LLMService } = await import('../llm/llm-service');
  const llm = new LLMService();
  
  const llmResponse = await llm.chat({
    messages: [{
      role: 'user',
      content: prompt,
    }],
  });

  const content = llmResponse.content || '报告生成失败';

  const reportId = crypto.randomUUID();
  await db.insert(excelReports).values({
    id: reportId,
    profileId,
    title: `${fileName} 分析报告`,
    format: 'markdown',
    content,
    pivotTableIds: pivots.map(p => p.pivotId),
    insights: ['自动分析完成'],
  });

  return {
    reportId,
    content,
  };
}

export default app;
