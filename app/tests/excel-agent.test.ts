/**
 * Excel 智能体端到端测试（独立版，不依赖 PostgreSQL）
 * 
 * 测试：ExcelParser + DuckDBService + 数据分析流水线
 * 使用生成的测试 Excel 文件（资金流水表 12000 行、通信记录表 10000 行、多Sheet测试表）
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { ExcelParser } from '../src/parser/excel-parser';
import { DuckDBService } from '../src/analyze/duckdb-service';
import { existsSync, unlinkSync, readdirSync, rmdirSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');
const FINANCIAL_FILE = join(FIXTURES_DIR, '资金流水表.xlsx');
const COMMUNICATION_FILE = join(FIXTURES_DIR, '通信记录表.xlsx');
const MULTI_SHEET_FILE = join(FIXTURES_DIR, '多Sheet测试表.xlsx');
const DUCKDB_DIR = './data/duckdb';

let duckdb: DuckDBService;
let parser: ExcelParser;

// 清理 DuckDB 临时文件
function cleanupDuckDB(): void {
  if (existsSync(DUCKDB_DIR)) {
    for (const file of readdirSync(DUCKDB_DIR)) {
      try { unlinkSync(join(DUCKDB_DIR, file)); } catch { /* ignore */ }
    }
  }
}

describe('Excel 智能体端到端测试', () => {
  beforeAll(async () => {
    expect(existsSync(FINANCIAL_FILE), '资金流水表.xlsx 不存在').toBe(true);
    expect(existsSync(COMMUNICATION_FILE), '通信记录表.xlsx 不存在').toBe(true);
    expect(existsSync(MULTI_SHEET_FILE), '多Sheet测试表.xlsx 不存在').toBe(true);

    cleanupDuckDB();
    duckdb = new DuckDBService();
    await duckdb.init();
    parser = new ExcelParser(duckdb);
  });

  afterAll(async () => {
    await duckdb.close();
    cleanupDuckDB();
  });

  // ═══════════════════════════════════════════════════════════
  // 1. 数据解析与画像测试
  // ═══════════════════════════════════════════════════════════

  describe('1. 数据解析与画像', () => {
    test('1.1 解析资金流水表（12000 行）', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-financial', '资金流水表.xlsx', 'test_financial.duckdb');

      expect(result.sheets.length).toBe(1);
      expect(result.totalRows).toBe(12000);

      const sheet = result.sheets[0]!;
      expect(sheet.sheetName).toBe('资金流水');
      expect(sheet.rowCount).toBe(12000);
      expect(sheet.columns.length).toBe(15);
      expect(sheet.duckdbTable).toBe('excel_docfinancial_0');

      // 验证样本数据
      expect(sheet.sampleData.length).toBe(10);
      expect(sheet.sampleData[0]).toHaveProperty('流水号');
      expect(sheet.sampleData[0]).toHaveProperty('金额');
      expect(sheet.sampleData[0]).toHaveProperty('区域');
    });

    test('1.2 数值列统计特征完整', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-financial2', '资金流水表.xlsx', 'test_financial2.duckdb');
      const sheet = result.sheets[0]!;

      // 金额列（数值型）
      const amountCol = sheet.columns.find(c => c.name === '金额');
      expect(amountCol, '金额列不存在').toBeDefined();
      expect(amountCol!.type).toBe('number');
      expect(amountCol!.numericStats, '数值统计不存在').toBeDefined();
      expect(amountCol!.numericStats!.min).toBeGreaterThan(0);
      expect(amountCol!.numericStats!.max).toBeGreaterThan(amountCol!.numericStats!.min);
      expect(amountCol!.numericStats!.avg).toBeGreaterThan(0);
      expect(amountCol!.numericStats!.percentiles.P99).toBeGreaterThan(amountCol!.numericStats!.percentiles.P50);

      // Top 10 峰值
      expect(amountCol!.topValues, 'Top 峰值不存在').toBeDefined();
      expect(amountCol!.topValues!.length).toBeGreaterThan(0);
      expect(amountCol!.topValues!.length).toBeLessThanOrEqual(10);
    });

    test('1.3 分类列频次分布完整', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-financial3', '资金流水表.xlsx', 'test_financial3.duckdb');
      const sheet = result.sheets[0]!;

      // 区域列（分类）
      const regionCol = sheet.columns.find(c => c.name === '区域');
      expect(regionCol, '区域列不存在').toBeDefined();
      expect(regionCol!.type).toBe('string');
      expect(regionCol!.frequencyDistribution, '频次分布不存在').toBeDefined();

      const freq = regionCol!.frequencyDistribution!;
      const totalFreq = Object.values(freq).reduce((a, b) => a + b, 0);
      expect(totalFreq).toBe(12000); // 频次总和必须等于总行数

      // 7 个区域
      expect(Object.keys(freq).length).toBe(7);
    });

    test('1.4 日期列时间范围和粒度', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-financial4', '资金流水表.xlsx', 'test_financial4.duckdb');
      const sheet = result.sheets[0]!;

      const dateCol = sheet.columns.find(c => c.name === '日期');
      expect(dateCol, '日期列不存在').toBeDefined();
      expect(dateCol!.type).toBe('date');
      expect(dateCol!.dateRange, '日期范围不存在').toBeDefined();
      expect(dateCol!.dateRange!.min).toContain('2024');
      expect(dateCol!.dateRange!.max).toContain('2024');
      expect(dateCol!.granularity).toBeDefined();
    });

    test('1.5 解析通信记录表（10000 行）', async () => {
      const result = await parser.parse(COMMUNICATION_FILE, 'doc-comm', '通信记录表.xlsx', 'test_comm.duckdb');

      expect(result.totalRows).toBe(10000);
      expect(result.sheets[0]!.columns.length).toBe(14);
    });

    test('1.6 解析多Sheet测试表（3 个 Sheet，格式不同）', async () => {
      const result = await parser.parse(MULTI_SHEET_FILE, 'doc-multi', '多Sheet测试表.xlsx', 'test_multi.duckdb');

      expect(result.sheets.length).toBe(3);
      expect(result.totalRows).toBe(5112); // 5000 + 100 + 12

      const sheetNames = result.sheets.map(s => s.sheetName);
      expect(sheetNames).toContain('销售数据');
      expect(sheetNames).toContain('客户信息');
      expect(sheetNames).toContain('月度目标');

      // 各 Sheet 行数
      const salesSheet = result.sheets.find(s => s.sheetName === '销售数据')!;
      expect(salesSheet.rowCount).toBe(5000);
      expect(salesSheet.columns.length).toBe(6);

      const customerSheet = result.sheets.find(s => s.sheetName === '客户信息')!;
      expect(customerSheet.rowCount).toBe(100);
      expect(customerSheet.columns.length).toBe(7);

      const targetSheet = result.sheets.find(s => s.sheetName === '月度目标')!;
      expect(targetSheet.rowCount).toBe(12);
      expect(targetSheet.columns.length).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 2. 数据完整性验证（不遗漏）
  // ═══════════════════════════════════════════════════════════

  describe('2. 数据完整性（不遗漏）', () => {
    test('2.1 DuckDB 行数与 Excel 完全一致', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-integrity', '资金流水表.xlsx', 'test_integrity.duckdb');
      const conn = await duckdb.getConnection('test_integrity.duckdb');

      const countResult = await duckdb.executeQuery(conn, `SELECT COUNT(*) as cnt FROM "${result.sheets[0]!.duckdbTable}"`);
      const dbCount = Number((countResult.rows[0] as Record<string, unknown>).cnt);

      expect(dbCount).toBe(12000);
      expect(dbCount).toBe(result.totalRows);
    });

    test('2.2 SUM 聚合覆盖所有行', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-sum', '资金流水表.xlsx', 'test_sum.duckdb');
      const conn = await duckdb.getConnection('test_sum.duckdb');

      // DuckDB SUM
      const sumResult = await duckdb.executeQuery(conn,
        `SELECT SUM(CAST("实付金额" AS DOUBLE)) as total FROM "${result.sheets[0]!.duckdbTable}"`
      );
      const dbTotal = Number((sumResult.rows[0] as Record<string, unknown>).total);

      // 用 xlsx 直接计算验证
      const XLSX = await import('xlsx');
      const wb = XLSX.readFile(FINANCIAL_FILE);
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: false });
      const fileTotal = data.reduce((sum, row) => sum + (Number(row['实付金额']) || 0), 0);

      // DuckDB SUM 必须等于文件 SUM（不遗漏）
      expect(Math.abs(dbTotal - fileTotal)).toBeLessThan(0.01);
    });

    test('2.3 多 Sheet 数据完整', async () => {
      const result = await parser.parse(MULTI_SHEET_FILE, 'doc-multi-integrity', '多Sheet测试表.xlsx', 'test_multi_integrity.duckdb');
      const conn = await duckdb.getConnection('test_multi_integrity.duckdb');

      for (const sheet of result.sheets) {
        const countResult = await duckdb.executeQuery(conn, `SELECT COUNT(*) as cnt FROM "${sheet.duckdbTable}"`);
        const dbCount = Number((countResult.rows[0] as Record<string, unknown>).cnt);
        expect(dbCount).toBe(sheet.rowCount);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 3. SQL 探索测试
  // ═══════════════════════════════════════════════════════════

  describe('3. SQL 探索（execute_query）', () => {
    let conn: import('@duckdb/node-api').DuckDBConnection;
    let tableName: string;

    beforeAll(async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-explore', '资金流水表.xlsx', 'test_explore.duckdb');
      conn = await duckdb.getConnection('test_explore.duckdb');
      tableName = result.sheets[0]!.duckdbTable;
    });

    test('3.1 按区域汇总', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "区域", COUNT(*) as 订单数, SUM(CAST("实付金额" AS DOUBLE)) as 总金额
         FROM "${tableName}" GROUP BY "区域" ORDER BY 总金额 DESC`
      );

      expect(result.rowCount).toBe(7); // 7 个区域
      expect(result.rows[0]).toHaveProperty('区域');
      expect(result.rows[0]).toHaveProperty('总金额');

      // 所有区域订单数之和 = 12000
      const totalOrders = result.rows.reduce((sum, r) => sum + Number((r as Record<string, unknown>).订单数), 0);
      expect(totalOrders).toBe(12000);
    });

    test('3.2 异常值检测', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT COUNT(*) as 异常数 FROM "${tableName}" WHERE CAST("实付金额" AS DOUBLE) > 100000`
      );

      const count = Number((result.rows[0] as Record<string, unknown>).异常数);
      expect(count).toBeGreaterThan(0); // 5% 概率生成异常大值
    });

    test('3.3 多维度分组', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "区域", "产品", COUNT(*) as 订单数, SUM(CAST("实付金额" AS DOUBLE)) as 总金额
         FROM "${tableName}" GROUP BY "区域", "产品" ORDER BY 总金额 DESC`
      );

      expect(result.rowCount).toBeGreaterThan(0);
      // 区域×产品 = 7×5 = 35 种组合
      expect(result.rowCount).toBeLessThanOrEqual(35);
    });

    test('3.4 时间趋势', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "日期", COUNT(*) as 订单数, SUM(CAST("实付金额" AS DOUBLE)) as 日销售额
         FROM "${tableName}" GROUP BY "日期" ORDER BY "日期" LIMIT 30`
      );

      expect(result.rowCount).toBeGreaterThan(0);
      expect(result.rowCount).toBeLessThanOrEqual(30);
    });

    test('3.5 分位数查询', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST("实付金额" AS DOUBLE)) as p50,
           PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY CAST("实付金额" AS DOUBLE)) as p90,
           PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY CAST("实付金额" AS DOUBLE)) as p99
         FROM "${tableName}"`
      );

      const row = result.rows[0] as Record<string, number>;
      expect(row.p50).toBeGreaterThan(0);
      expect(row.p90).toBeGreaterThan(row.p50);
      expect(row.p99).toBeGreaterThan(row.p90);
    });

    test('3.6 安全校验（禁止非 SELECT）', async () => {
      expect(duckdb.executeQuery(conn, 'DROP TABLE test')).rejects.toThrow('只允许 SELECT');
      expect(duckdb.executeQuery(conn, 'DELETE FROM test')).rejects.toThrow('只允许 SELECT');
      expect(duckdb.executeQuery(conn, 'INSERT INTO test VALUES (1)')).rejects.toThrow('只允许 SELECT');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 4. 透视表生成测试
  // ═══════════════════════════════════════════════════════════

  describe('4. 透视表生成', () => {
    let conn: import('@duckdb/node-api').DuckDBConnection;
    let tableName: string;

    beforeAll(async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-pivot', '资金流水表.xlsx', 'test_pivot.duckdb');
      conn = await duckdb.getConnection('test_pivot.duckdb');
      tableName = result.sheets[0]!.duckdbTable;
    });

    test('4.1 2D 简单透视表', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "区域", SUM(CAST("实付金额" AS DOUBLE)) as 总销售额, COUNT(*) as 订单数
         FROM "${tableName}" GROUP BY "区域" ORDER BY 总销售额 DESC`
      );

      expect(result.rowCount).toBe(7);
      expect(result.rows[0]).toHaveProperty('总销售额');
    });

    test('4.2 交叉表（区域×产品）', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "区域", "产品", SUM(CAST("实付金额" AS DOUBLE)) as 总金额
         FROM "${tableName}" GROUP BY "区域", "产品" ORDER BY "区域", 总金额 DESC`
      );

      expect(result.rowCount).toBeGreaterThan(0);
    });

    test('4.3 3D 透视表（产品×区域×渠道）', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "产品", "区域", "渠道", SUM(CAST("实付金额" AS DOUBLE)) as 总金额
         FROM "${tableName}"
         GROUP BY "产品", "区域", "渠道"
         ORDER BY "产品", "区域", 总金额 DESC`
      );

      expect(result.rowCount).toBeGreaterThan(0);
      // 产品(5) × 区域(7) × 渠道(4) = 最多 140 种组合
      expect(result.rowCount).toBeLessThanOrEqual(140);
    });

    test('4.4 带过滤条件的透视表', async () => {
      const result = await duckdb.executeQuery(conn,
        `SELECT "区域", SUM(CAST("实付金额" AS DOUBLE)) as 总金额
         FROM "${tableName}"
         WHERE "状态" = '已完成'
         GROUP BY "区域" ORDER BY 总金额 DESC`
      );

      expect(result.rowCount).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 5. 多Sheet跨表关联测试
  // ═══════════════════════════════════════════════════════════

  describe('5. 多Sheet跨表关联', () => {
    test('5.1 跨 Sheet JOIN', async () => {
      const result = await parser.parse(MULTI_SHEET_FILE, 'doc-join', '多Sheet测试表.xlsx', 'test_join.duckdb');
      const conn = await duckdb.getConnection('test_join.duckdb');

      const salesTable = result.sheets.find(s => s.sheetName === '销售数据')!.duckdbTable;
      const customerTable = result.sheets.find(s => s.sheetName === '客户信息')!.duckdbTable;

      const joinResult = await duckdb.executeQuery(conn,
        `SELECT c."行业", SUM(CAST(s."金额" AS DOUBLE)) as 总销售额
         FROM "${salesTable}" s
         JOIN "${customerTable}" c ON s."客户ID" = c."客户ID"
         GROUP BY c."行业"
         ORDER BY 总销售额 DESC`
      );

      expect(joinResult.rowCount).toBeGreaterThan(0);
      expect(joinResult.rows[0]).toHaveProperty('行业');
      expect(joinResult.rows[0]).toHaveProperty('总销售额');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 6. 性能测试
  // ═══════════════════════════════════════════════════════════

  describe('6. 性能', () => {
    test('6.1 12000 行多维聚合 < 2s', async () => {
      const result = await parser.parse(FINANCIAL_FILE, 'doc-perf', '资金流水表.xlsx', 'test_perf.duckdb');
      const conn = await duckdb.getConnection('test_perf.duckdb');
      const tableName = result.sheets[0]!.duckdbTable;

      const start = Date.now();
      await duckdb.executeQuery(conn,
        `SELECT "区域", "产品", "渠道",
                COUNT(*) as 订单数,
                SUM(CAST("实付金额" AS DOUBLE)) as 总金额,
                AVG(CAST("实付金额" AS DOUBLE)) as 平均金额
         FROM "${tableName}"
         GROUP BY "区域", "产品", "渠道"
         ORDER BY 总金额 DESC`
      );
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
    });

    test('6.2 解析 12000 行 Excel < 10s', async () => {
      const start = Date.now();
      await parser.parse(FINANCIAL_FILE, 'doc-parse-perf', '资金流水表.xlsx', 'test_parse_perf.duckdb');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10000);
    });
  });
});
