import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Upload, message, Popconfirm, Card, Select, Tag, Input, Modal, Progress,
} from 'antd';
import type { UploadFile } from 'antd';
import {
  DeleteOutlined, ReloadOutlined, UploadOutlined, SearchOutlined, EyeOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import type { Dataset } from '../types';
import { datasetDisplayName } from '../datasetLabels';
import { documentsTablePagination } from '../tablePagination';

interface Document {
  id: string;
  title: string;
  datasetName: string;
  status: 'ready' | 'pending' | 'parsing' | 'chunking' | 'embedding' | 'failed' | 'disabled';
  fileSize: number;
  chunkCount: number;
  createdAt: string;
}

const statusConfig: Record<Document['status'], { color: string; label: string }> = {
  ready: { color: 'success', label: '就绪' },
  failed: { color: 'error', label: '失败' },
  pending: { color: 'warning', label: '等待中' },
  parsing: { color: 'processing', label: '解析中' },
  chunking: { color: 'processing', label: '分块中' },
  embedding: { color: 'processing', label: '嵌入中' },
  disabled: { color: 'default', label: '禁用' },
};

export default function Documents() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<Document[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDataset, setUploadDataset] = useState<string>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.getDocuments(), api.getDatasets()])
      .then(([d, ds]) => { setDocs(d.documents); setDatasets(ds.datasets); if (!uploadDataset && ds.datasets[0]) setUploadDataset(ds.datasets[0].id); })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const onBatchDelete = async () => {
    try {
      await Promise.all(selectedKeys.map(id => api.deleteDocument(id)));
      message.success(`已删除 ${selectedKeys.length} 个文档`);
      setSelectedKeys([]);
      load();
    } catch { message.error('部分删除失败'); load(); }
  };

  const onBatchReingest = async () => {
    let success = 0;
    let fail = 0;
    for (const id of selectedKeys) {
      try {
        await api.reingestDocument(id);
        success++;
      } catch {
        fail++;
      }
    }
    if (success > 0) message.success(`已重新嵌入 ${success} 个文档${fail > 0 ? `，${fail} 个失败` : ''}`);
    else message.error('重新嵌入失败');
    if (fail === 0) setSelectedKeys([]);
    load();
  };

  const doUpload = async () => {
    if (fileList.length === 0) { message.warning('请先选择文件'); return; }
    if (!uploadDataset) { message.warning('请选择目标数据集'); return; }
    setUploading(true);
    let success = 0, fail = 0;
    for (const f of fileList) {
      try {
        const ds = datasets.find(d => d.id === uploadDataset);
        await api.uploadDocument(f.originFileObj as File, ds?.name ?? 'default');
        success++;
        setFileList(prev => prev.map(pf => pf.uid === f.uid ? { ...pf, status: 'done' } : pf));
      } catch {
        fail++;
        setFileList(prev => prev.map(pf => pf.uid === f.uid ? { ...pf, status: 'error' } : pf));
      }
    }
    setUploading(false);
    if (success > 0) message.success(`上传完成：${success} 成功${fail > 0 ? `，${fail} 失败` : ''}`);
    if (fail === 0) { setUploadOpen(false); setFileList([]); }
    load();
  };

  const cols = [
    {
      title: '标题', dataIndex: 'title', key: 'title',
      render: (v: string, r: Document) => (
        <a onClick={() => navigate(`/documents/${r.id}`)}><FileTextOutlined style={{ marginRight: 6 }} />{v}</a>
      ),
    },
    {
      title: '数据集', dataIndex: 'datasetName', key: 'datasetName',
      render: (v: string) => <Tag>{datasetDisplayName(v)}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      filters: Object.entries(statusConfig).map(([value, cfg]) => ({ text: cfg.label, value })),
      onFilter: (value: any, r: Document) => r.status === value,
      render: (s: Document['status']) => {
        const cfg = statusConfig[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: '大小', dataIndex: 'fileSize', key: 'fileSize', render: (v: number) => `${(v / 1024).toFixed(1)} KB`, width: 110 },
    { title: '块数', dataIndex: 'chunkCount', key: 'chunkCount', width: 80, render: (v: number) => v?.toLocaleString() ?? '—' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 175, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: Document) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/documents/${r.id}`)}>查看</Button>
          <Popconfirm title="确认删除？" onConfirm={() => { api.deleteDocument(r.id).then(() => { message.success('已删除'); load(); }).catch(() => message.error('失败')); }}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const filtered = docs.filter(d => !search || d.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <Card bordered={false}>
        <div className="kc-toolbar">
          <Button type="primary" icon={<UploadOutlined />} onClick={() => { setUploadOpen(true); setFileList([]); }}>上传文档</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button
            icon={<ReloadOutlined />}
            disabled={selectedKeys.length === 0}
            onClick={() => {
              if (selectedKeys.length === 0) { message.warning('请先选择文档'); return; }
              onBatchReingest();
            }}
          >
            重新嵌入{selectedKeys.length > 0 ? ` (${selectedKeys.length})` : ''}
          </Button>
          <Popconfirm
            title={`确认删除 ${selectedKeys.length} 个文档？`}
            onConfirm={onBatchDelete}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedKeys.length === 0}>
              删除{selectedKeys.length > 0 ? ` (${selectedKeys.length})` : ''}
            </Button>
          </Popconfirm>
          {selectedKeys.length > 0 && (
            <Button type="link" onClick={() => setSelectedKeys([])}>取消选择</Button>
          )}
          <Input placeholder="搜索文档标题..." prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} allowClear style={{ width: 240, marginLeft: 'auto' }} />
        </div>
        <Table
          dataSource={filtered}
          columns={cols}
          loading={loading}
          rowKey="id"
          size="middle"
          pagination={documentsTablePagination}
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: keys => setSelectedKeys(keys as string[]) }}
        />
      </Card>

      <Modal
        title="上传文档"
        open={uploadOpen}
        onCancel={() => { if (uploading) return; setUploadOpen(false); setFileList([]); }}
        onOk={doUpload}
        okText={uploading ? '上传中...' : '开始上传'}
        cancelText="取消"
        okButtonProps={{ loading: uploading, disabled: fileList.length === 0 }}
        width={640}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>目标数据集</span>
          <Select
            placeholder="选择数据集"
            value={uploadDataset}
            onChange={v => setUploadDataset(v)}
            style={{ flex: 1 }}
            options={datasets.map(d => ({ value: d.id, label: datasetDisplayName(d.name) }))}
          />
        </div>
        <Upload
          fileList={fileList}
          multiple
          accept=".txt"
          beforeUpload={() => false}
          onChange={({ fileList: fl }) => setFileList(fl)}
        >
          <Button icon={<UploadOutlined />}>选择 TXT 文件</Button>
        </Upload>
        {fileList.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {uploading && <Progress size="small" percent={Math.round((fileList.filter(f => f.status === 'done' || f.status === 'error').length / fileList.length) * 100)} style={{ marginBottom: 8 }} />}
            <div style={{ fontSize: 12, color: '#00000073' }}>
              共 {fileList.length} 个文件，总大小 {((fileList.reduce((s, f) => s + (f.size ?? 0), 0)) / 1024).toFixed(1)} KB
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
