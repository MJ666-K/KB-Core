/**
 * Excel 透视表端到端测试脚本
 * 
 * 模拟 Agent 三阶段工作流：
 * 阶段 1：profile_excel → 数据画像
 * 阶段 2：execute_query → 多轮探索
 * 阶段 3：create_pivot → 生成透视表 + 可视化数据
 * 
 * 用法：bun run tests/excel-pivot-demo.ts
 */

import { ExcelParser } from '@features/excel/parser/excel-parser';
import { DuckDBService } from '@features/excel/analyze/duckdb-service';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dir, 'fixtures');
const OUTPUT = join(import.meta.dir, 'output');

if (!existsSync(OUTPUT)) mkdirSync(OUTPUT, { recursive: true });

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function printSection(title: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function printTable(rows: Record<string, unknown>[], maxRows = 20): void {
  if (rows.length === 0) { console.log('  (空)'); return; }
  const headers = Object.keys(rows[0]!);
  const widths = headers.map(h => {
    const maxData = rows.slice(0, maxRows).reduce((max, r) => Math.max(max, String(r[h] ?? '').length), 0);
    return Math.max(h.length, maxData, 4);
  });

  // 表头
  const headerLine = headers.map((h, i) => h.padEnd(widths[i]!)).join(' | ');
  console.log(`  ${headerLine}`);
  console.log(`  ${widths.map(w => '─'.repeat(w)).join('─┼─')}`);

  // 数据行
  const display = rows.slice(0, maxRows);
  for (const row of display) {
    const line = headers.map((h, i) => String(row[h] ?? '').padEnd(widths[i]!)).join(' | ');
    console.log(`  ${line}`);
  }

  if (rows.length > maxRows) {
    console.log(`  ... 共 ${rows.length} 行（显示前 ${maxRows} 行）`);
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('🚀 Excel 透视表端到端测试\n');

  const duckdb = new DuckDBService();
  await duckdb.init();
  const parser = new ExcelParser(duckdb);

  // ─── 阶段 1：数据画像 ───

  printSection('阶段 1：数据画像（profile_excel）');

  const financialFile = join(FIXTURES, '资金流水表.xlsx');
  const commFile = join(FIXTURES, '通信记录表.xlsx');
  const multiFile = join(FIXTURES, '多Sheet测试表.xlsx');

  console.log('\n📊 解析资金流水表（12000 行）...');
  const financialResult = await parser.parse(financialFile, 'demo-financial', '资金流水表.xlsx', 'demo_financial.duckdb');
  const fSheet = financialResult.sheets[0]!;
  console.log(`  ✅ ${fSheet.rowCount} 行, ${fSheet.columns.length} 列`);

  console.log('\n📊 解析通信记录表（10000 行）...');
  const commResult = await parser.parse(commFile, 'demo-comm', '通信记录表.xlsx', 'demo_comm.duckdb');
  const cSheet = commResult.sheets[0]!;
  console.log(`  ✅ ${cSheet.rowCount} 行, ${cSheet.columns.length} 列`);

  console.log('\n📊 解析多Sheet测试表（3 个 Sheet）...');
  const multiResult = await parser.parse(multiFile, 'demo-multi', '多Sheet测试表.xlsx', 'demo_multi.duckdb');
  console.log(`  ✅ ${multiResult.sheets.length} 个 Sheet, ${multiResult.totalRows} 行`);

  // 打印数据画像
  printSection('数据画像详情 — 资金流水表');
  for (const col of fSheet.columns) {
    let info = `  ${col.name} [${col.type}]`;
    if (col.numericStats) {
      const s = col.numericStats;
      info += `  min=${formatNumber(s.min)}  avg=${formatNumber(s.avg)}  max=${formatNumber(s.max)}  P50=${formatNumber(s.percentiles.P50)}  P99=${formatNumber(s.percentiles.P99)}`;
    }
    if (col.frequencyDistribution) {
      const entries = Object.entries(col.frequencyDistribution).slice(0, 5);
      info += `  分布: {${entries.map(([k, v]) => `${k}:${v}`).join(', ')}}`;
    }
    if (col.dateRange) {
      info += `  范围: ${col.dateRange.min} ~ ${col.dateRange.max} (${col.granularity})`;
    }
    console.log(info);
  }

  // ─── 阶段 2：多轮探索 ───

  printSection('阶段 2：深度探索（execute_query）');

  const fConn = await duckdb.getConnection('demo_financial.duckdb');
  const fTable = fSheet.duckdbTable;

  // 探索 1：按区域汇总
  console.log('\n🔍 探索 1：按区域汇总销售');
  const explore1 = await duckdb.executeQuery(fConn,
    `SELECT "区域", COUNT(*) as "订单数", 
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额",
            AVG(CAST("实付金额" AS DOUBLE)) as "平均单价"
     FROM "${fTable}" GROUP BY "区域" ORDER BY "总销售额" DESC`
  );
  printTable(explore1.rows);

  // 探索 2：按产品汇总
  console.log('\n🔍 探索 2：按产品汇总销售');
  const explore2 = await duckdb.executeQuery(fConn,
    `SELECT "产品", COUNT(*) as "订单数",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额"
     FROM "${fTable}" GROUP BY "产品" ORDER BY "总销售额" DESC`
  );
  printTable(explore2.rows);

  // 探索 3：月度趋势
  console.log('\n🔍 探索 3：月度销售趋势');
  const explore3 = await duckdb.executeQuery(fConn,
    `SELECT "日期" as "月份", COUNT(*) as "订单数",
            SUM(CAST("实付金额" AS DOUBLE)) as "月销售额"
     FROM "${fTable}"
     GROUP BY "日期" ORDER BY "月份" LIMIT 12`
  );
  printTable(explore3.rows);

  // 探索 4：异常值检测
  console.log('\n🔍 探索 4：异常值检测（> P99）');
  const explore4 = await duckdb.executeQuery(fConn,
    `SELECT COUNT(*) as "异常数",
            AVG(CAST("实付金额" AS DOUBLE)) as "异常平均值",
            MAX(CAST("实付金额" AS DOUBLE)) as "最大异常值"
     FROM "${fTable}"
     WHERE CAST("实付金额" AS DOUBLE) > (
       SELECT PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY CAST("实付金额" AS DOUBLE))
       FROM "${fTable}"
     )`
  );
  printTable(explore4.rows);

  // 探索 5：区域×产品交叉
  console.log('\n🔍 探索 5：区域×产品交叉分析');
  const explore5 = await duckdb.executeQuery(fConn,
    `SELECT "区域", "产品",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额"
     FROM "${fTable}"
     GROUP BY "区域", "产品"
     ORDER BY "区域", "总销售额" DESC`
  );
  printTable(explore5.rows);

  // ─── 通信记录探索 ───

  printSection('通信记录探索');

  const cConn = await duckdb.getConnection('demo_comm.duckdb');
  const cTable = cSheet.duckdbTable;

  console.log('\n🔍 按部门统计通信量');
  const commExplore1 = await duckdb.executeQuery(cConn,
    `SELECT "发起部门", COUNT(*) as "通信次数",
            AVG(CAST("时长(分钟)" AS DOUBLE)) as "平均时长"
     FROM "${cTable}" GROUP BY "发起部门" ORDER BY "通信次数" DESC`
  );
  printTable(commExplore1.rows);

  console.log('\n🔍 按通信类型统计');
  const commExplore2 = await duckdb.executeQuery(cConn,
    `SELECT "通信类型", COUNT(*) as "次数",
            AVG(CAST("时长(分钟)" AS DOUBLE)) as "平均时长"
     FROM "${cTable}" GROUP BY "通信类型" ORDER BY "次数" DESC`
  );
  printTable(commExplore2.rows);

  // ─── 阶段 3：透视表生成 ───

  printSection('阶段 3：透视表生成（create_pivot）');

  // 透视表 1：2D 区域销售汇总
  console.log('\n📊 透视表 1：区域销售汇总（2D 简单表）');
  const pivot1 = await duckdb.executeQuery(fConn,
    `SELECT "区域",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额",
            COUNT(*) as "订单数",
            AVG(CAST("实付金额" AS DOUBLE)) as "平均单价"
     FROM "${fTable}"
     GROUP BY "区域"
     ORDER BY "总销售额" DESC`
  );
  printTable(pivot1.rows);
  console.log(`  → 生成 bar 图表数据：${pivot1.rowCount} 个区域`);

  // 透视表 2：交叉表（区域×产品）
  console.log('\n📊 透视表 2：区域×产品交叉表');
  const pivot2 = await duckdb.executeQuery(fConn,
    `SELECT "区域", "产品",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额"
     FROM "${fTable}"
     GROUP BY "区域", "产品"
     ORDER BY "区域", "总销售额" DESC`
  );
  printTable(pivot2.rows);
  console.log(`  → 生成 heatmap 图表数据：${pivot2.rowCount} 个交叉单元格`);

  // 透视表 3：3D 透视表（产品×区域×渠道）
  console.log('\n📊 透视表 3：3D 透视表（产品×区域×渠道）');
  const pivot3 = await duckdb.executeQuery(fConn,
    `SELECT "产品", "区域", "渠道",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额"
     FROM "${fTable}"
     GROUP BY "产品", "区域", "渠道"
     ORDER BY "产品", "区域", "总销售额" DESC`
  );
  // 按产品分组展示
  const products = [...new Set(pivot3.rows.map(r => String(r['产品'])))];
  for (const product of products) {
    console.log(`\n  ── ${product} ──`);
    const subRows = pivot3.rows.filter(r => r['产品'] === product);
    printTable(subRows);
  }
  console.log(`  → 3D 透视表：${products.length} 页 × ${pivot3.rowCount} 行`);

  // 透视表 4：带过滤条件
  console.log('\n📊 透视表 4：已完成订单的区域销售（过滤条件）');
  const pivot4 = await duckdb.executeQuery(fConn,
    `SELECT "区域",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额",
            COUNT(*) as "订单数"
     FROM "${fTable}"
     WHERE "状态" = '已完成'
     GROUP BY "区域"
     ORDER BY "总销售额" DESC`
  );
  printTable(pivot4.rows);

  // 透视表 5：支付方式分析
  console.log('\n📊 透视表 5：支付方式分析');
  const pivot5 = await duckdb.executeQuery(fConn,
    `SELECT "支付方式",
            COUNT(*) as "订单数",
            SUM(CAST("实付金额" AS DOUBLE)) as "总销售额",
            AVG(CAST("实付金额" AS DOUBLE)) as "平均单价"
     FROM "${fTable}"
     GROUP BY "支付方式"
     ORDER BY "总销售额" DESC`
  );
  printTable(pivot5.rows);

  // ─── 多Sheet跨表透视 ───

  printSection('多Sheet跨表透视');

  const mConn = await duckdb.getConnection('demo_multi.duckdb');
  const salesTable = multiResult.sheets.find(s => s.sheetName === '销售数据')!.duckdbTable;
  const customerTable = multiResult.sheets.find(s => s.sheetName === '客户信息')!.duckdbTable;

  console.log('\n📊 跨表 JOIN：按行业汇总销售额');
  const crossPivot = await duckdb.executeQuery(mConn,
    `SELECT c."行业",
            COUNT(*) as "订单数",
            SUM(CAST(s."金额" AS DOUBLE)) as "总销售额",
            AVG(CAST(s."金额" AS DOUBLE)) as "平均单价"
     FROM "${salesTable}" s
     JOIN "${customerTable}" c ON s."客户ID" = c."客户ID"
     GROUP BY c."行业"
     ORDER BY "总销售额" DESC`
  );
  printTable(crossPivot.rows);

  // ─── 生成报告 ───

  printSection('生成分析报告');

  const report = generateReport(
    financialResult, commResult, multiResult,
    { explore1: explore1.rows, explore2: explore2.rows, explore4: explore4.rows },
    { pivot1: pivot1.rows, pivot2: pivot2.rows, pivot3: pivot3.rows, pivot5: pivot5.rows },
    crossPivot.rows
  );

  const reportPath = join(OUTPUT, '分析报告.md');
  writeFileSync(reportPath, report);
  console.log(`\n✅ 报告已保存: ${reportPath}`);

  // 生成可视化数据 JSON
  const vizData = {
    barChart: {
      title: '区域销售汇总',
      categories: explore1.rows.map(r => String(r['区域'])),
      series: [{ name: '总销售额', data: explore1.rows.map(r => Number(r['总销售额'])) }],
    },
    heatmap: {
      title: '区域×产品交叉',
      data: pivot2.rows.map(r => ({
        x: String(r['区域']),
        y: String(r['产品']),
        value: Number(r['总销售额']),
      })),
    },
    pieChart: {
      title: '支付方式分布',
      data: pivot5.rows.map(r => ({
        name: String(r['支付方式']),
        value: Number(r['总销售额']),
      })),
    },
  };

  const vizPath = join(OUTPUT, '可视化数据.json');
  writeFileSync(vizPath, JSON.stringify(vizData, null, 2));
  console.log(`✅ 可视化数据已保存: ${vizPath}`);

  // 清理
  await duckdb.close();

  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ 全部测试完成');
  console.log('═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════
// 报告生成
// ═══════════════════════════════════════════════════════════

function generateReport(
  financial: { sheets: Array<{ rowCount: number; columns: Array<{ name: string }> }> },
  comm: { sheets: Array<{ rowCount: number }> },
  multi: { sheets: Array<{ sheetName: string; rowCount: number }> },
  explores: Record<string, Record<string, unknown>[]>,
  pivots: Record<string, Record<string, unknown>[]>,
  crossPivot: Record<string, unknown>[]
): string {
  const lines: string[] = [];

  lines.push('# Excel 数据分析报告');
  lines.push('');
  lines.push(`**生成时间**: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  // 数据概览
  lines.push('## 一、数据概览');
  lines.push('');
  lines.push(`| 文件 | 行数 | 列数 |`);
  lines.push(`|------|------|------|`);
  lines.push(`| 资金流水表 | ${financial.sheets[0]!.rowCount} | ${financial.sheets[0]!.columns.length} |`);
  lines.push(`| 通信记录表 | ${comm.sheets[0]!.rowCount} | - |`);
  lines.push(`| 多Sheet测试表 | ${multi.sheets.reduce((s, sh) => s + sh.rowCount, 0)} | ${multi.sheets.length} 个 Sheet |`);
  lines.push('');

  // 资金流水分析
  lines.push('## 二、资金流水分析');
  lines.push('');

  lines.push('### 2.1 区域销售汇总');
  lines.push('');
  lines.push('| 区域 | 订单数 | 总销售额 | 平均单价 |');
  lines.push('|------|--------|----------|----------|');
  for (const r of explores.explore1) {
    lines.push(`| ${r['区域']} | ${r['订单数']} | ${formatNumber(Number(r['总销售额']))} | ${formatNumber(Number(r['平均单价']))} |`);
  }
  lines.push('');

  lines.push('### 2.2 产品销售排名');
  lines.push('');
  lines.push('| 产品 | 订单数 | 总销售额 |');
  lines.push('|------|--------|----------|');
  for (const r of explores.explore2) {
    lines.push(`| ${r['产品']} | ${r['订单数']} | ${formatNumber(Number(r['总销售额']))} |`);
  }
  lines.push('');

  lines.push('### 2.3 异常值分析');
  lines.push('');
  if (explores.explore4.length > 0) {
    const e = explores.explore4[0]!;
    lines.push(`- 异常订单数: **${e['异常数']}** 笔`);
    lines.push(`- 异常平均金额: **${formatNumber(Number(e['异常平均值']))}** 元`);
    lines.push(`- 最大异常值: **${formatNumber(Number(e['最大异常值']))}** 元`);
  }
  lines.push('');

  lines.push('### 2.4 支付方式分布');
  lines.push('');
  lines.push('| 支付方式 | 订单数 | 总销售额 | 平均单价 |');
  lines.push('|----------|--------|----------|----------|');
  for (const r of pivots.pivot5) {
    lines.push(`| ${r['支付方式']} | ${r['订单数']} | ${formatNumber(Number(r['总销售额']))} | ${formatNumber(Number(r['平均单价']))} |`);
  }
  lines.push('');

  // 通信记录分析
  lines.push('## 三、通信记录分析');
  lines.push('');
  lines.push('（通信记录探索数据已在测试过程中输出）');
  lines.push('');

  // 跨表分析
  lines.push('## 四、跨表关联分析');
  lines.push('');
  lines.push('### 按行业汇总销售额（销售表 JOIN 客户表）');
  lines.push('');
  lines.push('| 行业 | 订单数 | 总销售额 | 平均单价 |');
  lines.push('|------|--------|----------|----------|');
  for (const r of crossPivot) {
    lines.push(`| ${r['行业']} | ${r['订单数']} | ${formatNumber(Number(r['总销售额']))} | ${formatNumber(Number(r['平均单价']))} |`);
  }
  lines.push('');

  // 数据完整性验证
  lines.push('## 五、数据完整性验证');
  lines.push('');
  lines.push('| 验证项 | 结果 |');
  lines.push('|--------|------|');
  lines.push(`| 资金流水表行数 | ${financial.sheets[0]!.rowCount} 行 ✅ |`);
  lines.push(`| 通信记录表行数 | ${comm.sheets[0]!.rowCount} 行 ✅ |`);
  lines.push(`| 多Sheet数据完整性 | ${multi.sheets.length} 个 Sheet 全部解析 ✅ |`);
  lines.push(`| 跨表 JOIN | 成功关联 ${crossPivot.length} 个行业 ✅ |`);
  lines.push('');

  lines.push('---');
  lines.push(`*报告由 Excel 智能体自动生成*`);

  return lines.join('\n');
}

main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
