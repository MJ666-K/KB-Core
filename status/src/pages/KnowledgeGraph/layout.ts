/**
 * 力导向布局 — 初始排布，收敛后冻结坐标
 */
import * as d3 from 'd3';
import type { KgEdge, KgNode } from '../../api/kgApi';
import { getCollisionRadius, getNodeRadius } from './theme';

export interface LayoutPosition { x: number; y: number }

export interface LayoutResult {
  positions: Map<string, LayoutPosition>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
}

interface SimNode extends KgNode, d3.SimulationNodeDatum {
  radius: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  type: string;
  solid: boolean;
  label: string | null;
}

const positionCache = new Map<string, Map<string, LayoutPosition>>();

function cacheKey(nodes: KgNode[], edges: KgEdge[], width: number, height: number): string {
  const n = [...nodes].map(x => x.id).sort().join(',');
  const e = [...edges].map(x => `${x.from}->${x.to}:${x.type}`).sort().join(',');
  return `${n}|${e}|${Math.round(width)}x${Math.round(height)}`;
}

export function computeDegreeMap(edges: KgEdge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return deg;
}

export function computeLayout(
  nodes: KgNode[],
  edges: KgEdge[],
  width = 900,
  height = 600,
): LayoutResult {
  const key = cacheKey(nodes, edges, width, height);
  const cached = positionCache.get(key);
  if (cached) {
    return { positions: cached, bounds: calcBounds(cached, nodes, edges) };
  }

  const degreeMap = computeDegreeMap(edges);
  const cx = width / 2;
  const cy = height / 2;
  const spread = Math.min(width, height) * Math.min(0.34 + Math.sqrt(nodes.length) * 0.014, 0.52);
  const categories = [...new Set(nodes.map(n => n.category).filter(Boolean))];
  const multiCategory = categories.length > 1;

  const categoryX = (cat: string): number => {
    if (!multiCategory) return cx;
    const idx = categories.indexOf(cat);
    if (idx < 0) return cx;
    const slot = (idx + 0.5) / categories.length;
    return width * (0.22 + slot * 0.56);
  };

  const categoryY = (_cat: string): number => cy;

  const simNodes: SimNode[] = nodes.map(n => ({
    ...n,
    radius: getNodeRadius(n.type, degreeMap.get(n.id) ?? 0),
    x: cx + (Math.random() - 0.5) * spread * 2,
    y: cy + (Math.random() - 0.5) * spread * 2,
  }));

  const nodeIndex = new Map(simNodes.map(n => [n.id, n]));
  const links: SimLink[] = edges
    .filter(e => nodeIndex.has(e.from) && nodeIndex.has(e.to))
    .map(e => ({
      source: e.from,
      target: e.to,
      type: e.type,
      solid: e.solid,
      label: e.label,
    }));

  const simulation = d3.forceSimulation<SimNode>(simNodes)
    .force('link', d3.forceLink<SimNode, SimLink>(links)
      .id(d => d.id)
      .distance(d => {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        const base = s.radius + t.radius + (d.solid ? 72 : 56);
        return base + Math.min(nodes.length * 0.5, 24);
      })
      .strength(0.5))
    .force('charge', d3.forceManyBody<SimNode>().strength(d => -220 - d.radius * 4))
    .force('center', d3.forceCenter(cx, cy).strength(multiCategory ? 0.04 : 0.1))
    .force('collision', d3.forceCollide<SimNode>().radius(d => getCollisionRadius(d.radius)))
    .velocityDecay(0.42)
    .alphaDecay(0.028)
    .stop();

  if (multiCategory) {
    simulation.force('x', d3.forceX<SimNode>(d => categoryX(d.category)).strength(0.1));
    simulation.force('y', d3.forceY<SimNode>(() => categoryY('')).strength(0.08));
  }

  for (let i = 0; i < 450 && simulation.alpha() > 0.001; i++) {
    simulation.tick();
  }

  const positions = new Map<string, LayoutPosition>();
  for (const n of simNodes) {
    positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  }

  const expanded = expandPositionsToViewport(positions, width, height, 0.9);
  positionCache.set(key, expanded);

  return { positions: expanded, bounds: calcBounds(expanded, nodes, edges) };
}

/** 将布局结果缩放平移，占满画布目标区域 */
export function expandPositionsToViewport(
  positions: Map<string, LayoutPosition>,
  width: number,
  height: number,
  fill = 0.9,
): Map<string, LayoutPosition> {
  const pts = [...positions.values()];
  if (pts.length === 0) return positions;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const bw = Math.max(maxX - minX, 80);
  const bh = Math.max(maxY - minY, 80);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const targetW = width * fill;
  const targetH = height * fill;
  const scale = Math.min(targetW / bw, targetH / bh);

  const out = new Map<string, LayoutPosition>();
  for (const [id, p] of positions) {
    out.set(id, {
      x: width / 2 + (p.x - cx) * scale,
      y: height / 2 + (p.y - cy) * scale,
    });
  }
  return out;
}

export function calcSymmetricBounds(
  points: Array<{ x: number; y: number; radius: number }>,
): LayoutResult['bounds'] {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    const r = getCollisionRadius(p.radius);
    minX = Math.min(minX, p.x - r);
    minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r);
    maxY = Math.max(maxY, p.y + r);
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;
  const halfW = Math.max(maxX - cx, cx - minX, 80);
  const halfH = Math.max(maxY - cy, cy - minY, 80);
  const pad = 36;
  minX = cx - halfW - pad;
  maxX = cx + halfW + pad;
  minY = cy - halfH - pad;
  maxY = cy + halfH + pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function calcBounds(
  positions: Map<string, LayoutPosition>,
  nodes: KgNode[],
  edges: KgEdge[],
): LayoutResult['bounds'] {
  const degreeMap = computeDegreeMap(edges);
  const points = nodes.flatMap(n => {
    const p = positions.get(n.id);
    if (!p) return [];
    return [{ x: p.x, y: p.y, radius: getNodeRadius(n.type, degreeMap.get(n.id) ?? 0) }];
  });
  return calcSymmetricBounds(points);
}

export function calcFitBounds(
  points: Array<{ x: number; y: number; radius: number }>,
): LayoutResult['bounds'] {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const r = getCollisionRadius(p.radius) + 12;
    minX = Math.min(minX, p.x - r);
    minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r);
    maxY = Math.max(maxY, p.y + r);
  }
  const pad = 12;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function getFitTransform(
  bounds: LayoutResult['bounds'],
  width: number,
  height: number,
): { k: number; x: number; y: number } {
  if (bounds.width <= 0 || bounds.height <= 0) return { k: 1, x: 0, y: 0 };
  const margin = 20;
  const k = Math.min(
    (width - margin * 2) / bounds.width,
    (height - margin * 2) / bounds.height,
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
}

export function invalidateLayoutCache(): void {
  positionCache.clear();
}
