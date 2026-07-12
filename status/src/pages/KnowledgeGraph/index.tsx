/**
 * 知识图谱页面 — 左侧 Dock 控制栏 + 全屏画布
 */
import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  Input, InputNumber, message, Empty, Spin, Tooltip,
} from 'antd';
import {
  ZoomInOutlined, ZoomOutOutlined, FullscreenOutlined,
  SearchOutlined, ArrowLeftOutlined,
  ApartmentOutlined, TeamOutlined, HomeOutlined, FileSearchOutlined,
  NodeIndexOutlined, ShareAltOutlined,
} from '@ant-design/icons';
import { kgApi, type KgNode, type KgEdge, type KgSubgraph } from '../../api/kgApi';
import { GraphCanvas, type GraphCanvasHandle, makeEdgeKey } from './GraphCanvas';
import { GraphDetailPanel, type GraphPanelTarget } from './GraphDetailPanel';
import { NODE_THEME, TYPE_LABEL_ZH, getRelDisplayLabel } from './theme';
import { invalidateLayoutCache } from './layout';

const { Search } = Input;

interface ViewPreset {
  label: string;
  desc: string;
  icon: ReactNode;
  rootIds: string[];
  category?: string;
  full?: boolean;
}

const VIEW_PRESETS: ViewPreset[] = [
  {
    label: '全部',
    desc: '完整知识库图谱',
    icon: <ApartmentOutlined />,
    rootIds: [],
    full: true,
  },
  {
    label: '劳动调解全流程',
    desc: '从申请到归档',
    icon: <TeamOutlined />,
    rootIds: ['flow_labor_apply'],
    category: '劳动调解',
  },
  {
    label: '邻里调解全流程',
    desc: '从登记到回访',
    icon: <HomeOutlined />,
    rootIds: ['flow_neighbor_register'],
    category: '邻里调解',
  },
  {
    label: '劳动调解 + 关键证据',
    desc: '流程与核心材料',
    icon: <FileSearchOutlined />,
    rootIds: ['flow_labor_apply', 'flow_labor_meeting'],
    category: '劳动调解',
  },
];

const DEFAULT_VIEW = VIEW_PRESETS[0]!;

function pickKgNode(node: KgNode): KgNode {
  return {
    id: node.id,
    label: node.label,
    category: node.category,
    type: node.type,
    chunkId: node.chunkId,
    stepOrder: node.stepOrder,
    meta: node.meta && typeof node.meta === 'object' ? node.meta : {},
  };
}

interface ViewHistoryEntry {
  view: ViewPreset;
  depth: number;
}

export default function KnowledgeGraph() {
  const [data, setData] = useState<KgSubgraph>({ nodes: [], edges: [] });
  const [pinned, setPinned] = useState<GraphPanelTarget | null>(null);
  const [hovered, setHovered] = useState<GraphPanelTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [depth, setDepth] = useState(3);
  const [currentView, setCurrentView] = useState<ViewPreset>(DEFAULT_VIEW);
  const [viewHistory, setViewHistory] = useState<ViewHistoryEntry[]>([]);
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  const [panelOpen, setPanelOpen] = useState(true);

  const canvasRef = useRef<GraphCanvasHandle>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  const nodeMap = useMemo(
    () => new Map(data.nodes.map(n => [n.id, n])),
    [data.nodes],
  );

  const panelTarget = panelOpen ? (hovered ?? pinned) : null;
  const isPinned = panelOpen && pinned != null && hovered == null;

  const clearSelection = useCallback(() => {
    setPinned(null);
    setHovered(null);
  }, []);

  const hidePanel = useCallback(() => {
    setPanelOpen(false);
    clearSelection();
  }, [clearSelection]);

  const applyHover = useCallback((next: GraphPanelTarget | null) => {
    if (!panelOpen) return;
    setHovered(next);
  }, [panelOpen]);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
  }, []);

  const toEdgeTarget = useCallback((e: KgEdge): GraphPanelTarget => {
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    return {
      kind: 'edge',
      edge: e,
      fromLabel: fromNode?.label ?? e.from,
      toLabel: toNode?.label ?? e.to,
      fromType: fromNode?.type,
      toType: toNode?.type,
    };
  }, [nodeMap]);

  const fetchSubgraph = useCallback(async (
    view: ViewPreset,
    d: number,
    options?: { recordHistory?: boolean },
  ) => {
    setLoading(true);
    try {
      if (options?.recordHistory) {
        setViewHistory(prev => [...prev, { view: currentView, depth }]);
      }
      const result = await kgApi.subgraph(view.rootIds, d, view.category, view.full);
      setData(result);
      setCurrentView(view);
      setDepth(d);
      setPinned(null);
      setHovered(null);
      invalidateLayoutCache();
    } catch (e) {
      message.error('加载子图失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [currentView, depth]);

  useEffect(() => {
    fetchSubgraph(DEFAULT_VIEW, depth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading || data.nodes.length === 0) return;
    const t = window.setTimeout(() => canvasRef.current?.fitView(), 700);
    return () => window.clearTimeout(t);
  }, [loading, data, currentView]);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    try {
      const result = await kgApi.search({ keyword: keyword.trim(), limit: 20 });
      if (result.nodes.length === 0) { message.info('未找到节点'); return; }
      const searchView: ViewPreset = {
        label: `搜索：${keyword.trim()}`,
        desc: `匹配「${keyword.trim()}」`,
        icon: <SearchOutlined />,
        rootIds: result.nodes.slice(0, 5).map(n => n.id),
      };
      await fetchSubgraph(searchView, 1, { recordHistory: true });
    } catch (e) {
      message.error('搜索失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleNodeDblClick = useCallback(async (node: KgNode) => {
    const view: ViewPreset = {
      label: `从「${node.label}」展开`,
      desc: node.category,
      icon: <NodeIndexOutlined />,
      rootIds: [node.id],
      category: node.category,
    };
    await fetchSubgraph(view, 2, { recordHistory: true });
  }, [fetchSubgraph]);

  const goBackView = useCallback(() => {
    setViewHistory(prev => {
      if (prev.length > 0) {
        const next = [...prev];
        const last = next.pop()!;
        void fetchSubgraph(last.view, last.depth);
        return next;
      }
      void fetchSubgraph(DEFAULT_VIEW, depth);
      return prev;
    });
  }, [fetchSubgraph, depth]);

  const canGoBack = viewHistory.length > 0 || currentView.label !== DEFAULT_VIEW.label;

  const applyDepth = (d: number | null) => {
    if (d == null || d < 1 || d > 3) return;
    setDepth(d);
    fetchSubgraph(currentView, d);
  };

  const switchView = (view: ViewPreset) => {
    setViewHistory([]);
    fetchSubgraph(view, depth);
  };

  const typeCounts = data.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});

  const relTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.edges) {
      const label = getRelDisplayLabel(e);
      m.set(label, (m.get(label) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data.edges]);

  const pinnedNodeId = pinned?.kind === 'node' ? pinned.node.id : null;
  const pinnedEdgeKey = pinned?.kind === 'edge' ? makeEdgeKey(pinned.edge) : null;

  const totalNodes = data.nodes.length;

  return (
    <div className="kg-page kg-page--immersive has-sidebar">
      <aside className="kg-sidebar kg-sidebar--dock is-open">
        <div className="kg-sidebar__body">
          <div className="kg-sidebar__top">
            <div className="kg-sidebar__block kg-sidebar__block--search">
              <Search
                placeholder="搜索节点…"
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onSearch={handleSearch}
                allowClear
                size="small"
              />
            </div>

            <div className="kg-sidebar__stats kg-sidebar__stats--inline">
              <span className="kg-stat-inline"><NodeIndexOutlined /> {data.nodes.length} 节点</span>
              <span className="kg-stat-inline"><ShareAltOutlined /> {data.edges.length} 关系</span>
            </div>

            <div className="kg-sidebar__depth-row">
              <span className="kg-sidebar__field-label">展开深度</span>
              <InputNumber
                min={1}
                max={3}
                size="small"
                value={depth}
                onChange={applyDepth}
                controls
              />
            </div>

            <div className="kg-sidebar__block kg-sidebar__block--views">
              <div className="kg-sidebar__block-title">视角</div>
              <div className="kg-root-list">
                {VIEW_PRESETS.map(view => (
                  <button
                    key={view.label}
                    type="button"
                    className={`kg-root-btn${currentView.label === view.label ? ' is-active' : ''}`}
                    onClick={() => switchView(view)}
                  >
                    <span className="kg-root-btn__icon">{view.icon}</span>
                    <span className="kg-root-btn__text">
                      <span className="kg-root-btn__label">{view.label}</span>
                      <span className="kg-root-btn__desc">{view.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="kg-sidebar__scroll">
            {totalNodes > 0 && (
              <div className="kg-sidebar__block kg-sidebar__block--legend">
                <div className="kg-sidebar__block-title kg-sidebar__block-title--accent">节点类型</div>
                <div className="kg-legend-list">
                  {(Object.keys(NODE_THEME) as Array<keyof typeof NODE_THEME>).map(type => {
                    const t = NODE_THEME[type];
                    const count = typeCounts[type] ?? 0;
                    if (count === 0) return null;
                    const pct = totalNodes > 0 ? Math.round((count / totalNodes) * 100) : 0;
                    return (
                      <div key={type} className="kg-legend-item">
                        <span className="kg-legend-dot" style={{ background: t.fill }} />
                        <span className="kg-legend-name">{TYPE_LABEL_ZH[type]}</span>
                        <div className="kg-legend-bar-wrap">
                          <div className="kg-legend-bar" style={{ width: `${pct}%`, background: t.fill }} />
                        </div>
                        <span className="kg-legend-count">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {relTypeCounts.length > 0 && (
              <div className="kg-sidebar__block kg-sidebar__block--rel">
                <div className="kg-sidebar__block-title kg-sidebar__block-title--muted">关系分布</div>
                <div className="kg-rel-dist">
                  {relTypeCounts.map(([label, count]) => (
                    <div key={label} className="kg-rel-dist__row">
                      <span className="kg-rel-dist__label">{label}</span>
                      <div className="kg-rel-dist__bar-wrap">
                        <div
                          className="kg-rel-dist__bar"
                          style={{ width: `${Math.round((count / data.edges.length) * 100)}%` }}
                        />
                      </div>
                      <span className="kg-rel-dist__count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div ref={canvasWrapRef} className="kg-canvas-wrap">
        {canGoBack && !loading && (
          <div className="kg-view-back">
            <div className="kg-view-back__bar">
              <button type="button" className="kg-view-back__btn" onClick={goBackView}>
                <span className="kg-view-back__btn-icon" aria-hidden>
                  <ArrowLeftOutlined />
                </span>
                <span className="kg-view-back__btn-text">
                  {viewHistory.length > 0 ? '上一视图' : '全部图谱'}
                </span>
              </button>
              <span className="kg-view-back__sep" aria-hidden />
              <span className="kg-view-back__crumb" title={currentView.label}>
                {currentView.label}
              </span>
            </div>
          </div>
        )}

        {loading && <div className="kg-canvas-loading"><Spin tip="加载中…" /></div>}

        {!loading && data.nodes.length === 0 ? (
          <Empty className="kg-canvas-empty" description="暂无图谱数据" />
        ) : (
          <GraphCanvas
            ref={canvasRef}
            data={data}
            showLabels
            pinnedNodeId={pinnedNodeId}
            pinnedEdgeKey={pinnedEdgeKey}
            onNodeClick={node => { openPanel(); setPinned({ kind: 'node', node: pickKgNode(node) }); }}
            onNodeHover={node => applyHover(node ? { kind: 'node', node: pickKgNode(node) } : null)}
            onEdgeClick={edge => { openPanel(); setPinned(toEdgeTarget(edge)); }}
            onEdgeHover={edge => applyHover(edge ? toEdgeTarget(edge) : null)}
            onNodeDoubleClick={handleNodeDblClick}
            onTransformChange={setTransform}
            onBackgroundClick={clearSelection}
          />
        )}

        {data.nodes.length > 0 && (
          <div className="kg-canvas-footer">
            <div className="kg-zoom-toolbar">
              <Tooltip title="放大"><button type="button" className="kg-zoom-btn" onClick={() => canvasRef.current?.zoomBy(1.25)}><ZoomInOutlined /></button></Tooltip>
              <span className="kg-zoom-pct">{Math.round(transform.k * 100)}%</span>
              <Tooltip title="缩小"><button type="button" className="kg-zoom-btn" onClick={() => canvasRef.current?.zoomBy(0.8)}><ZoomOutOutlined /></button></Tooltip>
              <Tooltip title="适配视图"><button type="button" className="kg-zoom-btn" onClick={() => canvasRef.current?.fitView()}><FullscreenOutlined /></button></Tooltip>
            </div>
          </div>
        )}
      </div>

      <GraphDetailPanel
        visible={panelOpen}
        target={panelTarget}
        pinned={isPinned}
        onClose={hidePanel}
      />
    </div>
  );
}
