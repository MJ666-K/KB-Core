/**
 * KB-Core 快速准确度测试 - 核心用例
 * 
 * 只测试最关键的5个用例，快速验证系统准确度
 */

import { wsQuery } from './ws-query';

interface TestCase {
  id: string;
  question: string;
  expectedKeywords: string[];
  expectedLaws?: string[];
}

interface TestResult {
  testCase: TestCase;
  success: boolean;
  keywordMatchRate: number;
  lawMatchRate: number;
  latencyMs: number;
  error?: string;
}

const TEST_CASES: TestCase[] = [
  {
    id: 'labor-1',
    question: '劳动合同法第三十九条规定了什么？',
    expectedKeywords: ['第三十九条', '劳动者', '用人单位', '解除劳动合同'],
    expectedLaws: ['劳动合同法'],
  },
  {
    id: 'company-1',
    question: '公司法关于法定代表人有什么规定？',
    expectedKeywords: ['法定代表人', '公司'],
    expectedLaws: ['公司法'],
  },
  {
    id: 'civil-1',
    question: '民法典关于合同违约责任有什么规定？',
    expectedKeywords: ['违约责任', '合同'],
    expectedLaws: ['民法典'],
  },
  {
    id: 'social-1',
    question: '社会保险法规定了哪些社会保险种类？',
    expectedKeywords: ['社会保险', '养老保险', '医疗保险'],
    expectedLaws: ['社会保险法'],
  },
  {
    id: 'traffic-1',
    question: '道路交通安全法关于酒驾有什么处罚规定？',
    expectedKeywords: ['酒驾', '醉酒', '驾驶'],
    expectedLaws: ['道路交通安全法'],
  },
];

async function main() {
  console.log('=== KB-Core 快速准确度测试 ===');
  console.log(`核心测试用例: ${TEST_CASES.length}\n`);

  const results: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    console.log(`[${testCase.id}] ${testCase.question}`);
    const startTime = Date.now();

    try {
      const queryResult = await wsQuery(testCase.question, 120_000);

      const keywordMatchRate = calculateKeywordMatchRate(queryResult.answer, testCase.expectedKeywords);
      const lawMatchRate = calculateLawMatchRate(queryResult.citations, testCase.expectedLaws);
      const success = keywordMatchRate >= 0.8 && lawMatchRate >= 0.8;

      results.push({
        testCase,
        success,
        keywordMatchRate,
        lawMatchRate,
        latencyMs: queryResult.latencyMs,
      });

      const status = success ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} | 关键词: ${(keywordMatchRate * 100).toFixed(1)}% | 法律: ${(lawMatchRate * 100).toFixed(1)}% | ${queryResult.latencyMs}ms\n`);
    } catch (err) {
      results.push({
        testCase,
        success: false,
        keywordMatchRate: 0,
        lawMatchRate: 0,
        latencyMs: Date.now() - startTime,
        error: String(err),
      });

      console.log(`❌ FAIL | 错误: ${err}\n`);
    }
  }

  // 生成简单报告
  const totalSuccess = results.filter(r => r.success).length;
  const accuracy = (totalSuccess / results.length) * 100;
  const avgKeyword = results.reduce((sum, r) => sum + r.keywordMatchRate, 0) / results.length;
  const avgLaw = results.reduce((sum, r) => sum + r.lawMatchRate, 0) / results.length;

  console.log('\n=== 测试结果汇总 ===');
  console.log(`总体准确率: ${accuracy.toFixed(1)}%`);
  console.log(`通过用例: ${totalSuccess}/${results.length}`);
  console.log(`平均关键词匹配: ${(avgKeyword * 100).toFixed(1)}%`);
  console.log(`平均法律匹配: ${(avgLaw * 100).toFixed(1)}%`);

  if (accuracy >= 80) {
    console.log('\n✅ 核心用例达标（准确率 ≥ 80%）');
  } else {
    console.log('\n❌ 核心用例未达标（准确率 < 80%）');
  }

  // 保存报告
  const report = generateQuickReport(results);
  const reportPath = '../docs/tests/quick-accuracy-report.md';
  await Bun.write(reportPath, report);
  console.log(`\n📊 报告已保存: ${reportPath}`);
}

function calculateKeywordMatchRate(answer: string, expectedKeywords: string[]): number {
  if (!answer || expectedKeywords.length === 0) return 0;
  const matched = expectedKeywords.filter(k => answer.includes(k));
  return matched.length / expectedKeywords.length;
}

function calculateLawMatchRate(
  citations: Array<{ documentTitle: string }>,
  expectedLaws?: string[],
): number {
  if (!expectedLaws || expectedLaws.length === 0) return 1;
  const citedLaws = citations.map(c => c.documentTitle);
  const matched = expectedLaws.filter(expected => 
    citedLaws.some(cited => cited.includes(expected))
  );
  return matched.length / expectedLaws.length;
}

function generateQuickReport(results: TestResult[]): string {
  const success = results.filter(r => r.success).length;
  const accuracy = (success / results.length) * 100;
  const avgKeyword = results.reduce((sum, r) => sum + r.keywordMatchRate, 0) / results.length;
  const avgLaw = results.reduce((sum, r) => sum + r.lawMatchRate, 0) / results.length;

  let md = `# KB-Core 快速准确度测试报告\n\n`;
  md += `> 测试时间：${new Date().toISOString()}\n`;
  md += `> 测试用例：${results.length} 个核心用例\n\n`;

  md += `## 总览\n\n`;
  md += `| 指标 | 值 |\n|---|---|\n`;
  md += `| 总体准确率 | **${accuracy.toFixed(1)}%** |\n`;
  md += `| 通过用例 | ${success}/${results.length} |\n`;
  md += `| 平均关键词匹配率 | ${(avgKeyword * 100).toFixed(1)}% |\n`;
  md += `| 平均法律匹配率 | ${(avgLaw * 100).toFixed(1)}% |\n\n`;

  md += `## 测试结果\n\n`;
  md += `| ID | 问题关键词匹配法律匹配耗时状态 |\n`;
  md += `|---|---|---|---|---|\n`;

  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    const q = r.testCase.question.slice(0, 25) + '...';
    md += `| ${r.testCase.id} | ${q} | ${(r.keywordMatchRate * 100).toFixed(0)}% | ${(r.lawMatchRate * 100).toFixed(0)}% | ${r.latencyMs}ms | ${status} |\n`;
  }

  md += `\n## 结论\n\n`;
  if (accuracy >= 80) {
    md += `✅ 核心用例达标，系统表现良好。\n`;
    md += `- 关键词匹配率达标（${(avgKeyword * 100).toFixed(1)}% ≥ 80%）\n`;
    md += `- 法律匹配率达标（${(avgLaw * 100).toFixed(1)}% ≥ 80%）\n`;
    md += `\n建议继续进行全量测试（21个用例）以验证更全面的准确度。\n`;
  } else {
    md += `❌ 核心用例未达标，需要优化。\n`;
    md += `\n**问题分析**：\n`;
    const failures = results.filter(r => !r.success);
    for (const f of failures) {
      md += `- ${f.testCase.id}: 关键词 ${(f.keywordMatchRate * 100).toFixed(0)}%, 法律 ${(f.lawMatchRate * 100).toFixed(0)}%\n`;
    }
    md += `\n**改进建议**：\n`;
    md += `1. 优化检索参数（TOP_K, RERANK_TOP_K）\n`;
    md += `2. 完善 embedding 质量\n`;
    md += `3. 调整 Skill 指令\n`;
  }

  return md;
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});