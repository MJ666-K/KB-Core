import { Hono } from 'hono';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { ExcelParser } from '../parser/excel-parser';
import { getDuckDBService } from '../analyze/duckdb-service';
import { db } from '../db/client';
import { excelProfiles, pivotTables, excelReports } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { LLMService } from '../llm/llm-service';

const app = new Hono();
const UPLOAD_DIR = './data/excel-uploads';
const DUCKDB_DIR = './data/duckdb';

if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

const llm = new LLMService();

type ProfileSheet = {
  sheetName: string;
  rowCount: number;
  documentId?: string;
  columns: Array<{ name: string; type: string; uniqueCount?: number }>;
  duckdbTable: string;
  sampleData?: Record<string, unknown>[];
};

async function clearAnalysisArtifacts(profileId: string): Promise<void> {
  await db.delete(pivotTables).where(eq(pivotTables.profileId, profileId));
  await db.delete(excelReports).where(eq(excelReports.profileId, profileId));
}

async function removeDuckDbForDocuments(documentIds: string[]): Promise<void> {
  const duckdb = getDuckDBService();
  for (const docId of documentIds) {
    const dbPath = `excel_${docId.replace(/-/g, '')}.duckdb`;
    await duckdb.close(dbPath);
    const fullPath = join(DUCKDB_DIR, dbPath);
    if (existsSync(fullPath)) unlinkSync(fullPath);
  }
}

async function getProfileOr404(profileId: string) {
  const profile = await db.query.excelProfiles.findFirst({
    where: eq(excelProfiles.id, profileId),
  });
  return profile ?? null;
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
    console.error('[Excel] 获取列表失败:', err);
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
    console.log(`[Excel] 开始上传: ${fileName}`);
    
    const filePath = join(UPLOAD_DIR, `${Date.now()}-${fileName}`);
    const buffer = await file.arrayBuffer();
    await Bun.write(filePath, buffer);

    console.log(`[Excel] 文件已保存: ${filePath}`);

    // 解析 Excel
    console.log(`[Excel] 步骤 1: 解析 Excel 文件...`);
    const duckdb = getDuckDBService();
    await duckdb.init();
    const parser = new ExcelParser(duckdb);
    const documentId = crypto.randomUUID();
    const dbPath = `excel_${documentId.replace(/-/g, '')}.duckdb`;

    const result = await parser.parse(filePath, documentId, fileName, dbPath);
    console.log(`[Excel] 解析完成: ${result.totalRows} 行, ${result.sheets.length} 个 Sheet`);

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
    console.log(`[Excel] 步骤 2: Profile 已保存: ${profileId}`);

    // 自动生成透视表
    console.log(`[Excel] 步骤 3: 自动生成透视表...`);
    const pivots = await generatePivots(profileId, result.sheets, documentId, dbPath);
    console.log(`[Excel] 透视表生成完成: ${pivots.length} 个`);

    // 自动生成分析报告
    console.log(`[Excel] 步骤 4: 生成分析报告...`);
    const report = await generateReport(profileId, fileName, result.sheets, pivots);
    console.log(`[Excel] 分析报告生成完成`);

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
    console.error('[Excel] 上传失败:', err);
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
    console.error('[Excel] 获取结果失败:', err);
    return c.json({ error: '获取结果失败', success: false }, 500);
  }
});

// 数据预览
app.get('/preview/:id', async (c) => {
  try {
    const profileId = c.req.param('id');
    const limit = Math.min(Math.max(Number(c.req.query('limit') || '100'), 1), 500);
    const offset = Math.max(Number(c.req.query('offset') || '0'), 0);
    const sheetIndex = Math.max(Number(c.req.query('sheet') || '0'), 0);

    const profile = await db.query.excelProfiles.findFirst({
      where: eq(excelProfiles.id, profileId),
    });

    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    const sheets = profile.sheets as Array<{
      duckdbTable: string;
      documentId?: string;
      rowCount?: number;
      sampleData?: Record<string, unknown>[];
    }>;
    const sheet = sheets[sheetIndex] ?? sheets[0];
    if (!sheet) {
      return c.json({ success: true, rows: [], rowCount: 0 });
    }

    const documentId = sheet.documentId ?? profile.documentIds[0];
    const sampleFallback = sheet.sampleData ?? [];

    if (!documentId || !sheet.duckdbTable) {
      const rows = sampleFallback.slice(offset, offset + limit);
      return c.json({
        success: true,
        rows,
        rowCount: rows.length,
        totalRows: sheet.rowCount ?? sampleFallback.length,
        fallback: true,
      });
    }

    const dbPath = `excel_${documentId.replace(/-/g, '')}.duckdb`;
    const duckdb = getDuckDBService();
    const conn = await duckdb.getConnection(dbPath);
    const totalRows = sheet.rowCount ?? Number(
      (await duckdb.executeQuery(conn, `SELECT COUNT(*) AS cnt FROM "${sheet.duckdbTable}"`)).rows[0]?.cnt ?? 0,
    );
    const result = await duckdb.executeQuery(
      conn,
      `SELECT * FROM "${sheet.duckdbTable}" LIMIT ${limit} OFFSET ${offset}`,
    );

    return c.json({
      success: true,
      rows: result.rows,
      rowCount: result.rowCount,
      totalRows,
      offset,
      limit,
    });
  } catch (err) {
    console.error('[Excel] 预览失败:', err);
    try {
      const profileId = c.req.param('id');
      const sheetIndex = Math.max(Number(c.req.query('sheet') || '0'), 0);
      const profile = await db.query.excelProfiles.findFirst({
        where: eq(excelProfiles.id, profileId),
      });
      const sheets = profile?.sheets as Array<{ sampleData?: Record<string, unknown>[] }> | undefined;
      const sampleFallback = sheets?.[sheetIndex]?.sampleData ?? sheets?.[0]?.sampleData ?? [];
      const sheetMeta = sheets?.[sheetIndex] ?? sheets?.[0];
      if (sampleFallback.length > 0) {
        const limit = Math.min(Math.max(Number(c.req.query('limit') || '100'), 1), 500);
        const offset = Math.max(Number(c.req.query('offset') || '0'), 0);
        const rows = sampleFallback.slice(offset, offset + limit);
        return c.json({
          success: true,
          rows,
          rowCount: rows.length,
          totalRows: sheetMeta?.rowCount ?? sampleFallback.length,
          fallback: true,
        });
      }
    } catch {
      // ignore secondary failure
    }
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : '预览失败',
      rows: [],
      rowCount: 0,
    }, 500);
  }
});

// 重命名工作簿显示名
app.patch('/:id', async (c) => {
  try {
    const profileId = c.req.param('id');
    const body = await c.req.json() as { fileName?: string };
    const fileName = body.fileName?.trim();
    if (!fileName) {
      return c.json({ success: false, error: '文件名不能为空' }, 400);
    }
    const profile = await getProfileOr404(profileId);
    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }
    await db.update(excelProfiles)
      .set({ fileNames: [fileName] })
      .where(eq(excelProfiles.id, profileId));
    return c.json({ success: true, fileName });
  } catch (err) {
    console.error('[Excel] 重命名失败:', err);
    return c.json({ success: false, error: '重命名失败' }, 500);
  }
});

// 删除工作簿及分析数据
app.delete('/:id', async (c) => {
  try {
    const profileId = c.req.param('id');
    const profile = await getProfileOr404(profileId);
    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }
    await clearAnalysisArtifacts(profileId);
    await db.delete(excelProfiles).where(eq(excelProfiles.id, profileId));
    await removeDuckDbForDocuments(profile.documentIds);
    return c.json({ success: true });
  } catch (err) {
    console.error('[Excel] 删除失败:', err);
    return c.json({ success: false, error: '删除失败' }, 500);
  }
});

// 基于现有数据重新生成透视表与报告
app.post('/:id/reanalyze', async (c) => {
  try {
    const profileId = c.req.param('id');
    const profile = await getProfileOr404(profileId);
    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }
    const sheets = profile.sheets as ProfileSheet[];
    const sheet = sheets[0];
    if (!sheet) {
      return c.json({ success: false, error: '无可用工作表' }, 400);
    }
    const documentId = sheet.documentId ?? profile.documentIds[0];
    if (!documentId) {
      return c.json({ success: false, error: '数据文件不存在' }, 400);
    }
    const dbPath = `excel_${documentId.replace(/-/g, '')}.duckdb`;
    await clearAnalysisArtifacts(profileId);
    const pivots = await generatePivots(profileId, sheets, documentId, dbPath);
    const report = await generateReport(profileId, profile.fileNames[0] ?? '工作簿', sheets, pivots);
    return c.json({ success: true, pivots, report });
  } catch (err) {
    console.error('[Excel] 重新分析失败:', err);
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : '重新分析失败',
    }, 500);
  }
});

// 替换工作簿文件并重新分析
app.post('/:id/replace', async (c) => {
  try {
    const profileId = c.req.param('id');
    const profile = await getProfileOr404(profileId);
    if (!profile) {
      return c.json({ success: false, error: 'Profile not found' }, 404);
    }

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: '请上传文件' }, 400);
    }

    const fileName = file.name;
    const filePath = join(UPLOAD_DIR, `${Date.now()}-${fileName}`);
    const buffer = await file.arrayBuffer();
    await Bun.write(filePath, buffer);

    await removeDuckDbForDocuments(profile.documentIds);

    const duckdb = getDuckDBService();
    await duckdb.init();
    const parser = new ExcelParser(duckdb);
    const documentId = crypto.randomUUID();
    const dbPath = `excel_${documentId.replace(/-/g, '')}.duckdb`;
    const result = await parser.parse(filePath, documentId, fileName, dbPath);

    await clearAnalysisArtifacts(profileId);
    await db.update(excelProfiles)
      .set({
        documentIds: [documentId],
        fileNames: [fileName],
        fileCount: 1,
        sheets: result.sheets,
        merged: false,
        mergedDuckdbTable: null,
      })
      .where(eq(excelProfiles.id, profileId));

    const pivots = await generatePivots(profileId, result.sheets, documentId, dbPath);
    const report = await generateReport(profileId, fileName, result.sheets, pivots);

    return c.json({
      success: true,
      fileName,
      totalRows: result.totalRows,
      sheets: result.sheets,
      pivots,
      report,
    });
  } catch (err) {
    console.error('[Excel] 替换文件失败:', err);
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : '替换文件失败',
    }, 500);
  }
});

// 自然语言查询（追问）
app.post('/query', async (c) => {
  try {
    const { profileId, question } = await c.req.json();
    
    if (!profileId || !question) {
      return c.json({ error: '缺少参数' }, 400);
    }

    console.log(`[Excel Query] 问题: ${question}`);

    const profile = await db.query.excelProfiles.findFirst({
      where: eq(excelProfiles.id, profileId),
    });

    if (!profile) {
      return c.json({ error: 'Profile not found' }, 404);
    }

    const sheets = profile.sheets as Array<{ 
      duckdbTable: string; 
      documentId?: string;
      columns: Array<{ name: string; type: string }>;
    }>;
    
    const sheet = sheets[0];
    if (!sheet) {
      return c.json({ error: '无可用工作表', success: false }, 400);
    }

    const documentId = sheet.documentId ?? profile.documentIds[0];
    if (!documentId) {
      return c.json({ error: '数据文件不存在', success: false }, 400);
    }

    const tableName = sheet.duckdbTable;
    const columns = sheet.columns;
    const dbPath = `excel_${documentId.replace(/-/g, '')}.duckdb`;
    
    const schemaDesc = columns.map(c => `- ${c.name} (${c.type})`).join('\n');
    
    const prompt = `你是一个数据分析助手。用户会提问关于 Excel 数据的问题，你需要：
1. 将自然语言转换为 SQL 查询
2. 返回 SQL 语句

Excel 表结构：
表名: ${tableName}
列信息:
${schemaDesc}

用户问题: ${question}

请只返回 SQL 语句，不要其他解释。SQL 应该是 DuckDB 兼容的。`;

    console.log(`[Excel Query] 调用 LLM 生成 SQL...`);
    const llmResponse = await llm.chat({
      messages: [{
        role: 'user',
        content: prompt,
      }],
    });

    let sql = llmResponse.content || '';
    sql = sql.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim();
    
    console.log(`[Excel Query] 生成的 SQL: ${sql}`);
    
    if (!sql.toLowerCase().startsWith('select')) {
      return c.json({ 
        error: '无法生成有效的查询语句',
        success: false,
      }, 400);
    }

    const duckdb = getDuckDBService();
    const conn = await duckdb.getConnection(dbPath);
    
    console.log(`[Excel Query] 执行 SQL...`);
    const result = await duckdb.executeQuery(conn, sql);
    console.log(`[Excel Query] 查询完成: ${result.rowCount} 行`);

    return c.json({
      success: true,
      sql,
      rows: result.rows,
      rowCount: result.rowCount,
    });

  } catch (err) {
    console.error('[Excel Query] 查询失败:', err);
    return c.json({ 
      error: err instanceof Error ? err.message : '查询失败',
      success: false,
    }, 500);
  }
});

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

    console.log(`[Excel Pivot] 生成 ${mainCategory} 汇总...`);
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
      console.log(`[Excel Pivot] 生成 ${mainCategory}×${secondCategory} 交叉分析...`);
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
      console.log(`[Excel Pivot] 生成时间趋势...`);
      const trendSql = `SELECT "${dateCol.name}" as "时间", COUNT(*) as "记录数", SUM(CAST("${mainValue}" AS DOUBLE)) as "总计" FROM "${tableName}" GROUP BY "${dateCol.name}" ORDER BY "时间" LIMIT 30`;
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

  console.log(`[Excel Report] 调用 LLM 生成分析报告...`);
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
