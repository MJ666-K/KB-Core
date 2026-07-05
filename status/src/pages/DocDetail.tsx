import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Spin, Collapse, List, Tag, message, Empty, Button, Typography, Progress, Input, Segmented,
} from 'antd';
import { ArrowLeftOutlined, CopyOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Chunk } from '../types';
import { resolveChunkRange } from '../chunkRange';

interface DocumentMeta {
  id: string;
  title: string;
  datasetName: string;
  status: string;
  fileSize: number;
  chunkCount: number;
}

interface ChunkWithParent extends Chunk {
  isParent: boolean;
}

const { Panel } = Collapse;

const statusLabels: Record<string, string> = {
  ready: '就绪',
  failed: '失败',
  pending: '等待中',
  parsing: '解析中',
  chunking: '分块中',
  embedding: '嵌入中',
  disabled: '禁用',
};

const embeddingLabels: Record<string, string> = {
  done: '已嵌入',
  pending: '待嵌入',
  failed: '失败',
};

export default function DocDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [chunks, setChunks] = useState<ChunkWithParent[]>([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<string[]>([]);
  const [chunkSearch, setChunkSearch] = useState('');
  const [highlightMode, setHighlightMode] = useState<'parent' | 'child'>('parent');
  const originalRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<number | null>(null);
  const listItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.getDocument(id),
      api.getDocumentChunks(id),
      api.getDocumentContent(id),
    ])
      .then(([d, c, orig]) => {
        setDoc(d.document);
        const enriched: ChunkWithParent[] = c.chunks.map(ch => ({ ...ch, isParent: ch.childIndexWithinParent === null }));
        setChunks(enriched);
        setOriginal(orig);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  }, []);

  useEffect(() => {
    if (!selectedId || !originalRef.current) return;
    const timer = window.setTimeout(() => {
      const span = originalRef.current?.querySelector<HTMLElement>(`[data-chunk-id="${selectedId}"]`);
      span?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      listItemRefs.current.get(selectedId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [selectedId, highlightMode, original, chunks]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!doc) return <Empty description="文档不存在" />;

  const parents = chunks.filter(c => c.isParent).sort((a, b) => (a.parentChunkIndex ?? 0) - (b.parentChunkIndex ?? 0));
  const childrenOf = (parentId: string) =>
    chunks.filter(c => c.parentId === parentId).sort((a, b) => (a.childIndexWithinParent ?? 0) - (b.childIndexWithinParent ?? 0));
  const childChunks = chunks.filter(c => !c.isParent);
  const embeddedCount = childChunks.filter(c => c.embeddingStatus === 'done').length;
  const embeddingProgress = childChunks.length > 0
    ? Math.round((embeddedCount / childChunks.length) * 100)
    : 100;
  const showEmbeddingProgress = !['ready', 'failed'].includes(doc.status) && embeddingProgress < 100;

  const clickChunk = (chunk: ChunkWithParent) => {
    setHighlightMode(chunk.isParent ? 'parent' : 'child');
    setSelectedId(chunk.id);

    const parentId = chunk.isParent ? chunk.id : chunk.parentId;
    if (parentId) {
      setExpandedParents(prev => (prev.includes(parentId) ? prev : [...prev, parentId]));
    }

    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    setFlashId(chunk.id);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashId(null);
      flashTimerRef.current = null;
    }, 1000);
  };

  const renderOriginal = () => {
    if (!original) return <Typography.Text type="secondary">（无原文内容）</Typography.Text>;

    const modeChunks = (highlightMode === 'parent' ? parents : chunks.filter(c => !c.isParent))
      .map(ch => ({ ch, range: resolveChunkRange(original, ch) }))
      .sort((a, b) => a.range.start - b.range.start);

    const preStyle = { whiteSpace: 'pre-wrap' as const, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.9, margin: 0, color: '#000000d9' };

    if (flashId) {
      const target = chunks.find(c => c.id === flashId);
      if (target) {
        const { start, end } = resolveChunkRange(original, target);
        const hlClass = target.isParent ? 'chunk-parent' : 'chunk-child';
        return (
          <pre style={preStyle}>
            {original.slice(0, start)}
            <span
              className={`chunk-hl ${hlClass} selected flash`}
              data-chunk-id={target.id}
              onClick={() => clickChunk(target)}
            >
              {original.slice(start, end)}
            </span>
            {original.slice(end)}
          </pre>
        );
      }
    }

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const { ch, range } of modeChunks) {
      const { start, end } = range;
      if (end <= cursor) continue;
      const segStart = Math.max(start, cursor);
      if (segStart > cursor) parts.push(original.slice(cursor, segStart));
      if (end > segStart) {
        const hlClass = ch.isParent ? 'chunk-parent' : 'chunk-child';
        parts.push(
          <span
            key={ch.id}
            className={`chunk-hl ${hlClass}`}
            data-chunk-id={ch.id}
            onClick={() => clickChunk(ch)}
          >
            {original.slice(segStart, end)}
          </span>,
        );
        cursor = end;
      }
    }
    if (cursor < original.length) parts.push(original.slice(cursor));
    return <pre style={preStyle}>{parts}</pre>;
  };

  const isSelected = (id: string) => selectedId === id;

  const parentPreview = (p: ChunkWithParent) => (
    <div
      ref={el => { if (el) listItemRefs.current.set(p.id, el); else listItemRefs.current.delete(p.id); }}
      style={{
        marginBottom: 8,
        padding: '10px 12px',
        background: isSelected(p.id) ? '#e6f4ff' : '#fafafa',
        borderRadius: 6,
        border: isSelected(p.id) ? '1px solid #91caff' : '1px solid #f0f0f0',
        cursor: 'pointer',
      }}
      onClick={() => clickChunk(p)}
    >
      <div style={{ fontSize: 11, color: '#00000073', marginBottom: 6 }}>父块全文 · {p.tokenCount} 词</div>
      <div style={{ fontSize: 12, color: '#000000a6', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{p.content}</div>
    </div>
  );

  const chunkCard = (ch: ChunkWithParent) => {
    const selected = isSelected(ch.id);
    return (
      <List.Item
        key={ch.id}
        style={{ cursor: 'pointer', background: selected ? '#e6f4ff' : 'transparent', padding: '8px 12px', borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent', transition: 'all 0.15s' }}
        onClick={() => clickChunk(ch)}
      >
        <div
          ref={el => { if (el) listItemRefs.current.set(ch.id, el); else listItemRefs.current.delete(ch.id); }}
          style={{ width: '100%' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Tag color="blue" style={{ margin: 0 }}>C{ch.childIndexWithinParent}</Tag>
            <span style={{ fontSize: 11, color: '#00000073' }}>{ch.tokenCount} 词</span>
            <Tag color={ch.embeddingStatus === 'done' ? 'success' : ch.embeddingStatus === 'failed' ? 'error' : 'processing'} style={{ margin: 0 }}>
              {embeddingLabels[ch.embeddingStatus] ?? ch.embeddingStatus}
            </Tag>
            <Button type="text" size="small" icon={<CopyOutlined />} style={{ marginLeft: 'auto', padding: '0 4px' }}
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(ch.content); message.success('已复制'); }} />
          </div>
          <div style={{
            fontSize: 12,
            color: '#000000a6',
            lineHeight: 1.6,
            ...(selected
              ? { whiteSpace: 'pre-wrap' as const }
              : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
          }}>{ch.content}</div>
        </div>
      </List.Item>
    );
  };

  const filteredParents = chunkSearch
    ? parents.filter(p => { const children = childrenOf(p.id); return p.content.includes(chunkSearch) || children.some(c => c.content.includes(chunkSearch)); })
    : parents;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 96px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/documents')} style={{ padding: '4px 8px' }} />
        <Typography.Text strong style={{ fontSize: 16 }}>{doc.title}</Typography.Text>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Tag color={doc.status === 'ready' ? 'success' : 'processing'}>{statusLabels[doc.status] ?? doc.status}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{(doc.fileSize / 1024).toFixed(1)} KB</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{parents.length} 父 · {childChunks.length} 子</Typography.Text>
          {showEmbeddingProgress && (
            <Progress type="circle" percent={embeddingProgress} size={28} strokeColor="#1677ff" />
          )}
        </div>
      </div>

      <Row gutter={12} style={{ flex: 1, minHeight: 0 }}>
        <Col span={16} style={{ height: '100%' }}>
          <Card
            bordered={false}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>原文高亮</span>
                <Segmented
                  size="small"
                  value={highlightMode}
                  onChange={v => setHighlightMode(v as 'parent' | 'child')}
                  options={[
                    { label: '父块', value: 'parent' },
                    { label: '子块', value: 'child' },
                  ]}
                />
              </div>
            }
            styles={{ body: { padding: '12px 16px', height: 'calc(100% - 46px)', overflowY: 'auto' }, header: { minHeight: 46, padding: '0 16px' } }}
            style={{ height: '100%' }}
          >
            <div ref={originalRef}>{renderOriginal()}</div>
          </Card>
        </Col>
        <Col span={8} style={{ height: '100%' }}>
          <Card bordered={false} styles={{ body: { padding: 0, height: '100%', overflowY: 'auto' } }} style={{ height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <Input placeholder="搜索切片..." prefix={<SearchOutlined />} value={chunkSearch} onChange={e => setChunkSearch(e.target.value)} allowClear size="small" />
            </div>
            <Collapse
              bordered={false}
              style={{ background: 'transparent' }}
              size="small"
              activeKey={expandedParents}
              onChange={keys => setExpandedParents(Array.isArray(keys) ? keys : [keys])}
            >
              {filteredParents.map(p => {
                const panelSelected = isSelected(p.id) || childrenOf(p.id).some(c => isSelected(c.id));
                return (
                <Panel
                  key={p.id}
                  header={
                    <div
                      onClick={e => { e.stopPropagation(); clickChunk(p); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: panelSelected ? '#e6f4ff' : undefined,
                        margin: panelSelected ? '-8px -12px' : undefined,
                        padding: panelSelected ? '8px 12px' : undefined,
                        borderRadius: panelSelected ? 4 : undefined,
                      }}
                    >
                      <Tag color="geekblue" style={{ margin: 0 }}>P{p.parentChunkIndex}</Tag>
                      <strong style={{ fontSize: 13 }}>父块 {p.parentChunkIndex}</strong>
                      <span style={{ fontSize: 11, color: '#00000073' }}>{p.tokenCount} 词</span>
                      <Tag color="default" style={{ margin: 0, fontSize: 10 }}>不参与嵌入</Tag>
                    </div>
                  }
                  style={{ padding: 0 }}
                >
                  {parentPreview(p)}
                  {childrenOf(p.id).length > 0 && (
                    <div style={{ fontSize: 11, color: '#00000073', marginBottom: 4, paddingLeft: 4 }}>子块</div>
                  )}
                  <List dataSource={childrenOf(p.id)} renderItem={chunkCard} split={false} size="small" />
                </Panel>
                );
              })}
            </Collapse>
            {filteredParents.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#00000045', fontSize: 13 }}>
                {chunkSearch ? '未找到匹配的切片' : '无切片数据'}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
