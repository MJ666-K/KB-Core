import { useEffect, useState, type ReactNode } from 'react';
import {
  Card, Form, InputNumber, Button, message, Typography, Space, Spin, Tabs, Tooltip,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, ScissorOutlined, SearchOutlined,
  ThunderboltOutlined, ArrowRightOutlined, QuestionCircleOutlined,
  DownOutlined, ApiOutlined,
} from '@ant-design/icons';
import { api } from '../api';

interface ChunkSettings {
  parentTokens: number;
  childTokens: number;
  overlapTokens: number;
}

interface QuerySettings {
  searchTopK: number;
  denseTopKMultiplier: number;
  rrfK: number;
  rerankTopK: number;
  denseMinSimilarity: number;
  rerankMinScore: number;
  agentMaxIterations: number;
  agentMaxToolCalls: number;
  resultCacheTtlMs: number;
}

const LEGAL_RAG_PRESET: QuerySettings = {
  searchTopK: 10,
  denseTopKMultiplier: 2,
  rrfK: 60,
  rerankTopK: 20,
  denseMinSimilarity: 0.65,
  rerankMinScore: 0.5,
  agentMaxIterations: 5,
  agentMaxToolCalls: 15,
  resultCacheTtlMs: 300_000,
};

function formatCacheTtl(ms: number | undefined): string {
  if (!ms || ms <= 0) return '';
  if (ms % 60_000 === 0) return `≈ ${ms / 60_000} 分钟`;
  if (ms % 1000 === 0) return `≈ ${ms / 1000} 秒`;
  return '';
}

function FieldLabel({ label, tip }: { label: string; tip?: string }) {
  if (!tip) return <span>{label}</span>;
  return (
    <span className="kc-settings-label">
      {label}
      <Tooltip title={tip}>
        <QuestionCircleOutlined className="kc-settings-label-tip" />
      </Tooltip>
    </span>
  );
}

function estChildrenPerParent(parent: number, child: number, overlap: number): number {
  const step = Math.max(1, child - overlap);
  if (parent <= child) return 1;
  return Math.max(1, Math.ceil((parent - child) / step) + 1);
}

function estParentRange(childRecall: number, cpp: number): { lo: number; hi: number } {
  const hi = childRecall;
  const lo = Math.max(1, Math.ceil(childRecall / cpp));
  return { lo, hi: Math.max(lo, hi) };
}

function PipeChip({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'accent' | 'out';
}) {
  return (
    <div className={`kc-pipe-chip kc-pipe-chip-${tone}`}>
      <span className="kc-pipe-chip-label">{label}</span>
      <span className="kc-pipe-chip-value">{value}</span>
    </div>
  );
}

function PipelinePreview({
  query,
  chunk,
}: {
  query: Partial<QuerySettings>;
  chunk: Partial<ChunkSettings>;
}) {
  const parentTopK = query.searchTopK ?? 10;
  const mult = query.denseTopKMultiplier ?? 3;
  const childRecall = parentTopK * mult;
  const rerankChild = Math.min(query.rerankTopK ?? 20, childRecall * 2);
  const rerankMin = query.rerankMinScore ?? 0.5;

  const parentTokens = chunk.parentTokens ?? 600;
  const childTokens = chunk.childTokens ?? 200;
  const overlapTokens = chunk.overlapTokens ?? 30;
  const cpp = estChildrenPerParent(parentTokens, childTokens, overlapTokens);
  const parentEst = estParentRange(childRecall, cpp);

  const parentEstLabel = parentEst.lo === parentEst.hi
    ? `${parentEst.lo}`
    : `${parentEst.lo}~${Math.min(parentEst.hi, parentTopK)}`;

  return (
    <div className="kc-pipe">
      {/* 子块轨 */}
      <div className="kc-pipe-lane kc-pipe-lane-child">
        <div className="kc-pipe-lane-head">
          <span className="kc-pipe-lane-icon kc-pipe-lane-icon-child">
            <SearchOutlined />
          </span>
          <div className="kc-pipe-lane-title">
            <span>子块检索</span>
            <span className="kc-pipe-lane-sub">{childTokens} token · 嵌入 · 召回单元</span>
          </div>
          <div className="kc-pipe-blocks kc-pipe-blocks-child" aria-hidden>
            {[0, 1, 2].map(i => <span key={i} className="kc-pipe-block kc-pipe-block-sm" />)}
          </div>
        </div>
        <div className="kc-pipe-track">
          <div className="kc-pipe-fork">
            <PipeChip label="Dense" value={childRecall} />
            <span className="kc-pipe-fork-plus">+</span>
            <PipeChip label="Sparse" value={childRecall} />
          </div>
          <ArrowRightOutlined className="kc-pipe-arrow" />
          <PipeChip label="RRF" value="融合" />
          <ArrowRightOutlined className="kc-pipe-arrow" />
          <PipeChip label="Rerank" value={rerankChild} />
          <ArrowRightOutlined className="kc-pipe-arrow" />
          <PipeChip label="过滤" value={`≥${rerankMin}`} />
        </div>
      </div>

      {/* 去重桥 */}
      <div className="kc-pipe-bridge">
        <div className="kc-pipe-bridge-rail" />
        <div className="kc-pipe-bridge-badge">
          <DownOutlined />
          <span>Parent 去重</span>
          <span className="kc-pipe-bridge-meta">约 {cpp} 子块 → 1 父块</span>
        </div>
        <div className="kc-pipe-bridge-rail" />
      </div>

      {/* 父块轨 */}
      <div className="kc-pipe-lane kc-pipe-lane-parent">
        <div className="kc-pipe-lane-head">
          <span className="kc-pipe-lane-icon kc-pipe-lane-icon-parent">
            <ApiOutlined />
          </span>
          <div className="kc-pipe-lane-title">
            <span>父块输出</span>
            <span className="kc-pipe-lane-sub">{parentTokens} token · 送入 LLM 的上下文</span>
          </div>
          <div className="kc-pipe-blocks kc-pipe-blocks-parent" aria-hidden>
            <span className="kc-pipe-block kc-pipe-block-lg" />
          </div>
        </div>
        <div className="kc-pipe-track">
          <PipeChip label="去重合并" value={`≈${parentEstLabel}`} tone="accent" />
          <ArrowRightOutlined className="kc-pipe-arrow" />
          <PipeChip label="LLM 上下文" value={parentTopK} tone="out" />
        </div>
      </div>

      <div className="kc-pipe-foot">
        子块粗召回 <strong>{childRecall}</strong> 条
        <span className="kc-pipe-foot-sep">→</span>
        约 <strong>{parentEstLabel}</strong> 父块
        <span className="kc-pipe-foot-sep">→</span>
        最终 <strong>{parentTopK}</strong> 段给模型
      </div>
    </div>
  );
}

function ChunkTab({ form }: { form: ReturnType<typeof Form.useForm<ChunkSettings>>[0] }) {
  return (
    <Form form={form} layout="vertical" requiredMark={false} size="middle" className="kc-settings-form">
      <SettingsGroup
        title="文本切割"
        subtitle="仅对新入库 / 重新嵌入的文档生效"
        icon={<ScissorOutlined />}
        tone="primary"
      >
        <div className="kc-settings-fields kc-settings-fields-3">
          <Form.Item
            name="parentTokens"
            label={<FieldLabel label="父块 Token" tip="检索命中后返回的上下文窗口" />}
            rules={[{ required: true }]}
          >
            <InputNumber min={100} max={8000} className="kc-settings-input" />
          </Form.Item>
          <Form.Item
            name="childTokens"
            label={<FieldLabel label="子块 Token" tip="向量化与检索的基本单元" />}
            rules={[{ required: true }]}
          >
            <InputNumber min={50} max={2000} className="kc-settings-input" />
          </Form.Item>
          <Form.Item
            name="overlapTokens"
            label={<FieldLabel label="重叠 Token" tip="相邻子块重叠，避免语义截断" />}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={500} className="kc-settings-input" />
          </Form.Item>
        </div>
      </SettingsGroup>
    </Form>
  );
}

function SettingsGroup({
  title,
  subtitle,
  icon,
  tone = 'primary',
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  tone?: 'primary' | 'success' | 'purple';
  children: ReactNode;
}) {
  return (
    <section className="kc-settings-panel">
      <div className="kc-settings-panel-head">
        {icon && (
          <span className={`kc-settings-panel-icon kc-settings-panel-icon-${tone}`}>
            {icon}
          </span>
        )}
        <div className="kc-settings-panel-titles">
          <span className="kc-settings-panel-title">{title}</span>
          {subtitle && (
            <Typography.Text type="secondary" className="kc-settings-panel-sub">
              {subtitle}
            </Typography.Text>
          )}
        </div>
      </div>
      <div className="kc-settings-panel-body">{children}</div>
    </section>
  );
}

function QueryTab({
  form,
  chunk,
  onApplyPreset,
}: {
  form: ReturnType<typeof Form.useForm<QuerySettings>>[0];
  chunk: Partial<ChunkSettings>;
  onApplyPreset: () => void;
}) {
  const watched = Form.useWatch([], form) as Partial<QuerySettings> | undefined;
  const cacheHint = formatCacheTtl(watched?.resultCacheTtlMs);

  return (
    <Form form={form} layout="vertical" requiredMark={false} size="middle" className="kc-settings-form">
      <SettingsGroup
        title="流水线预览"
        subtitle="随参数实时更新，展示子块召回 → 父块去重 → LLM 上下文"
        icon={<SearchOutlined />}
        tone="primary"
      >
        <PipelinePreview query={watched ?? {}} chunk={chunk} />
      </SettingsGroup>

      <div className="kc-settings-panels">
        <SettingsGroup title="召回" icon={<SearchOutlined />} tone="primary">
          <div className="kc-settings-fields kc-settings-fields-2">
            <Form.Item
              name="searchTopK"
              label={<FieldLabel label="父块 Top K" tip="最终送入 LLM 的父块段落数（非子块数）" />}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={100} className="kc-settings-input" />
            </Form.Item>
            <Form.Item
              name="denseTopKMultiplier"
              label={<FieldLabel label="子块扩展倍数" tip="子块级粗召回 = 父块 Top K × 倍数。因多个子块同属一个父块，倍数 2~3 即可，不必过大" />}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={20} className="kc-settings-input" />
            </Form.Item>
            <Form.Item name="rrfK" label={<FieldLabel label="RRF K" tip="融合平滑常数，推荐 60" />} rules={[{ required: true }]}>
              <InputNumber min={1} max={200} className="kc-settings-input" />
            </Form.Item>
            <Form.Item name="rerankTopK" label={<FieldLabel label="Rerank 候选" tip="精排的子块候选数（去重前）" />} rules={[{ required: true }]}>
              <InputNumber min={1} max={100} className="kc-settings-input" />
            </Form.Item>
          </div>
        </SettingsGroup>

        <SettingsGroup
          title="过滤"
          subtitle="Dense 仅扩大召回，最终只看 Rerank 分数"
          icon={<ThunderboltOutlined />}
          tone="success"
        >
          <div className="kc-settings-fields kc-settings-fields-2">
            <Form.Item
              name="denseMinSimilarity"
              label={<FieldLabel label="Dense 召回阈值" tip="仅 SQL 粗召回，不参与最终过滤。推荐 0.60~0.65" />}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={1} step={0.05} className="kc-settings-input" />
            </Form.Item>
            <Form.Item
              name="rerankMinScore"
              label={<FieldLabel label="Rerank 最低分" tip="唯一最终过滤阈值；为空时由模型自行分析" />}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={1} step={0.05} className="kc-settings-input" />
            </Form.Item>
          </div>
        </SettingsGroup>

        <SettingsGroup title="Agent / 缓存" icon={<ApiOutlined />} tone="purple">
          <div className="kc-settings-fields kc-settings-fields-3">
            <Form.Item name="agentMaxIterations" label="最大迭代" rules={[{ required: true }]}>
              <InputNumber min={1} max={20} className="kc-settings-input" />
            </Form.Item>
            <Form.Item name="agentMaxToolCalls" label="Tool 上限" rules={[{ required: true }]}>
              <InputNumber min={1} max={50} className="kc-settings-input" />
            </Form.Item>
            <Form.Item
              name="resultCacheTtlMs"
              label={<FieldLabel label="缓存 TTL (ms)" tip={cacheHint || '相同 query 在 TTL 内返回缓存'} />}
              rules={[{ required: true }]}
            >
              <InputNumber min={1000} max={3_600_000} step={1000} className="kc-settings-input kc-settings-input-wide" />
            </Form.Item>
          </div>
        </SettingsGroup>
      </div>

      <div className="kc-settings-tab-actions">
        <Button type="link" icon={<ThunderboltOutlined />} onClick={onApplyPreset} size="small">
          填入法律 RAG 推荐值
        </Button>
      </div>
    </Form>
  );
}

export default function Settings() {
  const [chunkForm] = Form.useForm<ChunkSettings>();
  const [queryForm] = Form.useForm<QuerySettings>();
  const chunkWatched = Form.useWatch([], chunkForm) as Partial<ChunkSettings> | undefined;
  const [activeTab, setActiveTab] = useState('query');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!initialLoading) setRefreshing(true);
    api.getSettings()
      .then((data) => {
        const s = data.settings as { chunk: ChunkSettings; query: QuerySettings };
        chunkForm.setFieldsValue(s.chunk);
        queryForm.setFieldsValue(s.query);
      })
      .catch(() => message.error('加载配置失败'))
      .finally(() => {
        setInitialLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const [chunk, query] = await Promise.all([
        chunkForm.validateFields(),
        queryForm.validateFields(),
      ]);
      setSaving(true);
      await api.updateSettings({ chunk, query });
      message.success('配置已保存');
    } catch {
      message.error('保存失败，请检查表单');
    } finally {
      setSaving(false);
    }
  };

  const applyLegalPreset = () => {
    queryForm.setFieldsValue(LEGAL_RAG_PRESET);
    message.info('已填入推荐值，请保存');
  };

  const tabItems = [
    {
      key: 'query',
      label: (
        <span className="kc-settings-tab-label">
          <SearchOutlined /> 检索流水线
        </span>
      ),
      children: <QueryTab form={queryForm} chunk={chunkWatched ?? {}} onApplyPreset={applyLegalPreset} />,
    },
    {
      key: 'chunk',
      label: (
        <span className="kc-settings-tab-label">
          <ScissorOutlined /> 文本切割
        </span>
      ),
      children: <ChunkTab form={chunkForm} />,
    },
  ];

  return (
    <div className="kc-settings">
      <Card bordered={false} className="kc-settings-card" styles={{ body: { padding: '12px 20px 20px' } }}>
        <div className="kc-settings-toolbar">
          <Space size={8}>
            <Button icon={<ReloadOutlined />} onClick={load} loading={refreshing} disabled={initialLoading || saving}>
              重新加载
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} disabled={initialLoading}>
              保存
            </Button>
          </Space>
        </div>

        <Spin spinning={initialLoading}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            className="kc-settings-tabs"
            size="middle"
          />
        </Spin>
      </Card>
    </div>
  );
}
