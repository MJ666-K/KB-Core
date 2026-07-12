/**
 * 图谱属性面板 — 节点与关系详情（悬停预览 / 点击固定）
 */
import { Typography, message, Tag } from 'antd';
import {
  MessageOutlined, CloseOutlined, CopyOutlined, PushpinOutlined,
  ArrowRightOutlined, NodeIndexOutlined,
  RightOutlined, AimOutlined, ExpandAltOutlined, HolderOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { kgApi, type KgNode, type KgEdge, type KgNodeType } from '../../api/kgApi';
import { NODE_THEME, TYPE_LABEL_ZH, getRelDisplayLabel } from './theme';
import { makeEdgeKey } from './GraphCanvas';

const { Text, Paragraph } = Typography;

export type GraphPanelTarget =
  | { kind: 'node'; node: KgNode }
  | {
    kind: 'edge';
    edge: KgEdge;
    fromLabel: string;
    toLabel: string;
    fromType?: KgNodeType;
    toType?: KgNodeType;
  };

interface Props {
  visible: boolean;
  target: GraphPanelTarget | null;
  pinned: boolean;
  onClose: () => void;
}

interface PropRow {
  key: string;
  value: string;
}

const META_LABEL_ZH: Record<string, string> = {
  law: '法规条文',
  case: '案例摘要',
  output_doc: '输出文书',
  duration: '时限',
};

export function targetKey(target: GraphPanelTarget | null): string {
  if (!target) return '';
  if (target.kind === 'node') return `node:${target.node.id}`;
  return `edge:${makeEdgeKey(target.edge)}`;
}

function formatMetaValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function normalizeNode(node: KgNode): KgNode {
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

function mergeNode(base: KgNode, patch: KgNode): KgNode {
  return {
    ...base,
    ...patch,
    meta: { ...base.meta, ...patch.meta },
  };
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
    .then(() => message.success('已复制'))
    .catch(() => message.error('复制失败'));
}

function PanelHead({
  pinned, onClose,
}: {
  pinned: boolean;
  onClose: () => void;
}) {
  return (
    <div className="kg-props-panel__head">
      <span className="kg-props-panel__title">详情</span>
      <div className="kg-props-panel__head-actions">
        {pinned && <PushpinOutlined className="kg-props-panel__pin" title="已固定" />}
        <button type="button" className="kg-props-panel__close" onClick={onClose} aria-label="隐藏详情">
          <CloseOutlined />
        </button>
      </div>
    </div>
  );
}

const EMPTY_ACTIONS = [
  { icon: <AimOutlined />, label: '悬停', desc: '预览节点或关系属性' },
  { icon: <PushpinOutlined />, label: '单击', desc: '固定详情面板' },
  { icon: <ExpandAltOutlined />, label: '双击', desc: '以该节点为中心展开' },
  { icon: <HolderOutlined />, label: '拖拽', desc: '手动调整单个节点位置' },
] as const;

function EmptyGuide() {
  return (
    <div className="kg-props-empty">
      <div className="kg-props-empty__hero">
        <div className="kg-props-empty__hero-icon" aria-hidden>
          <NodeIndexOutlined />
        </div>
        <h3 className="kg-props-empty__title">探索图谱</h3>
        <p className="kg-props-empty__subtitle">将鼠标移到节点或关系上查看详情</p>
      </div>

      <div className="kg-props-empty__section">
        <div className="kg-props-empty__section-title">交互</div>
        <div className="kg-edge-legend kg-edge-legend--panel">
          {EMPTY_ACTIONS.map(item => (
            <div key={item.label} className="kg-edge-legend__item">
              <span className="kg-edge-legend__icon" aria-hidden>{item.icon}</span>
              <span className="kg-edge-legend__body">
                <span className="kg-edge-legend__label">{item.label}</span>
                <span className="kg-edge-legend__desc">{item.desc}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="kg-props-empty__hint">滚轮缩放 · 拖动画布平移</p>
      </div>

      <div className="kg-props-empty__section">
        <div className="kg-props-empty__section-title">连线样式</div>
        <div className="kg-edge-legend kg-edge-legend--panel">
          <div className="kg-edge-legend__item">
            <span className="kg-edge-legend__line kg-edge-legend__line--solid" aria-hidden />
            <span className="kg-edge-legend__body">
              <span className="kg-edge-legend__label">实线</span>
              <span className="kg-edge-legend__desc">流程推进、法律依据</span>
            </span>
          </div>
          <div className="kg-edge-legend__item">
            <span className="kg-edge-legend__line kg-edge-legend__line--dashed" aria-hidden />
            <span className="kg-edge-legend__body">
              <span className="kg-edge-legend__label">虚线</span>
              <span className="kg-edge-legend__desc">材料依赖、条件分支</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PropList({ rows }: { rows: PropRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="kg-props-panel__list">
      {rows.map(row => (
        <div key={row.key} className="kg-props-row">
          <div className="kg-props-row__key">{row.key}</div>
          <div className="kg-props-row__value">
            <Text
              className="kg-props-row__text"
              ellipsis={row.value.length > 200 ? { tooltip: row.value } : false}
            >
              {row.value}
            </Text>
            <button type="button" className="kg-props-row__copy" onClick={() => copyText(row.value)} aria-label="复制">
              <CopyOutlined />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TypeChip({ type }: { type: KgNodeType }) {
  const theme = NODE_THEME[type];
  return (
    <span className="kg-props-type-chip" style={{ background: theme.fill }}>
      {TYPE_LABEL_ZH[type]}
    </span>
  );
}

function EdgeDetail({ target }: { target: Extract<GraphPanelTarget, { kind: 'edge' }> }) {
  const { edge, fromLabel, toLabel, fromType, toType } = target;
  const relLabel = getRelDisplayLabel(edge);
  const rows: PropRow[] = [
    { key: '关系类型', value: relLabel },
    { key: '连线样式', value: edge.solid ? '实线（流程推进）' : '虚线（材料/依赖）' },
    ...(edge.label && edge.label !== relLabel ? [{ key: '描述', value: edge.label }] : []),
  ];

  return (
    <div className="kg-props-detail kg-props-detail--edge">
      <div className="kg-props-edge-hero">
        <Tag className="kg-props-edge-hero__rel">{relLabel}</Tag>
      </div>

      <div className="kg-props-edge-flow kg-props-edge-flow--rich">
        <div className="kg-props-edge-flow__card">
          {fromType && <TypeChip type={fromType} />}
          <div className="kg-props-edge-flow__node">{fromLabel}</div>
        </div>
        <div className="kg-props-edge-flow__arrow-col">
          <ArrowRightOutlined />
        </div>
        <div className="kg-props-edge-flow__card">
          {toType && <TypeChip type={toType} />}
          <div className="kg-props-edge-flow__node">{toLabel}</div>
        </div>
      </div>

      <div className="kg-props-section">
        <div className="kg-props-section__title kg-props-section__title--accent">属性</div>
        <PropList rows={rows} />
      </div>
    </div>
  );
}

function NodeDetail({
  node,
  chunk,
}: {
  node: KgNode;
  chunk: { docTitle: string | null; text: string | null } | null;
}) {
  const theme = NODE_THEME[node.type];
  const meta = node.meta;

  const infoRows: PropRow[] = [
    ...(node.stepOrder != null ? [{ key: '步骤序号', value: String(node.stepOrder) }] : []),
    ...(node.type === 'Flow' && node.category ? [{ key: '所属流程', value: node.category }] : []),
  ];

  const metaRows: PropRow[] = Object.entries(meta)
    .filter(([, v]) => v != null && formatMetaValue(v).trim() !== '')
    .map(([k, v]) => ({
      key: META_LABEL_ZH[k.replace(/^meta_/, '')] ?? k,
      value: formatMetaValue(v),
    }));

  return (
    <div className="kg-props-detail kg-props-detail--node">
      <div className="kg-props-hero" style={{ borderColor: theme.fill }}>
        <div className="kg-props-hero__dot" style={{ background: theme.fill }} />
        <div className="kg-props-hero__main">
          <div className="kg-props-hero__label">{node.label}</div>
          <div className="kg-props-hero__tags">
            <Tag color={theme.fill} className="kg-props-hero__type">{TYPE_LABEL_ZH[node.type]}</Tag>
            {node.category && <Tag className="kg-props-hero__cat">{node.category}</Tag>}
          </div>
        </div>
      </div>

      {infoRows.length > 0 && (
        <div className="kg-props-section">
          <div className="kg-props-section__title kg-props-section__title--accent">信息</div>
          <PropList rows={infoRows} />
        </div>
      )}

      <div className="kg-props-section kg-props-section--meta">
        <div className="kg-props-section__title kg-props-section__title--muted">扩展属性</div>
        {metaRows.length > 0 ? (
          <PropList rows={metaRows} />
        ) : (
          <div className="kg-props-section__empty">暂无扩展属性</div>
        )}
      </div>

      {node.type === 'Law' && chunk?.text && (
        <div className="kg-props-section">
          <div className="kg-props-section__title kg-props-section__title--muted">法规原文</div>
          <Paragraph className="kg-props-chunk" ellipsis={{ rows: 8, expandable: true }}>
            {chunk.text}
          </Paragraph>
          {chunk.docTitle && (
            <div className="kg-props-chunk-src">来源：{chunk.docTitle}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function GraphDetailPanel({ visible, target, pinned, onClose }: Props) {
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const nodeCacheRef = useRef(new Map<string, KgNode>());
  const chunkCacheRef = useRef(new Map<string, { docTitle: string | null; text: string | null }>());
  const lastKeyRef = useRef('');
  const [cacheTick, setCacheTick] = useState(0);

  const key = targetKey(target);
  const targetNodeId = target?.kind === 'node' ? target.node.id : null;

  const displayNode = useMemo(() => {
    if (target?.kind !== 'node') return null;
    const base = normalizeNode(target.node);
    const cached = nodeCacheRef.current.get(base.id);
    return cached ? mergeNode(base, cached) : base;
  }, [key, target, cacheTick]);

  const displayChunk = useMemo(() => {
    if (!displayNode || displayNode.type !== 'Law') return null;
    return chunkCacheRef.current.get(displayNode.id) ?? null;
  }, [key, displayNode, cacheTick]);

  useEffect(() => {
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    }
  }, [key]);

  useEffect(() => {
    if (!targetNodeId || target?.kind !== 'node') return;

    let cancelled = false;
    const base = normalizeNode(target.node);
    kgApi.getNode(targetNodeId)
      .then(res => {
        if (cancelled) return;
        const next = res.node ? normalizeNode(res.node) : base;
        nodeCacheRef.current.set(targetNodeId, next);
        setCacheTick(t => t + 1);
      })
      .catch(() => { /* 静默失败，继续用图谱内数据 */ });

    return () => { cancelled = true; };
  }, [targetNodeId, target]);

  useEffect(() => {
    if (!displayNode || displayNode.type !== 'Law') return;
    if (chunkCacheRef.current.has(displayNode.id)) return;

    let cancelled = false;
    kgApi.getChunk(displayNode.id)
      .then(res => {
        if (cancelled) return;
        chunkCacheRef.current.set(displayNode.id, { docTitle: res.docTitle, text: res.text });
        setCacheTick(t => t + 1);
      })
      .catch(() => { /* 静默失败 */ });

    return () => { cancelled = true; };
  }, [displayNode?.id, displayNode?.type]);

  const showFoot = target?.kind === 'node' && displayNode != null;
  const panelClass = `kg-props-panel${visible ? '' : ' is-collapsed'}${pinned ? ' is-pinned' : target ? ' is-active' : ' is-idle'}`;

  return (
    <aside className={panelClass}>
      <PanelHead pinned={pinned} onClose={onClose} />

      <div ref={bodyRef} className="kg-props-panel__body">
        {!target && <EmptyGuide />}
        {target?.kind === 'edge' && <EdgeDetail key={key} target={target} />}
        {target?.kind === 'node' && displayNode && (
          <NodeDetail key={key} node={displayNode} chunk={displayChunk} />
        )}
      </div>

      <div className={`kg-props-panel__foot${showFoot ? '' : ' is-placeholder'}`}>
        {showFoot && displayNode && (
          <button
            type="button"
            className="kg-props-chat-btn"
            onClick={() => navigate(`/chat?kgNode=${encodeURIComponent(displayNode.id)}`)}
          >
            <span className="kg-props-chat-btn__icon"><MessageOutlined /></span>
            <span className="kg-props-chat-btn__body">
              <span className="kg-props-chat-btn__label">基于此节点对话</span>
              <span className="kg-props-chat-btn__sub">{displayNode.label}</span>
            </span>
            <RightOutlined className="kg-props-chat-btn__arrow" />
          </button>
        )}
      </div>
    </aside>
  );
}
