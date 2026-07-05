/** 不在 UI 展示的内部步骤（仍正常执行，仅隐藏标签与专属状态文案） */
export const HIDDEN_UI_ACTIONS = new Set([
  'call_agent', 'qa', 'search_knowledge', 'search', 'multihop',
]);

export function shouldShowAction(name: string): boolean {
  return !HIDDEN_UI_ACTIONS.has(name);
}

/** 面向用户的 Skill / Tool 显示名（不暴露内部标识） */
export const ACTION_LABELS: Record<string, string> = {
  chat: '智能回复',
  qa: '法律问答',
  search: '法条检索',
  search_knowledge: '知识检索',
  multihop: '深度分析',
  compare: '对比分析',
  summary: '要点总结',
  call_agent: '专家分析',
  list_documents: '文档列表',
};

export function actionLabel(name: string, skillMap?: Map<string, string>): string {
  const fromDb = skillMap?.get(name);
  // DB displayName 若与内部 name 相同（如 "qa"），视为未配置友好名
  if (fromDb && fromDb !== name) return fromDb;
  return ACTION_LABELS[name] ?? '智能处理';
}

/** 加载过程中的状态文案（不含技术名称） */
export function statusMessage(
  phase: 'thinking' | 'tool' | 'writing',
  runningAction?: string,
  kind?: string,
): string {
  if (phase === 'thinking') return '正在理解您的问题...';
  if (phase === 'writing') return '正在生成回答...';
  if (phase === 'tool') {
    if (runningAction === 'search_knowledge' || runningAction === 'search') {
      return '正在检索相关法律资料...';
    }
    if (runningAction === 'call_agent') return '正在请专家分析...';
    if (runningAction === 'multihop' || runningAction === 'summary' || runningAction === 'compare') {
      return '正在整理回答...';
    }
    if (kind === 'skill' || runningAction === 'chat' || runningAction === 'qa') return '正在整理回答...';
    return '正在处理...';
  }
  return '处理中...';
}

/** 压缩 Markdown：去掉多余空行（仅用于特殊场景，展示时不改写内容） */
export function compactMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export interface AggregatedCall {
  name: string;
  kind: string;
  count: number;
}

export function aggregateCalls(
  calls: Array<{ name: string; kind: string; done: boolean }>,
): AggregatedCall[] {
  const map = new Map<string, AggregatedCall>();
  for (const c of calls) {
    const prev = map.get(c.name);
    if (prev) prev.count += 1;
    else map.set(c.name, { name: c.name, kind: c.kind, count: 1 });
  }
  return [...map.values()].filter(c => shouldShowAction(c.name));
}
