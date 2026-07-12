/**
 * Neo4j Browser 风格配色
 */
import type { KgNodeType } from '../../api/kgApi';

export interface NodeTheme {
  fill: string;
  stroke: string;
  label: string;
}

export const NODE_RADIUS = 24;

export const NODE_THEME: Record<KgNodeType, NodeTheme> = {
  Flow:     { fill: '#C990C0', stroke: '#a86ba8', label: 'Flow' },
  Law:      { fill: '#57C7E3', stroke: '#3ba8c4', label: 'Law' },
  Evidence: { fill: '#F79767', stroke: '#d97a4d', label: 'Evidence' },
  Case:     { fill: '#86DDB3', stroke: '#5fc49a', label: 'Case' },
};

export const TYPE_LABEL_ZH: Record<KgNodeType, string> = {
  Flow: '流程', Law: '法规', Evidence: '证据', Case: '案例',
};

export const REL_LABEL_COLOR = '#8b939c';
export const REL_LABEL_COLOR_ACTIVE = '#4a5568';

export const EDGE_STROKE = '#a5abb3';
export const EDGE_STROKE_ACTIVE = '#c9a227';
export const EDGE_STROKE_DIMMED = '#d5d9de';

export const REL_THEME: Record<string, { label: string }> = {
  NEXT:         { label: '下一步' },
  BRANCH_TO:    { label: '分支' },
  APPLIES_TO:   { label: '法律依据' },
  REQUIRES:     { label: '需要证据' },
  MAY_REQUIRE:  { label: '可能需要' },
  REFERS_TO:    { label: '参考案例' },
  KEY_EVIDENCE: { label: '关键证据' },
  CITES:        { label: '援引法规' },
  RELATED:      { label: '关联' },
};

/** 关系边显示文案：优先中文 label，其次类型映射 */
export function getRelDisplayLabel(edge: { type: string; label: string | null }): string {
  const custom = edge.label?.trim();
  if (custom) return custom;
  return REL_THEME[edge.type]?.label ?? edge.type;
}

/** 关系越多节点越大 */
export function getNodeRadius(_type: KgNodeType, degree: number): number {
  const bonus = Math.min(Math.max(degree - 1, 0) * 3, 16);
  return NODE_RADIUS + bonus;
}

export function getCollisionRadius(nodeRadius: number): number {
  return nodeRadius + 32;
}

export function getHaloRadius(nodeRadius: number): number {
  return nodeRadius + 18;
}
