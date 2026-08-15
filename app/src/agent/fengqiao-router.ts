/**
 * 枫桥智诉主调度规则路由（兜底 LLM 路由不稳定）
 * 返回 null 表示由主 Agent 直接回答（问候、能力介绍等）
 */
export type FengqiaoRoute = 'mediation' | 'corporate' | 'general';

const GREETING = /^(你好|您好|在吗|hi|hello)[\s!！。?？]*$/i;
const CAPABILITY = /你能帮我做什么|你能做什么|你有什么功能|介绍.*能力|你是谁/;
const META_TOOL = /用了什么工具|什么技能|怎么查的法条|内部工具/i;
export { META_TOOL };

const CORPORATE = new RegExp(
  [
    '合同审查', '股权', '催收', '员工手册', '考勤制度', '合规体系', '低成本.*合规', '没有法务',
    '采购合同', '设备采购', '违约金.*修改', '辞退.*文书', '缴社保', '加班费', '竞业协议',
    '诉讼策略', '乙方', '甲方.*违约金', '通用.*劳动合同模板', '正式法律意见', '签不签',
    '三人合伙', '自动续约', '解约条款', '没签劳动合同', '入职半年',
    '\\d+万.*合同', '账款催收', '催款函',
  ].join('|'),
);

const MEDIATION = new RegExp(
  [
    '纠纷', '调解', '邻居', '房东', '租客', '物业', '拖欠.*工资', '工资.*维权', '被辞',
    '家暴', '离婚', '吵架', '上访', '欠.*不还', '漏水', '押金', '车位', '包工头', '打工',
    '气死了', '付出代价', '揍', '锁车', '判决', '打赢', '维权', '邻里', '停车', '装修噪音',
    '赡养', '拆迁补偿', '集体拒交', '堵门', '砸东西', '货款.*诉讼', '沟通话术',
    '社区工作', '激化前', '预防.*小事', '劳动纠纷.*材料',
  ].join('|'),
);

const GENERAL_LAW = new RegExp(
  [
    '《[^》]+》.*第[^条]+条', '^《[^》]+》第',
    '法和.*法.*区别', '有何不同', '经济补偿方面',
    '法定代表人变更', '公司法关于',
  ].join('|'),
);

export function inferFengqiaoRoute(question: string): FengqiaoRoute | null {
  const q = question.trim();
  if (!q) return null;
  if (GREETING.test(q) || CAPABILITY.test(q) || META_TOOL.test(q)) return null;

  // 街道/调解员治理视角 → 调解轨
  if (/街道调解员|社会治理|辖区.*苗头/.test(q)) return 'mediation';
  if (/婆媳|老公|家暴|离婚|抚养权|夫妻|带孩子|家庭.*僵|赡养/.test(q)) return 'mediation';

  // 劳动者个人维权 → 调解轨
  if (/被公司.*辞|无故辞退|被辞退|开除.*怎么办|拖欠.*工资.*维权|包工头/.test(q)) return 'mediation';

  // 企业内部人事/制度 → 企业轨
  if (/人事部门|员工手册|考勤制度|人事.*排查|企业内部/.test(q)) return 'corporate';

  // 合同条款审查（含仲裁/管辖）→ 企业轨
  if (/合同约定|仲裁.*公司|管辖|自动续约|解约条款/.test(q)) return 'corporate';

  // 企业经营债权/违约金谈判 → 企业轨
  if (/客户欠|违约金条款|苛刻.*违约金|想签又怕/.test(q)) return 'corporate';

  if (GENERAL_LAW.test(q) && !MEDIATION.test(q)) return 'general';
  if (CORPORATE.test(q)) return 'corporate';
  if (MEDIATION.test(q)) return 'mediation';

  if (/合同审查|股权|催收|员工手册|合规|社保|劳动合同|采购|设备.*合同/.test(q)) return 'corporate';
  if (/纠纷|怎么办|怎么维权|调解/.test(q)) return 'mediation';

  return 'mediation';
}
