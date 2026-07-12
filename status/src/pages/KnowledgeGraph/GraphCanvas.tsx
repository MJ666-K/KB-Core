/**
 * 知识图谱画布 — 轻力导向散开 + 拖拽固定 + 节点/关系悬停高亮
 */
import { useEffect, useRef, useMemo, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { KgNode, KgEdge } from '../../api/kgApi';
import { computeLayout, computeDegreeMap, getFitTransform, calcFitBounds } from './layout';
import {
  NODE_THEME, EDGE_STROKE, REL_LABEL_COLOR,
  getNodeRadius, getCollisionRadius, getHaloRadius, getRelDisplayLabel,
} from './theme';

export interface GraphCanvasHandle {
  zoomBy: (factor: number) => void;
  fitView: () => void;
  getTransform: () => { k: number; x: number; y: number };
}

interface Props {
  data: { nodes: KgNode[]; edges: KgEdge[] };
  showLabels?: boolean;
  pinnedNodeId?: string | null;
  pinnedEdgeKey?: string | null;
  onNodeClick: (n: KgNode) => void;
  onNodeHover: (n: KgNode | null) => void;
  onEdgeClick: (e: KgEdge) => void;
  onEdgeHover: (e: KgEdge | null) => void;
  onNodeDoubleClick?: (n: KgNode) => void;
  onTransformChange?: (t: { k: number; x: number; y: number }) => void;
  onBackgroundClick?: () => void;
}

interface SimNode extends KgNode, d3.SimulationNodeDatum {
  x: number;
  y: number;
  radius: number;
}

interface DrawLink extends KgEdge {
  key: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  key: string;
  from: string;
  to: string;
  type: string;
  solid: boolean;
  label: string | null;
}

interface FocusState {
  nodeId: string | null;
  edgeKey: string | null;
  relatedIds: Set<string>;
  relatedEdgeKeys: Set<string>;
}

export function makeEdgeKey(e: { from: string; to: string; type: string }): string {
  return `${e.from}|${e.to}|${e.type}`;
}

function buildNodeFocus(nodeId: string, edges: KgEdge[]): FocusState {
  const relatedIds = new Set<string>();
  const relatedEdgeKeys = new Set<string>();
  for (const e of edges) {
    if (e.from === nodeId || e.to === nodeId) {
      relatedEdgeKeys.add(makeEdgeKey(e));
      relatedIds.add(e.from === nodeId ? e.to : e.from);
    }
  }
  return { nodeId, edgeKey: null, relatedIds, relatedEdgeKeys };
}

function buildEdgeFocus(edgeKey: string, edge: KgEdge): FocusState {
  return {
    nodeId: null,
    edgeKey,
    relatedIds: new Set([edge.from, edge.to]),
    relatedEdgeKeys: new Set([edgeKey]),
  };
}

function resolveFocus(
  hoverNodeId: string | null,
  hoverEdgeKey: string | null,
  pinnedNodeId: string | null | undefined,
  pinnedEdgeKey: string | null | undefined,
  edges: KgEdge[],
  edgeByKey: Map<string, DrawLink>,
): FocusState {
  if (hoverEdgeKey) {
    const e = edgeByKey.get(hoverEdgeKey);
    if (e) return buildEdgeFocus(hoverEdgeKey, e);
  }
  if (hoverNodeId) return buildNodeFocus(hoverNodeId, edges);
  if (pinnedEdgeKey) {
    const e = edgeByKey.get(pinnedEdgeKey);
    if (e) return buildEdgeFocus(pinnedEdgeKey, e);
  }
  if (pinnedNodeId) return buildNodeFocus(pinnedNodeId, edges);
  return { nodeId: null, edgeKey: null, relatedIds: new Set(), relatedEdgeKeys: new Set() };
}

function linkEndpoints(from: SimNode, to: SimNode): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const arrowPad = 8;
  return {
    x1: from.x + ux * from.radius,
    y1: from.y + uy * from.radius,
    x2: to.x - ux * (to.radius + arrowPad),
    y2: to.y - uy * (to.radius + arrowPad),
  };
}

function emptyFocus(): FocusState {
  return { nodeId: null, edgeKey: null, relatedIds: new Set(), relatedEdgeKeys: new Set() };
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(
  {
    data, showLabels = true,
    pinnedNodeId, pinnedEdgeKey,
    onNodeClick, onNodeHover, onEdgeClick, onEdgeHover,
    onNodeDoubleClick, onTransformChange, onBackgroundClick,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef({ k: 1, x: 0, y: 0 });
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const dragPositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const userDraggedIdsRef = useRef(new Set<string>());
  const dragSettleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDraggingRef = useRef(false);
  const hoverNodeIdRef = useRef<string | null>(null);
  const hoverEdgeKeyRef = useRef<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const introRunningRef = useRef(false);
  const graphRef = useRef<{
    nodeSel: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
    linkSel: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;
    linkHitSel: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;
    linkLabelSel: d3.Selection<SVGTextElement, SimLink, SVGGElement, unknown> | null;
    edgeByKey: Map<string, DrawLink>;
  } | null>(null);

  const callbacksRef = useRef({
    onNodeClick, onNodeHover, onEdgeClick, onEdgeHover, onNodeDoubleClick, onTransformChange, onBackgroundClick,
  });
  callbacksRef.current = {
    onNodeClick, onNodeHover, onEdgeClick, onEdgeHover, onNodeDoubleClick, onTransformChange, onBackgroundClick,
  };

  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);

  const degreeMap = useMemo(() => computeDegreeMap(data.edges), [data.edges]);

  const layout = useMemo(() => {
    if (canvasSize.width < 50 || canvasSize.height < 50) return null;
    return computeLayout(data.nodes, data.edges, canvasSize.width, canvasSize.height);
  }, [data, canvasSize]);

  const applyFit = useCallback((animate = false) => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    const { width, height } = svgEl.getBoundingClientRect();
    if (width < 50 || height < 50) return;
    const nodes = simNodesRef.current;
    if (nodes.length === 0) return;
    const bounds = calcFitBounds(nodes.map(n => ({ x: n.x, y: n.y, radius: n.radius })));
    const fit = getFitTransform(bounds, width, height);
    const sel = d3.select(svgEl);
    const transform = d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k);
    if (animate) {
      sel.transition().duration(480).ease(d3.easeCubicOut)
        .call(zoom.transform, transform);
    } else {
      sel.call(zoom.transform, transform);
    }
    transformRef.current = fit;
    callbacksRef.current.onTransformChange?.(fit);
  }, []);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        setCanvasSize(prev => (
          Math.round(prev.width) === Math.round(rect.width)
          && Math.round(prev.height) === Math.round(rect.height)
            ? prev
            : { width: rect.width, height: rect.height }
        ));
      }
    };
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const edgeByKey = useMemo(() => {
    const m = new Map<string, DrawLink>();
    for (const e of data.edges) {
      m.set(makeEdgeKey(e), { ...e, key: makeEdgeKey(e) });
    }
    return m;
  }, [data.edges]);

  const applyFocus = useCallback((focus: FocusState) => {
    if (isDraggingRef.current) {
      focus = emptyFocus();
    }
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    const hasFocus = !!(focus.nodeId || focus.edgeKey);

    svg.selectAll<SVGGElement, SimNode>('.kg-node')
      .classed('is-focused', d => d.id === focus.nodeId)
      .classed('is-related', d => hasFocus && focus.relatedIds.has(d.id))
      .classed('is-dimmed', d => hasFocus && d.id !== focus.nodeId && !focus.relatedIds.has(d.id));

    svg.selectAll<SVGLineElement, SimLink>('.kg-link')
      .classed('is-edge-focused', d => d.key === focus.edgeKey)
      .classed('is-highlighted', d => focus.relatedEdgeKeys.has(d.key) && d.key !== focus.edgeKey)
      .classed('is-dimmed', d => hasFocus && !focus.relatedEdgeKeys.has(d.key));

    svg.selectAll<SVGTextElement, SimLink>('.kg-rel-type')
      .classed('is-edge-focused', d => d.key === focus.edgeKey)
      .classed('is-highlighted', d => focus.relatedEdgeKeys.has(d.key) && d.key !== focus.edgeKey)
      .classed('is-dimmed', d => hasFocus && !focus.relatedEdgeKeys.has(d.key));
  }, []);

  const refreshScene = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const { nodeSel, linkSel, linkHitSel, linkLabelSel } = g;

    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);

    linkSel.each(function (d) {
      const s = d.source as SimNode;
      const t = d.target as SimNode;
      const ep = linkEndpoints(s, t);
      d3.select(this).attr('x1', ep.x1).attr('y1', ep.y1).attr('x2', ep.x2).attr('y2', ep.y2);
    });

    linkHitSel.each(function (d) {
      const s = d.source as SimNode;
      const t = d.target as SimNode;
      const ep = linkEndpoints(s, t);
      d3.select(this).attr('x1', ep.x1).attr('y1', ep.y1).attr('x2', ep.x2).attr('y2', ep.y2);
    });

    if (linkLabelSel) {
      linkLabelSel.each(function (d) {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        d3.select(this).attr('x', (s.x + t.x) / 2).attr('y', (s.y + t.y) / 2);
      });
    }
  }, []);

  const clearHover = useCallback(() => {
    hoverNodeIdRef.current = null;
    hoverEdgeKeyRef.current = null;
    setHoverNodeId(null);
    setHoverEdgeKey(null);
    callbacksRef.current.onNodeHover(null);
    callbacksRef.current.onEdgeHover(null);
  }, []);

  const setHoverNode = useCallback((node: SimNode | null) => {
    if (isDraggingRef.current) return;
    const nextId = node?.id ?? null;
    if (hoverNodeIdRef.current === nextId && !hoverEdgeKeyRef.current) return;
    hoverNodeIdRef.current = nextId;
    hoverEdgeKeyRef.current = null;
    setHoverNodeId(nextId);
    setHoverEdgeKey(null);
    callbacksRef.current.onNodeHover(node);
    callbacksRef.current.onEdgeHover(null);
  }, []);

  const setHoverEdge = useCallback((edge: DrawLink | null) => {
    if (isDraggingRef.current) return;
    const nextKey = edge?.key ?? null;
    if (hoverEdgeKeyRef.current === nextKey && !hoverNodeIdRef.current) return;
    hoverEdgeKeyRef.current = nextKey;
    hoverNodeIdRef.current = null;
    setHoverEdgeKey(nextKey);
    setHoverNodeId(null);
    callbacksRef.current.onEdgeHover(edge);
    callbacksRef.current.onNodeHover(null);
  }, []);

  const syncHoverFromPointer = useCallback((event: PointerEvent | MouseEvent) => {
    if (isDraggingRef.current) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (!under) {
      clearHover();
      return;
    }
    const linkEl = under.closest('.kg-link-hit');
    if (linkEl) {
      const datum = d3.select(linkEl).datum() as SimLink | undefined;
      if (datum) {
        const edge = edgeByKey.get(datum.key);
        if (edge) {
          setHoverEdge(edge);
          return;
        }
      }
    }
    const nodeEl = under.closest('.kg-node');
    if (nodeEl) {
      const datum = d3.select(nodeEl).datum() as SimNode | undefined;
      if (datum) {
        setHoverNode(datum);
        return;
      }
    }
    clearHover();
  }, [clearHover, edgeByKey, setHoverEdge, setHoverNode]);

  useEffect(() => {
    const focus = resolveFocus(hoverNodeId, hoverEdgeKey, pinnedNodeId, pinnedEdgeKey, data.edges, edgeByKey);
    applyFocus(focus);
  }, [hoverNodeId, hoverEdgeKey, pinnedNodeId, pinnedEdgeKey, data.edges, edgeByKey, applyFocus]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.nodes.length === 0 || !layout) return;

    simulationRef.current?.stop();

    const ids = new Set(data.nodes.map(n => n.id));
    for (const id of dragPositionsRef.current.keys()) {
      if (!ids.has(id)) dragPositionsRef.current.delete(id);
    }
    for (const id of userDraggedIdsRef.current) {
      if (!ids.has(id)) userDraggedIdsRef.current.delete(id);
    }

    const { width, height } = svgEl.getBoundingClientRect();
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const simNodes: SimNode[] = data.nodes.map(n => {
      const dragged = dragPositionsRef.current.get(n.id);
      const pos = dragged ?? layout.positions.get(n.id) ?? { x: width / 2, y: height / 2 };
      const radius = getNodeRadius(n.type, degreeMap.get(n.id) ?? 0);
      const node: SimNode = { ...n, x: pos.x, y: pos.y, radius };
      if (dragged) {
        node.fx = dragged.x;
        node.fy = dragged.y;
      }
      return node;
    });
    simNodesRef.current = simNodes;

    const drawLinks: DrawLink[] = data.edges
      .filter(e => ids.has(e.from) && ids.has(e.to))
      .map(e => ({ ...e, key: makeEdgeKey(e) }));

    const simLinks: SimLink[] = drawLinks.map(e => ({
      ...e,
      source: e.from,
      target: e.to,
    }));

    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'kg-arrow')
      .attr('viewBox', '0 -3 6 6')
      .attr('refX', 6)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-3L6,0L0,3')
      .attr('fill', EDGE_STROKE);

    const zoomLayer = svg.append('g').attr('class', 'kg-zoom-layer');
    const linkG = zoomLayer.append('g').attr('class', 'kg-links');
    const linkLabelG = zoomLayer.append('g').attr('class', 'kg-link-labels');
    const linkHitG = zoomLayer.append('g').attr('class', 'kg-link-hits');

    const linkSel = linkG.selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, d => d.key)
      .enter().append('line')
      .attr('class', 'kg-link')
      .attr('stroke', EDGE_STROKE)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', d => d.solid ? '0' : '5,4')
      .attr('marker-end', 'url(#kg-arrow)')
      .attr('pointer-events', 'none');

    const linkHitSel = linkHitG.selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, d => d.key)
      .enter().append('line')
      .attr('class', 'kg-link-hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 16)
      .style('cursor', 'pointer')
      .on('click', (ev, d) => {
        ev.stopPropagation();
        const edge = edgeByKey.get(d.key);
        if (edge) callbacksRef.current.onEdgeClick(edge);
      });

    const linkLabelSel = showLabels
      ? linkLabelG.selectAll<SVGTextElement, SimLink>('text')
        .data(simLinks, d => d.key)
        .enter().append('text')
        .attr('class', 'kg-rel-type')
        .attr('fill', REL_LABEL_COLOR)
        .text(d => truncate(getRelDisplayLabel(d), 14))
        .attr('pointer-events', 'none')
      : null;

    const linkForce = d3.forceLink<SimNode, SimLink>(simLinks)
      .id(d => d.id)
      .distance(d => {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        return s.radius + t.radius + (d.solid ? 96 : 72);
      })
      .strength(0.55);
    const chargeForce = d3.forceManyBody<SimNode>().strength(d => -300 - d.radius * 6);
    const centerForce = d3.forceCenter(width / 2, height / 2).strength(0.03);
    const collisionForce = d3.forceCollide<SimNode>()
      .radius(d => getCollisionRadius(d.radius) + 4)
      .strength(0.92);

    function enterDragLayoutMode(draggedId: string) {
      const sim = simulationRef.current;
      if (!sim) return;
      for (const n of simNodesRef.current) {
        if (n.id !== draggedId) {
          n.fx = null;
          n.fy = null;
        }
      }
      linkForce.strength(0.06);
      chargeForce.strength(-100);
      collisionForce.strength(0.98);
      sim.force('center', null);
      sim.alphaTarget(0.05).alpha(0.14).restart();
    }

    function exitDragLayoutMode() {
      const sim = simulationRef.current;
      if (!sim) return;
      linkForce.strength(0.55);
      chargeForce.strength(d => -300 - d.radius * 6);
      collisionForce.strength(0.92);
      sim.force('center', centerForce);
    }

    function runDragTicks(count = 3) {
      const sim = simulationRef.current;
      if (!sim) return;
      for (let i = 0; i < count; i++) sim.tick();
      refreshScene();
    }

    function clearDragSettleTimer() {
      if (dragSettleTimerRef.current != null) {
        window.clearInterval(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
    }

    const nodeSel = zoomLayer.append('g').attr('class', 'kg-nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, d => d.id)
      .enter().append('g')
      .attr('class', d => `kg-node kg-node--${d.type.toLowerCase()}`)
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('cursor', 'grab')
      .on('click', (ev, d) => { ev.stopPropagation(); callbacksRef.current.onNodeClick(d); })
      .on('dblclick', (ev, d) => { ev.stopPropagation(); callbacksRef.current.onNodeDoubleClick?.(d); })
      .call(d3.drag<SVGGElement, SimNode>()
        .on('start', function (event, d) {
          event.sourceEvent.stopPropagation();
          isDraggingRef.current = true;
          clearHover();
          applyFocus(emptyFocus());
          clearDragSettleTimer();

          d.fx = d.x;
          d.fy = d.y;
          enterDragLayoutMode(d.id);
          d3.select(this).style('cursor', 'grabbing');
        })
        .on('drag', function (event, d) {
          const [gx, gy] = d3.pointer(event, zoomLayer.node());
          d.fx = gx;
          d.fy = gy;
          d.x = gx;
          d.y = gy;
          dragPositionsRef.current.set(d.id, { x: gx, y: gy });
          runDragTicks(4);
          keepNodeInView(gx, gy, width, height);
          panWhileDragging(event.sourceEvent as MouseEvent);
        })
        .on('end', function (event, d) {
          clearDragSettleTimer();
          d.fx = d.x;
          d.fy = d.y;
          d.vx = 0;
          d.vy = 0;
          if (d.fx != null && d.fy != null) {
            dragPositionsRef.current.set(d.id, { x: d.fx, y: d.fy });
            userDraggedIdsRef.current.add(d.id);
          }
          d3.select(this).style('cursor', 'grab');
          isDraggingRef.current = false;

          const sim = simulationRef.current;
          if (sim) {
            exitDragLayoutMode();
            sim.alphaTarget(0.04).alpha(0.1).restart();
            let settleCount = 0;
            dragSettleTimerRef.current = window.setInterval(() => {
              settleCount++;
              if (settleCount >= 18 || sim.alpha() < 0.012) {
                clearDragSettleTimer();
                sim.stop();
                sim.alphaTarget(0);
                freezeAllNodes(simNodesRef.current);
                refreshScene();
              }
            }, 16);
          } else {
            freezeAllNodes(simNodesRef.current);
          }

          const src = event.sourceEvent as PointerEvent | MouseEvent | undefined;
          if (src) syncHoverFromPointer(src);
        }));

    nodeSel.each(function (d) {
      const g = d3.select(this);
      const theme = NODE_THEME[d.type];
      const haloR = getHaloRadius(d.radius);

      g.append('circle')
        .attr('class', 'kg-node-halo')
        .attr('r', haloR)
        .attr('fill', 'none')
        .attr('stroke', '#c8ccd0')
        .attr('stroke-width', 12)
        .attr('opacity', 0);

      g.append('circle')
        .attr('class', 'kg-node-circle')
        .attr('r', d.radius)
        .attr('fill', theme.fill)
        .attr('stroke', theme.stroke)
        .attr('stroke-width', 1.5);

      if (showLabels) {
        g.append('text')
          .attr('class', 'kg-node-caption')
          .attr('text-anchor', 'middle')
          .attr('dy', d.radius + 14)
          .text(truncate(d.label, 22));
      }
    });

    graphRef.current = { nodeSel, linkSel, linkHitSel, linkLabelSel, edgeByKey };

    function freezeAllNodes(nodes: SimNode[]) {
      for (const n of nodes) {
        n.fx = n.x;
        n.fy = n.y;
        n.vx = 0;
        n.vy = 0;
      }
    }

    function releaseNodesForLayout(nodes: SimNode[]) {
      for (const n of nodes) {
        if (userDraggedIdsRef.current.has(n.id)) {
          const p = dragPositionsRef.current.get(n.id);
          if (p) {
            n.x = p.x;
            n.y = p.y;
            n.fx = p.x;
            n.fy = p.y;
          }
        } else {
          n.fx = null;
          n.fy = null;
        }
        n.vx = 0;
        n.vy = 0;
      }
    }

    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', linkForce)
      .force('charge', chargeForce)
      .force('center', centerForce)
      .force('collision', collisionForce)
      .velocityDecay(0.48)
      .alphaDecay(0.022)
      .on('tick', () => refreshScene());

    simulation.stop();
    simulation.alpha(0);
    simulationRef.current = simulation;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .filter((event) => {
        const target = event.target as Element;
        return !target.closest?.('.kg-node');
      })
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        zoomLayer.attr('transform', event.transform.toString());
        transformRef.current = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
        callbacksRef.current.onTransformChange?.(transformRef.current);
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    zoomLayer
      .style('pointer-events', 'all');

    svg
      .on('pointermove', (event) => syncHoverFromPointer(event))
      .on('pointerleave', () => clearHover());

    svg.on('click', (event) => {
      const el = event.target as Element;
      if (el.closest('.kg-node') || el.closest('.kg-link-hit')) return;
      clearHover();
      callbacksRef.current.onBackgroundClick?.();
    });

    function keepNodeInView(gx: number, gy: number, vw: number, vh: number) {
      const svgEl = svgRef.current;
      const zoom = zoomRef.current;
      if (!svgEl || !zoom) return;
      const t = transformRef.current;
      const sx = gx * t.k + t.x;
      const sy = gy * t.k + t.y;
      const margin = 56;
      let dx = 0;
      let dy = 0;
      if (sx < margin) dx = (margin - sx) / t.k;
      if (sx > vw - margin) dx = -(sx - vw + margin) / t.k;
      if (sy < margin) dy = (margin - sy) / t.k;
      if (sy > vh - margin) dy = -(sy - vh + margin) / t.k;
      if (dx || dy) {
        d3.select(svgEl).call(zoom.translateBy, dx, dy);
      }
    }

    function panWhileDragging(ev: MouseEvent) {
      const svgEl = svgRef.current;
      const zoom = zoomRef.current;
      if (!svgEl || !zoom) return;
      const rect = svgEl.getBoundingClientRect();
      const margin = 64;
      const k = transformRef.current.k;
      let dx = 0;
      let dy = 0;
      if (ev.clientX - rect.left < margin) dx = (margin - (ev.clientX - rect.left)) * 0.22 / k;
      if (rect.right - ev.clientX < margin) dx = -((margin - (rect.right - ev.clientX)) * 0.22) / k;
      if (ev.clientY - rect.top < margin) dy = (margin - (ev.clientY - rect.top)) * 0.22 / k;
      if (rect.bottom - ev.clientY < margin) dy = -((margin - (rect.bottom - ev.clientY)) * 0.22) / k;
      if (dx || dy) {
        d3.select(svgEl).call(zoom.translateBy, dx, dy);
      }
    }

    const fit = getFitTransform(calcFitBounds(simNodes.map(n => ({ x: n.x, y: n.y, radius: n.radius }))), width, height);
    svg.call(zoom.transform, d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k * 0.88));
    transformRef.current = { ...fit, k: fit.k * 0.88 };
    callbacksRef.current.onTransformChange?.(transformRef.current);

    refreshScene();
    applyFocus(resolveFocus(hoverNodeId, hoverEdgeKey, pinnedNodeId, pinnedEdgeKey, data.edges, edgeByKey));

    releaseNodesForLayout(simNodes);
    simulation.alphaTarget(0.12).alpha(0.55).restart();
    introRunningRef.current = true;
    let tickCount = 0;
    const introTimer = window.setInterval(() => {
      tickCount++;
      if (tickCount >= 90 || simulation.alpha() < 0.018) {
        window.clearInterval(introTimer);
        simulation.alphaTarget(0);
        freezeAllNodes(simNodes);
        simulation.stop();
        introRunningRef.current = false;
        applyFit(true);
      }
    }, 16);

    return () => {
      introRunningRef.current = false;
      clearDragSettleTimer();
      window.clearInterval(introTimer);
      simulation.stop();
      simulationRef.current = null;
      graphRef.current = null;
    };
  }, [data, layout, showLabels, degreeMap, edgeByKey, applyFocus, refreshScene, clearHover, syncHoverFromPointer]);

  useEffect(() => {
    if (simNodesRef.current.length === 0 || canvasSize.width < 50 || introRunningRef.current) return;
    const t = window.setTimeout(() => applyFit(true), 120);
    return () => window.clearTimeout(t);
  }, [canvasSize.width, canvasSize.height, applyFit]);

  useImperativeHandle(ref, () => ({
    zoomBy(factor: number) {
      const svgEl = svgRef.current;
      const zoom = zoomRef.current;
      if (!svgEl || !zoom) return;
      d3.select(svgEl).transition().duration(200).call(zoom.scaleBy, factor);
    },
    fitView() {
      applyFit(true);
    },
    getTransform: () => transformRef.current,
  }), [applyFit]);

  return <svg ref={svgRef} className="kg-canvas kg-canvas--neo4j" />;
});

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
