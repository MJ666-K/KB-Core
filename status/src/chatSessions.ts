export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type SessionGroupKey = 'today' | 'week' | 'month' | 'older';

export const SESSION_GROUP_ORDER: SessionGroupKey[] = ['today', 'week', 'month', 'older'];

export const SESSION_GROUP_LABELS: Record<SessionGroupKey, string> = {
  today: '今日',
  week: '本周',
  month: '本月',
  older: '更早',
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 周一为一周开始 */
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return startOfDay(monday);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function groupSessions(sessions: SessionSummary[]): Partial<Record<SessionGroupKey, SessionSummary[]>> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const groups: Record<SessionGroupKey, SessionSummary[]> = {
    today: [],
    week: [],
    month: [],
    older: [],
  };

  for (const s of sessions) {
    const t = new Date(s.updatedAt);
    if (t >= todayStart) groups.today.push(s);
    else if (t >= weekStart) groups.week.push(s);
    else if (t >= monthStart) groups.month.push(s);
    else groups.older.push(s);
  }

  const out: Partial<Record<SessionGroupKey, SessionSummary[]>> = {};
  for (const key of SESSION_GROUP_ORDER) {
    if (groups[key].length > 0) out[key] = groups[key];
  }
  return out;
}

export function sessionTitleFromQuestion(question: string, max = 18): string {
  const t = question.trim().replace(/\s+/g, ' ');
  if (!t) return '新会话';
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
