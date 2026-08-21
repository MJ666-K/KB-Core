/**
 * 枫桥智诉主调度规则路由（兜底 LLM 路由不稳定）
 * 返回 null 表示由主 Agent 直接回答（问候、能力介绍等）
 */
export type FengqiaoRoute = 'mediation' | 'corporate' | 'general';

const GREETING = /^(你好|您好|在吗|hi|hello)([，,。.！!?\s]|$)/i;
const CAPABILITY = /你能帮我|你能做什么|你有什么功能|介绍.*能力|你是谁|你擅长什么|说下你擅长|解决什么问题|我刚来/;
const META_TOOL = /用了什么工具|什么技能|怎么查的法条|内部工具/i;
export { META_TOOL };

const CORPORATE = new RegExp(
  [
    '合同审查', '合作合同', '股权', '合伙', '权怎么分', '催收', '员工手册', '考勤制度', '合规体系',
    '低成本.*合规', '没有法务', '采购合同', '设备采购', '违约金', '合同总价', '辞退.*文书',
    '缴社保', '加班费', '竞业协议', '诉讼策略', '乙方', '甲方.*违约金', '通用.*劳动合同模板',
    '正式法律意见', '签不签', '能签吗', '自动续约', '解约', '退出机制', '没签.*合同', '补签',
    '来了半年', '入职半年', '\\d+万.*合同', '账款催收', '催款函', '上海仲裁', '争议在.*仲裁',
    '异地.*仲裁', '想接又怕', '怕赔死', '不让.*翻脸', '违约金很重', '大客户.*合同',
  ].join('|'),
);

const MEDIATION = new RegExp(
  [
    '纠纷', '调解', '邻居', '房东', '租客', '物业', '拖欠.*工资', '工资.*维权', '公司欠薪', '欠薪',
    '被辞', '家暴', '离婚', '上访', '欠.*不还', '漏水', '押金', '车位', '包工头', '打工',
    '气死了', '付出代价', '揍', '动手', '打人', '出气', '锁车', '判决', '打赢', '维权', '邻里',
    '停车', '装修噪音', '扰民', '赡养', '拆迁补偿', '集体拒交', '堵门', '砸东西', '货款.*诉讼',
    '沟通话术', '社区工作', '激化前', '预防.*小事', '劳动纠纷.*材料', '谁有理', '判一下',
  ].join('|'),
);

const GENERAL_LAW = new RegExp(
  [
    '《[^》]+》\\s*第?\\s*\\d+\\s*条', '《[^》]+》\\s*\\d+\\s*条',
    '法和.*法.*区别', '法和.*法.*不一样', '有何不同', '有哪些不一样', '规定有哪些',
    '经济补偿方面', '法定代表人变更', '公司法关于', '二者在.*不一样',
  ].join('|'),
);

/** 主 Agent 直答（不路由子 Agent） */
export function isMainDirectAnswer(question: string): boolean {
  const q = question.trim();
  if (!q) return true;
  return GREETING.test(q) || CAPABILITY.test(q) || META_TOOL.test(q);
}

export function buildMainDirectAnswer(): string {
  return [
    '您好，我是「枫桥智诉」，基于枫桥经验打造的民商双轨法治助手。',
    '',
    '**我能帮您两类问题：**',
    '1. **基层调解轨**：邻里物业、家庭婚姻、劳动维权、物业纠纷等——侧重调解、协商和非诉化解，帮您把矛盾化解在激化之前。',
    '2. **企业合规轨**：合同审查、用工合规、账款催收、股权合伙等——侧重低成本合法、可落地的合规方案。',
    '',
    '您可以直接描述具体情形，我会按场景给出可操作建议。',
    '本介绍仅供参考，具体法律问题请以正式咨询为准。',
  ].join('\n');
}

export function inferFengqiaoRoute(question: string): FengqiaoRoute | null {
  const q = question.trim();
  if (!q || isMainDirectAnswer(q)) return null;

  // 街道/调解员治理视角 → 调解轨
  if (/街道调解员|社会治理|辖区.*苗头/.test(q)) return 'mediation';
  if (/婆媳|老公|家暴|离婚|抚养权|夫妻|带孩子|家庭.*僵|赡养/.test(q)) return 'mediation';

  // 劳动者欠薪/维权（含问法条序号）→ 调解轨
  if (/公司欠薪|欠薪.*第几条|拖欠.*工资|被公司.*辞|无故辞退|被辞退|开除.*怎么办|包工头/.test(q)) {
    return 'mediation';
  }

  // 纯法条/法条对比 → 通用轨（优先于企业/调解关键词）
  if (GENERAL_LAW.test(q) && !/合同能签|正式法律意见/.test(q)) return 'general';

  // 企业内部人事/制度 → 企业轨
  if (/人事部门|员工手册|考勤制度|人事.*排查|企业内部/.test(q)) return 'corporate';

  // 员工用工合规（补签、没签合同）→ 企业轨
  if (/员工.*(没签|未签).*合同|补签还来得及|来了半年.*合同|入职半年/.test(q)) return 'corporate';

  // 合同/商事合规 → 企业轨
  if (/合同约定|仲裁|管辖|自动续约|解约|合作合同|违约金|合同总价|合伙|权怎么分/.test(q)) {
    return 'corporate';
  }
  if (/客户欠|想接又怕|怕赔死|大客户.*合同|不让.*翻脸/.test(q)) return 'corporate';

  if (CORPORATE.test(q)) return 'corporate';
  if (MEDIATION.test(q)) return 'mediation';

  if (/合同审查|股权|催收|员工手册|合规|社保|劳动合同|采购|设备.*合同/.test(q)) return 'corporate';
  if (/纠纷|怎么办|怎么维权|调解/.test(q)) return 'mediation';

  return 'mediation';
}
