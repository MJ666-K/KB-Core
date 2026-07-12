/**
 * 生成 Excel 智能体测试数据
 *
 * 生成 3 个测试文件：
 * 1. 资金流水表（12000 行）—— 多维度、数值分布不均、含异常值
 * 2. 通信记录表（10000 行）—— 时间序列、分类数据
 * 3. 多Sheet测试表（3 个 Sheet，格式不同）—— 测试跨 Sheet 分析
 */

import * as XLSX from 'xlsx';

const OUTPUT_DIR = './tests/fixtures';

// ─── 工具函数 ───

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)]!;
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// ─── 1. 资金流水表（12000 行）───

function generateFinancialFlow(): void {
  console.log('生成资金流水表（12000 行）...');

  const regions = ['华东', '华南', '华北', '华中', '西南', '西北', '东北'];
  const products = ['高端产品A', '标准产品B', '经济产品C', '新品D', '促销品E'];
  const channels = ['线上', '线下', '代理', '直销'];
  const customers = Array.from({ length: 200 }, (_, i) => `客户${String(i + 1).padStart(4, '0')}`);
  const paymentMethods = ['银行转账', '支付宝', '微信', '现金', '信用卡'];
  const statuses = ['已完成', '待确认', '已退款', '处理中'];

  const headers = [
    '流水号', '日期', '客户', '区域', '产品', '渠道',
    '单价', '数量', '金额', '折扣率', '实付金额',
    '支付方式', '状态', '销售员', '备注'
  ];

  const rows: string[][] = [headers];
  const startDate = new Date('2024-01-01');
  const endDate = new Date('2024-12-31');

  for (let i = 0; i < 12000; i++) {
    const date = formatDate(randomDate(startDate, endDate));
    const customer = pick(customers);
    const region = pick(regions);
    const product = pick(products);
    const channel = pick(channels);
    const unitPrice = product === '高端产品A' ? randInt(5000, 50000)
      : product === '标准产品B' ? randInt(1000, 5000)
      : product === '经济产品C' ? randInt(100, 1000)
      : product === '新品D' ? randInt(2000, 10000)
      : randInt(50, 500);
    const quantity = randInt(1, 100);
    const amount = unitPrice * quantity;
    const discount = Math.random() < 0.3 ? +(rand(0.7, 0.95)).toFixed(2) : 1.0;
    const actualAmount = +(amount * discount).toFixed(2);
    const payment = pick(paymentMethods);
    // 90% 已完成，5% 待确认，3% 已退款，2% 处理中
    const statusRand = Math.random();
    const status = statusRand < 0.90 ? '已完成' : statusRand < 0.95 ? '待确认' : statusRand < 0.98 ? '已退款' : '处理中';
    const salesperson = `销售${String(randInt(1, 30)).padStart(3, '0')}`;
    const serialNo = `TXN${String(i + 1).padStart(6, '0')}`;

    // 5% 概率产生异常大值
    const finalAmount = Math.random() < 0.05 ? actualAmount * randInt(5, 20) : actualAmount;

    const remark = Math.random() < 0.1 ? '大额订单' : Math.random() < 0.2 ? 'VIP客户' : '';

    rows.push([
      serialNo, date, customer, region, product, channel,
      String(unitPrice), String(quantity), String(amount),
      String(discount), String(+finalAmount.toFixed(2)),
      payment, status, salesperson, remark
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '资金流水');
  XLSX.writeFile(wb, `${OUTPUT_DIR}/资金流水表.xlsx`);
  console.log(`  ✓ 资金流水表.xlsx: ${rows.length - 1} 行`);
}

// ─── 2. 通信记录表（10000 行）───

function generateCommunicationRecords(): void {
  console.log('生成通信记录表（10000 行）...');

  const departments = ['研发部', '市场部', '销售部', '财务部', '人事部', '运营部', '客服部', '法务部'];
  const commTypes = ['电话', '邮件', '会议', '即时消息', '视频会议'];
  const directions = ['呼入', '呼出', '内部'];
  const priorities = ['高', '中', '低'];
  const employees = Array.from({ length: 150 }, (_, i) => `员工${String(i + 1).padStart(4, '0')}`);
  const externalContacts = Array.from({ length: 100 }, (_, i) => `外部联系人${String(i + 1).padStart(3, '0')}`);

  const headers = [
    '记录ID', '时间', '通信类型', '方向', '发起人', '发起部门',
    '对方', '对方类型', '时长(分钟)', '优先级', '主题',
    '是否有效', '满意度', '跟进状态'
  ];

  const rows: string[][] = [headers];
  const startDate = new Date('2024-01-01');
  const endDate = new Date('2024-12-31');

  for (let i = 0; i < 10000; i++) {
    const datetime = formatDateTime(randomDate(startDate, endDate));
    const commType = pick(commTypes);
    const direction = commType === '电话' ? pick(directions) : commType === '邮件' ? pick(['呼入', '呼出']) : '内部';
    const initiator = pick(employees);
    const dept = pick(departments);
    const isInternal = direction === '内部';
    const counterpart = isInternal ? pick(employees) : pick(externalContacts);
    const counterpartType = isInternal ? '内部' : '外部';
    const duration = commType === '电话' ? randInt(1, 60)
      : commType === '会议' || commType === '视频会议' ? randInt(15, 180)
      : commType === '邮件' ? randInt(0, 30)
      : randInt(0, 10);
    const priority = pick(priorities);
    const subjects = ['项目进展', '需求讨论', '问题反馈', '合同事宜', '付款确认', '技术支持', '投诉处理', '培训安排', '季度总结', '方案评审'];
    const subject = pick(subjects);
    const isValid = Math.random() < 0.85 ? '是' : '否';
    const satisfaction = commType === '电话' || commType === '会议' || commType === '视频会议'
      ? String(randInt(1, 5))
      : '';
    const followUp = pick(['已完成', '待跟进', '无需跟进', '已转交']);
    const recordId = `COMM${String(i + 1).padStart(6, '0')}`;

    rows.push([
      recordId, datetime, commType, direction, initiator, dept,
      counterpart, counterpartType, String(duration), priority, subject,
      isValid, satisfaction, followUp
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '通信记录');
  XLSX.writeFile(wb, `${OUTPUT_DIR}/通信记录表.xlsx`);
  console.log(`  ✓ 通信记录表.xlsx: ${rows.length - 1} 行`);
}

// ─── 3. 多Sheet测试表（3 个 Sheet，格式不同）───

function generateMultiSheet(): void {
  console.log('生成多Sheet测试表...');

  const wb = XLSX.utils.book_new();

  // Sheet 1: 销售数据（5000 行）
  {
    const headers = ['日期', '产品', '区域', '金额', '数量', '客户ID'];
    const rows: string[][] = [headers];
    const products = ['产品A', '产品B', '产品C', '产品D'];
    const regions = ['华东', '华南', '华北', '西南'];

    for (let i = 0; i < 5000; i++) {
      const date = formatDate(randomDate(new Date('2024-01-01'), new Date('2024-12-31')));
      const product = pick(products);
      const region = pick(regions);
      const amount = randInt(100, 50000);
      const quantity = randInt(1, 50);
      const customerId = `C${String(randInt(1, 100)).padStart(4, '0')}`;
      rows.push([date, product, region, String(amount), String(quantity), customerId]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '销售数据');
    console.log(`  ✓ Sheet "销售数据": ${rows.length - 1} 行`);
  }

  // Sheet 2: 客户信息（100 行，格式完全不同）
  {
    const headers = ['客户ID', '客户名称', '行业', '区域', '注册日期', '信用等级', '年消费额'];
    const rows: string[][] = [headers];
    const industries = ['制造业', '金融业', '零售业', '科技', '医疗', '教育', '物流'];
    const creditLevels = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'];

    for (let i = 0; i < 100; i++) {
      const customerId = `C${String(i + 1).padStart(4, '0')}`;
      const name = `公司${String.fromCharCode(65 + (i % 26))}${randInt(1, 999)}`;
      const industry = pick(industries);
      const region = pick(['华东', '华南', '华北', '西南', '西北']);
      const regDate = formatDate(randomDate(new Date('2020-01-01'), new Date('2024-01-01')));
      const credit = pick(creditLevels);
      const annualSpend = randInt(10000, 5000000);
      rows.push([customerId, name, industry, region, regDate, credit, String(annualSpend)]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '客户信息');
    console.log(`  ✓ Sheet "客户信息": ${rows.length - 1} 行`);
  }

  // Sheet 3: 月度目标（12 行，格式又不同）
  {
    const headers = ['月份', '销售目标', '实际完成', '完成率', '备注'];
    const rows: string[][] = [headers];

    for (let m = 1; m <= 12; m++) {
      const month = `2024-${String(m).padStart(2, '0')}`;
      const target = randInt(500000, 2000000);
      const actual = randInt(300000, 2500000);
      const rate = +(actual / target * 100).toFixed(1);
      const remark = rate >= 100 ? '超额完成' : rate >= 80 ? '基本达标' : '需改进';
      rows.push([month, String(target), String(actual), `${rate}%`, remark]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '月度目标');
    console.log(`  ✓ Sheet "月度目标": ${rows.length - 1} 行`);
  }

  XLSX.writeFile(wb, `${OUTPUT_DIR}/多Sheet测试表.xlsx`);
  console.log('  ✓ 多Sheet测试表.xlsx 生成完成');
}

// ─── 主函数 ───

import { mkdirSync, existsSync } from 'fs';

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('=== 生成 Excel 智能体测试数据 ===\n');
generateFinancialFlow();
generateCommunicationRecords();
generateMultiSheet();
console.log('\n=== 全部生成完成 ===');
console.log(`输出目录: ${OUTPUT_DIR}/`);
