/** 文档标题关键词 → 推荐问题（与 app/documents 入库法规对应） */
const HINT_BY_TITLE_KEY: Array<[string, string]> = [
  ['劳动合同法', '员工加班工资应按什么标准支付？'],
  ['劳动法', '用人单位解除劳动合同需要满足什么条件？'],
  ['劳动争议调解仲裁法', '劳动争议申请仲裁的时效是多长？'],
  ['民法典', '合同违约责任的承担方式有哪些？'],
  ['合同编通则', '合同解除与违约损害赔偿如何认定？'],
  ['公司法', '有限责任公司股东如何转让股权？'],
  ['合伙企业法', '合伙人退伙的法律规定是什么？'],
  ['企业所得税法', '企业所得税的基本税率是多少？'],
  ['增值税', '增值税一般纳税人的适用税率有哪些？'],
  ['税收征收管理法', '纳税人享有哪些权利和义务？'],
  ['土地管理法', '农村集体土地征收补偿如何确定？'],
  ['社会保险法', '用人单位未缴纳社保应承担什么责任？'],
  ['行政处罚法', '行政处罚应遵循哪些基本原则？'],
  ['治安管理处罚法', '哪些行为属于治安管理违法行为？'],
  ['噪声污染防治法', '夜间施工噪声超标应如何处罚？'],
  ['道路交通安全法', '交通事故责任应如何划分？'],
  ['招标投标法', '哪些项目必须进行招标？'],
  ['民间借贷', '民间借贷利率上限如何认定？'],
  ['人身损害赔偿', '人身损害赔偿包括哪些项目？'],
  ['住房公积金', '单位不为职工缴存公积金有什么后果？'],
  ['会计法', '哪些事项必须办理会计手续并核算？'],
  ['审计法', '国家审计机关的主要职责有哪些？'],
  ['发票管理办法', '开具发票有哪些基本规定？'],
];

const FALLBACK_HINTS = [
  '劳动合同法关于加班工资的规定？',
  '民法典中合同解除的条件有哪些？',
  '公司股东转让股权需要哪些程序？',
  '劳动争议申请仲裁的时效是多久？',
];

/** 根据文档库标题生成推荐问题，最多返回 max 条 */
export function buildChatHints(documents: Array<{ title: string }>, max = 4): string[] {
  const seen = new Set<string>();
  const hints: string[] = [];

  for (const doc of documents) {
    if (hints.length >= max) break;
    for (const [key, question] of HINT_BY_TITLE_KEY) {
      if (doc.title.includes(key) && !seen.has(question)) {
        seen.add(question);
        hints.push(question);
        break;
      }
    }
  }

  if (hints.length === 0) return FALLBACK_HINTS.slice(0, max);
  while (hints.length < max) {
    const next = FALLBACK_HINTS.find(q => !seen.has(q));
    if (!next) break;
    seen.add(next);
    hints.push(next);
  }
  return hints;
}

export const CHAT_INTRO =
  '基于已入库法律法规文档，智能检索相关条款并为您解答';

export const CHAT_SUBTITLE =
  '法律法规智能问答 · 基于知识库检索解答';
