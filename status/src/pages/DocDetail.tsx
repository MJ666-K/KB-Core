import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Spin, Collapse, List, Tag, message, Empty, Button, Typography, Progress, Input,
} from 'antd';
import { ArrowLeftOutlined, CopyOutlined, SearchOutlined } from '@ant-design/icons';
import type { Chunk } from '../types';

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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [chunkSearch, setChunkSearch] = useState('');
  const originalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/documents/${id}`).then(r => r.json() as Promise<{ document: DocumentMeta }>),
      fetch(`/api/documents/${id}/chunks`).then(r => r.json() as Promise<{ chunks: Chunk[] }>),
      fetch(`/api/documents/${id}/content`).then(r => r.text()),
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

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!doc) return <Empty description="文档不存在" />;

  const parents = chunks.filter(c => c.isParent).sort((a, b) => (a.parentChunkIndex ?? 0) - (b.parentChunkIndex ?? 0));
  const childrenOf = (parentId: string) =>
    chunks.filter(c => c.parentId === parentId).sort((a, b) => (a.childIndexWithinParent ?? 0) - (b.childIndexWithinParent ?? 0));
  const childCount = chunks.filter(c => !c.isParent).length;
  const doneCount = chunks.filter(c => c.embeddingStatus === 'done').length;
  const progress = chunks.length > 0 ? Math.round((doneCount / chunks.length) * 100) : 0;

  const clickChunk = (chunk: ChunkWithParent) => {
    setSelectedId(prev => prev === chunk.id ? null : chunk.id);
    if (!originalRef.current) return;
    const span = originalRef.current.querySelector<HTMLElement>(`[data-chunk-id="${chunk.id}"]`);
    if (span) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      span.classList.add('flash');
      setTimeout(() => span.classList.remove('flash'), 1500);
    }
  };

  const renderOriginal = () => {
    if (!original) return <Typography.Text type="secondary">（无原文内容）</Typography.Text>;
    const childChunks = chunks.filter(c => !c.isParent && c.startOffset !== null && c.endOffset !== null);
    const sorted = childChunks.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    sorted.forEach(ch => {
      const start = ch.startOffset ?? cursor;
      const end = ch.endOffset ?? start;
      if (start > cursor) parts.push(original.slice(cursor, start));
      const isSelected = selectedId === ch.id;
      const isHovered = hoveredId === ch.id;
      const cls = `chunk-hl chunk-child${isSelected ? ' selected' : ''}${isHovered ? ' hovered' : ''}`;
      parts.push(
        <span key={ch.id} className={cls} data-chunk-id={ch.id}
          onClick={() => clickChunk(ch)}
          onMouseEnter={() => setHoveredId(ch.id)}
          onMouseLeave={() => setHoveredId(null)}
        >{original.slice(start, end)}</span>
      );
      cursor = end;
    });
    if (cursor < original.length) parts.push(original.slice(cursor));
    return <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.9, margin: 0, color: '#000000d9' }}>{parts}</pre>;
  };

  const chunkCard = (ch: ChunkWithParent) => {
    const isSelected = selectedId === ch.id;
    const isHovered = hoveredId === ch.id;
    return (
      <List.Item
        key={ch.id}
        style={{ cursor: 'pointer', background: isSelected ? '#e6f4ff' : isHovered ? '#fafafa' : 'transparent', padding: '8px 12px', borderLeft: isSelected ? '3px solid #1677ff' : '3px solid transparent', transition: 'all 0.15s' }}
        onClick={() => clickChunk(ch)}
        onMouseEnter={() => setHoveredId(ch.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Tag color="blue" style={{ margin: 0 }}>C{ch.childIndexWithinParent}</Tag>
            <span style={{ fontSize: 11, color: '#00000073' }}>{ch.tokenCount} 词</span>
            <Tag color={ch.embeddingStatus === 'done' ? 'success' : ch.embeddingStatus === 'failed' ? 'error' : 'processing'} style={{ margin: 0 }}>
              {embeddingLabels[ch.embeddingStatus] ?? ch.embeddingStatus}
            </Tag>
            <Button type="text" size="small" icon={<CopyOutlined />} style={{ marginLeft: 'auto', padding: '0 4px' }}
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(ch.content); message.success('已复制'); }} />
          </div>
          <div style={{ fontSize: 12, color: '#000000a6', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ch.content}</div>
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
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{parents.length} 父 · {childCount} 子</Typography.Text>
          {progress < 100 && <Progress type="circle" percent={progress} size={28} strokeColor="#1677ff" />}
        </div>
      </div>

      <Row gutter={12} style={{ flex: 1, minHeight: 0 }}>
        <Col span={16} style={{ height: '100%' }}>
          <Card bordered={false} styles={{ body: { padding: '12px 16px', height: '100%', overflowY: 'auto' } }} style={{ height: '100%' }}>
            <div ref={originalRef}>{renderOriginal()}</div>
          </Card>
        </Col>
        <Col span={8} style={{ height: '100%' }}>
          <Card bordered={false} styles={{ body: { padding: 0, height: '100%', overflowY: 'auto' } }} style={{ height: '100%' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <Input placeholder="搜索切片..." prefix={<SearchOutlined />} value={chunkSearch} onChange={e => setChunkSearch(e.target.value)} allowClear size="small" />
            </div>
            <Collapse bordered={false} style={{ background: 'transparent' }} size="small">
              {filteredParents.map(p => (
                <Panel
                  key={p.id}
                  header={
                    <div onClick={e => { e.stopPropagation(); clickChunk(p); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tag color="geekblue" style={{ margin: 0 }}>P{p.parentChunkIndex}</Tag>
                      <strong style={{ fontSize: 13 }}>父块 {p.parentChunkIndex}</strong>
                      <span style={{ fontSize: 11, color: '#00000073' }}>{p.tokenCount} 词</span>
                      <Tag color={p.embeddingStatus === 'done' ? 'success' : 'processing'} style={{ margin: 0, fontSize: 10 }}>{embeddingLabels[p.embeddingStatus] ?? p.embeddingStatus}</Tag>
                    </div>
                  }
                  style={{ padding: 0 }}
                >
                  <List dataSource={childrenOf(p.id)} renderItem={chunkCard} split={false} size="small" />
                </Panel>
              ))}
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
