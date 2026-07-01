/**
 * 简单测试脚本 - 直接查看查询结果
 */

import { wsQuery } from './ws-query';

async function main() {
  console.log('测试查询...\n');

  const question = '劳动合同法第三十九条规定了什么？';
  console.log(`问题: ${question}\n`);

  try {
    const result = await wsQuery(question, 120_000);

    console.log('=== 查询结果 ===');
    console.log(`\n答案:\n${result.answer}\n`);

    console.log(`\n引用 (${result.citations.length} 条):`);
    for (const c of result.citations) {
      console.log(`- 《${c.documentTitle}》 score=${c.score.toFixed(3)}`);
      console.log(`  excerpt: ${c.excerpt.slice(0, 100)}...`);
    }

    console.log(`\n终止路径: ${result.termination}`);
    console.log(`耗时: ${result.latencyMs}ms`);
    console.log(`\nTool 调用: ${result.toolCalls.map(t => t.name).join(', ')}`);
  } catch (err) {
    console.error('查询失败:', err);
  }
}

main();