/**
 * KB-Core 准确度评估测试脚本
 * 
 * 功能：
 * 1. 设计测试集（问题 + 预期答案/法条）
 * 2. 执行查询，计算召回准确率
 * 3. 目标：98%+ 准确率
 * 
 * 运行：bun tests/accuracy-evaluation.ts
 */

import { wsQuery } from './ws-query';

interface TestCase {
  id: string;
  category: string;
  question: string;
  expectedKeywords: string[]; // 预期答案中应该包含的关键词
  expectedLaws?: string[]; // 预期引用的法律名称
  strictMatch?: boolean; // 是否要求严格匹配关键词
}

interface TestResult {
  testCase: TestCase;
  success: boolean;
  answer: string;
  citations: Array<{
    documentTitle: string;
    excerpt: string;
    score: number;
  }>;
  keywordMatchRate: number; // 关键词匹配率
  lawMatchRate: number; // 法律匹配率
  latencyMs: number;
  termination: string;
  error?: string;
}

// ===== 测试集设计 =====
// 覆盖不同类型的法律问题，确保召回准确

const TEST_CASES: TestCase[] = [
  // ===== 劳动合同法（39 chunks） =====
  {
    id: 'labor-1',
    category: '劳动合同法',
    question: '劳动合同法第三十九条规定了什么？',
    expectedKeywords: ['第三十九条', '劳动者', '用人单位', '解除劳动合同'],
    expectedLaws: ['劳动合同法'],
    strictMatch: true,
  },
  {
    id: 'labor-2',
    category: '劳动合同法',
    question: '用人单位违法解除劳动合同怎么赔偿劳动者？',
    expectedKeywords: ['违法解除', '赔偿', '双倍', '经济补偿'],
    expectedLaws: ['劳动合同法'],
  },
  {
    id: 'labor-3',
    category: '劳动合同法',
    question: '劳动合同试用期最长是多少个月？',
    expectedKeywords: ['试用期', '六个月', '三个月', '一个月'],
    expectedLaws: ['劳动合同法'],
  },
  {
    id: 'labor-4',
    category: '劳动合同法',
    question: '劳动合同应当具备哪些必备条款？',
    expectedKeywords: ['必备条款', '劳动合同期限', '工作内容', '劳动报酬', '社会保险'],
    expectedLaws: ['劳动合同法'],
  },

  // ===== 公司法（102 chunks） =====
  {
    id: 'company-1',
    category: '公司法',
    question: '公司法关于法定代表人有什么规定？',
    expectedKeywords: ['法定代表人', '公司', '董事长', '执行董事'],
    expectedLaws: ['公司法'],
  },
  {
    id: 'company-2',
    category: '公司法',
    question: '公司股东有哪些权利？',
    expectedKeywords: ['股东', '权利', '表决权', '分红', '查阅'],
    expectedLaws: ['公司法'],
  },
  {
    id: 'company-3',
    category: '公司法',
    question: '有限责任公司设立需要什么条件？',
    expectedKeywords: ['有限责任公司', '设立', '股东', '注册资本'],
    expectedLaws: ['公司法'],
  },

  // ===== 民法典（357 chunks） =====
  {
    id: 'civil-1',
    category: '民法典',
    question: '民法典关于合同违约责任有什么规定？',
    expectedKeywords: ['违约责任', '合同', '赔偿', '继续履行'],
    expectedLaws: ['民法典', '民法典合同编'],
  },
  {
    id: 'civil-2',
    category: '民法典',
    question: '民法典规定的民事主体有哪些？',
    expectedKeywords: ['民事主体', '自然人', '法人', '非法人组织'],
    expectedLaws: ['民法典'],
  },
  {
    id: 'civil-3',
    category: '民法典',
    question: '民法典关于借款合同利息有什么规定？',
    expectedKeywords: ['借款合同', '利息', '利率'],
    expectedLaws: ['民法典'],
  },

  // ===== 社会保险法（36 chunks） =====
  {
    id: 'social-1',
    category: '社会保险法',
    question: '社会保险法规定了哪些社会保险种类？',
    expectedKeywords: ['社会保险', '基本养老保险', '基本医疗保险', '工伤保险', '失业保险', '生育保险'],
    expectedLaws: ['社会保险法'],
    strictMatch: true,
  },
  {
    id: 'social-2',
    category: '社会保险法',
    question: '用人单位应当何时为劳动者缴纳社会保险？',
    expectedKeywords: ['社会保险', '缴纳', '用人单位', '用工之日', '三十日'],
    expectedLaws: ['社会保险法'],
  },

  // ===== 道路交通安全法（52 chunks） =====
  {
    id: 'traffic-1',
    category: '道路交通安全法',
    question: '道路交通安全法关于酒驾有什么处罚规定？',
    expectedKeywords: ['酒驾', '醉酒', '驾驶', '处罚', '暂扣', '吊销'],
    expectedLaws: ['道路交通安全法'],
  },
  {
    id: 'traffic-2',
    category: '道路交通安全法',
    question: '机动车超速行驶怎么处罚？',
    expectedKeywords: ['超速', '机动车', '处罚', '罚款', '扣分'],
    expectedLaws: ['道路交通安全法'],
  },

  // ===== 治安管理处罚法（70 chunks） =====
  {
    id: 'security-1',
    category: '治安管理处罚法',
    question: '治安管理处罚法规定的处罚种类有哪些？',
    expectedKeywords: ['处罚种类', '警告', '罚款', '行政拘留', '吊销许可证'],
    expectedLaws: ['治安管理处罚法'],
  },

  // ===== 土地管理法（43 chunks） =====
  {
    id: 'land-1',
    category: '土地管理法',
    question: '土地管理法关于耕地保护有什么规定？',
    expectedKeywords: ['耕地', '保护', '占用', '补偿'],
    expectedLaws: ['土地管理法'],
  },

  // ===== 税收征收管理法（35 chunks） =====
  {
    id: 'tax-1',
    category: '税收征收管理法',
    question: '纳税人未按时申报纳税会受到什么处罚？',
    expectedKeywords: ['纳税人', '申报', '处罚', '罚款', '滞纳金'],
    expectedLaws: ['税收征收管理法'],
  },

  // ===== 审计法（22 chunks） =====
  {
    id: 'audit-1',
    category: '审计法',
    question: '审计机关的职责是什么？',
    expectedKeywords: ['审计机关', '职责', '审计', '监督'],
    expectedLaws: ['审计法'],
  },

  // ===== 招标投标法（26 chunks） =====
  {
    id: 'bidding-1',
    category: '招标投标法',
    question: '招标投标法关于投标人有什么要求？',
    expectedKeywords: ['投标人', '资格', '招标', '响应'],
    expectedLaws: ['招标投标法'],
  },

  // ===== 行政处罚法（33 chunks） =====
  {
    id: 'admin-1',
    category: '行政处罚法',
    question: '行政处罚法规定的行政处罚种类有哪些？',
    expectedKeywords: ['行政处罚', '种类', '警告', '罚款', '没收', '责令停产停业'],
    expectedLaws: ['行政处罚法'],
  },

  // ===== 会计法 =====
  {
    id: 'accounting-1',
    category: '会计法',
    question: '会计法对会计核算有什么规定？',
    expectedKeywords: ['会计核算', '会计凭证', '会计账簿', '财务会计报告'],
    expectedLaws: ['会计法'],
  },
];

async function main() {
  console.log('=== KB-Core 准确度评估测试 ===');
  console.log(`测试用例总数: ${TEST_CASES.length}`);
  console.log(`目标准确率: 98%+\n`);

  const results: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    console.log(`\n[${testCase.id}] ${testCase.question}`);
    const startTime = Date.now();

    try {
      const queryResult = await wsQuery(testCase.question, 120_000);

      // 计算关键词匹配率
      const keywordMatchRate = calculateKeywordMatchRate(
        queryResult.answer,
        testCase.expectedKeywords,
        testCase.strictMatch,
      );

      // 计算法律匹配率
      const lawMatchRate = calculateLawMatchRate(
        queryResult.citations,
        testCase.expectedLaws,
      );

      // 判断是否成功
      const success = keywordMatchRate >= 0.8 && lawMatchRate >= 0.8;

      results.push({
        testCase,
        success,
        answer: queryResult.answer,
        citations: queryResult.citations,
        keywordMatchRate,
        lawMatchRate,
        latencyMs: queryResult.latencyMs,
        termination: queryResult.termination,
      });

      const status = success ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} | 关键词匹配: ${(keywordMatchRate * 100).toFixed(1)}% | 法律匹配: ${(lawMatchRate * 100).toFixed(1)}% | 耗时: ${queryResult.latencyMs}ms`);
    } catch (err) {
      results.push({
        testCase,
        success: false,
        answer: '',
        citations: [],
        keywordMatchRate: 0,
        lawMatchRate: 0,
        latencyMs: Date.now() - startTime,
        termination: 'error',
        error: String(err),
      });

      console.log(`❌ FAIL | 错误: ${err}`);
    }
  }

  // 生成报告
  const report = generateAccuracyReport(results);
  const reportPath = '../docs/tests/accuracy-report.md';
  await Bun.write(reportPath, report);
  console.log(`\n📊 准确度评估报告已保存: ${reportPath}`);

  // 计算总体准确率
  const totalSuccess = results.filter(r => r.success).length;
  const totalAccuracy = (totalSuccess / results.length) * 100;
  console.log(`\n🎯 总体准确率: ${totalAccuracy.toFixed(1)}%`);

  if (totalAccuracy >= 98) {
    console.log(`✅ 达到目标准确率（98%+）`);
  } else {
    console.log(`❌ 未达到目标准确率（98%+），需要优化`);
  }
}

function calculateKeywordMatchRate(answer: string, expectedKeywords: string[], strictMatch?: boolean): number {
  if (!answer || expectedKeywords.length === 0) return 0;

  const matchedKeywords = expectedKeywords.filter(keyword => {
    // 简化匹配：答案中包含关键词即可
    return answer.includes(keyword);
  });

  const matchRate = matchedKeywords.length / expectedKeywords.length;

  // 如果是严格匹配，要求至少 80% 的关键词出现
  if (strictMatch) {
    return matchRate >= 0.8 ? matchRate : 0;
  }

  return matchRate;
}

function calculateLawMatchRate(
  citations: Array<{ documentTitle: string; excerpt: string; score: number }>,
  expectedLaws?: string[],
): number {
  if (!expectedLaws || expectedLaws.length === 0) return 1; // 如果没有预期法律，则认为通过

  const citedLaws = citations.map(c => c.documentTitle);

  const matchedLaws = expectedLaws.filter(expectedLaw => {
    return citedLaws.some(citedLaw => citedLaw.includes(expectedLaw));
  });

  return matchedLaws.length / expectedLaws.length;
}

function generateAccuracyReport(results: TestResult[]): string {
  const totalTests = results.length;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const overallAccuracy = (successCount / totalTests) * 100;

  const avgKeywordMatch = results.reduce((sum, r) => sum + r.keywordMatchRate, 0) / totalTests;
  const avgLawMatch = results.reduce((sum, r) => sum + r.lawMatchRate, 0) / totalTests;
  const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / totalTests;

  let md = `# KB-Core 准确度评估报告\n\n`;
  md += `> 测试时间：${new Date().toISOString()}\n`;
  md += `> 测试用例总数：${totalTests}\n`;
  md += `> 目标准确率：98%+\n\n`;

  md += `## 总览\n\n`;
  md += `| 指标 | 值 |\n|---|---|\n`;
  md += `| 总体准确率 | **${overallAccuracy.toFixed(1)}%** |\n`;
  md += `| 通过用例 | ${successCount} |\n`;
  md += `| 失败用例 | ${failCount} |\n`;
  md += `| 平均关键词匹配率 | ${(avgKeywordMatch * 100).toFixed(1)}% |\n`;
  md += `| 平均法律匹配率 | ${(avgLawMatch * 100).toFixed(1)}% |\n`;
  md += `| 平均响应耗时 | ${avgLatency.toFixed(0)}ms |\n\n`;

  if (overallAccuracy >= 98) {
    md += `### ✅ 达到目标准确率\n\n`;
    md += `系统准确率达到 **98%+**，符合预期目标。\n\n`;
  } else {
    md += `### ❌ 未达到目标准确率\n\n`;
    md += `系统准确率为 **${overallAccuracy.toFixed(1)}%**，未达到 98% 目标。\n\n`;
    md += `**需要优化的方向**：\n`;
    md += `1. 提高召回精度：优化检索参数（topK、rerank）\n`;
    md += `2. 增强语义理解：改进 embedding 质量\n`;
    md += `3. 完善测试集：增加覆盖面和关键词准确度\n\n`;
  }

  md += `## 按类别统计\n\n`;

  const categoryStats = new Map<string, { success: number; total: number }>();
  for (const r of results) {
    const category = r.testCase.category;
    const stats = categoryStats.get(category) || { success: 0, total: 0 };
    stats.total++;
    if (r.success) stats.success++;
    categoryStats.set(category, stats);
  }

  md += `| 法律类别 | 准确率 | 通过/总数 |\n|---|---|---|\n`;
  for (const [category, stats] of categoryStats) {
    const accuracy = ((stats.success / stats.total) * 100).toFixed(1);
    md += `| ${category} | ${accuracy}% | ${stats.success}/${stats.total} |\n`;
  }

  md += `\n## 详细测试结果\n\n`;
  md += `| ID | 类别 | 问题 | 关键词匹配 | 法律匹配 | 耗时 | 状态 |\n`;
  md += `|---|---|---|---|---|---|---|\n`;

  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    const questionShort = r.testCase.question.slice(0, 30) + '...';
    const keywordRate = (r.keywordMatchRate * 100).toFixed(1) + '%';
    const lawRate = (r.lawMatchRate * 100).toFixed(1) + '%';
    const latency = r.latencyMs + 'ms';

    md += `| ${r.testCase.id} | ${r.testCase.category} | ${questionShort} | ${keywordRate} | ${lawRate} | ${latency} | ${status} |\n`;
  }

  md += `\n## 失败案例分析\n\n`;

  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    for (const f of failures) {
      md += `### ${f.testCase.id}: ${f.testCase.question}\n\n`;
      md += `- **关键词匹配率**: ${(f.keywordMatchRate * 100).toFixed(1)}%\n`;
      md += `- **法律匹配率**: ${(f.lawMatchRate * 100).toFixed(1)}%\n`;
      md += `- **预期关键词**: ${f.testCase.expectedKeywords.join(', ')}\n`;

      if (f.error) {
        md += `- **错误**: ${f.error}\n`;
      } else {
        md += `- **答案摘要**: ${f.answer.slice(0, 200)}...\n`;
        md += `- **引用法律**: ${f.citations.map(c => c.documentTitle).join(', ') || '无'}\n`;
      }

      md += `\n`;
    }
  } else {
    md += `✅ 所有测试用例全部通过，无失败案例。\n\n`;
  }

  md += `## 改进建议\n\n`;

  if (overallAccuracy >= 98) {
    md += `当前系统表现优秀，建议继续维护：\n`;
    md += `1. 定期更新测试集，增加新的测试用例\n`;
    md += `2. 监控生产环境的实际查询准确率\n`;
    md += `3. 优化性能瓶颈（如有）\n`;
  } else {
    md += `针对未达标的测试用例，建议：\n`;
    md += `1. **召回优化**：调整 ${`DENSE_TOP_K_MULTIPLIER`}、${`RERANK_TOP_K`} 参数\n`;
    md += `2. **关键词增强**：改进 chunk 切分策略，确保关键词完整性\n`;
    md += `3. **测试集完善**：补充更多精准关键词和预期答案\n`;
    md += `4. **文档补充**：确保相关法律条文完整入库\n`;
  }

  return md;
}

main().catch(err => {
  console.error('准确度评估失败:', err);
  process.exit(1);
});