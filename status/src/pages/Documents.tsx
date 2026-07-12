import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Upload, message, Popconfirm, Card, Select, Tag, Input, Modal, Progress,
} from 'antd';
import type { UploadFile } from 'antd';
import { Upload as AntUpload } from 'antd';
import {
  DeleteOutlined, ReloadOutlined, UploadOutlined, SearchOutlined, EyeOutlined,
  FileTextOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import type { Dataset } from '../types';
import { datasetDisplayName } from '../datasetLabels';
import { documentsTablePagination } from '../tablePagination';
import { useAuth } from '../auth/AuthContext';
import { canWriteDocuments } from '../auth/permissions';

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

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getFileExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function validateUploadFile(file: File): string | null {
  const ext = getFileExt(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) return '仅支持 .txt / .md 格式';
  if (file.size === 0) return '文件不能为空';
  if (file.size > MAX_FILE_SIZE) return `单文件不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`;
  return null;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function Documents() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = canWriteDocuments(user?.permissions);
  const [docs, setDocs] = useState<Document[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDataset, setUploadDataset] = useState<string>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadIndex, setUploadIndex] = useState(0);

  const load = () => {
    setLoading(true);
    Promise.all([api.getDocuments(), api.getDatasets()])
      .then(([d, ds]) => {
        setDocs(d.documents);
        setDatasets(ds.datasets);
        if (!uploadDataset && ds.datasets[0]) setUploadDataset(ds.datasets[0].id);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const totalBytes = useMemo(
    () => fileList.reduce((sum, f) => sum + (f.size ?? 0), 0),
    [fileList],
  );

  const finishedCount = useMemo(
    () => fileList.filter(f => f.status === 'done' || f.status === 'error').length,
    [fileList],
  );

  const uploadProgress = useMemo(() => {
    if (fileList.length === 0) return 0;
    return Math.round((finishedCount / fileList.length) * 100);
  }, [fileList.length, finishedCount]);

  const currentUploadFile = uploading ? fileList[uploadIndex] : undefined;

  const resetUploadModal = () => {
    setFileList([]);
    setUploadIndex(0);
    setUploading(false);
  };

  const openUploadModal = () => {
    resetUploadModal();
    setUploadOpen(true);
  };

  const closeUploadModal = () => {
    if (uploading) return;
    setUploadOpen(false);
    resetUploadModal();
  };

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

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;

    const errors: string[] = [];
    let addedCount = 0;

    setFileList(prev => {
      const existing = new Set(
        prev.map(f => f.originFileObj instanceof File ? fileKey(f.originFileObj) : f.uid),
      );
      const next = [...prev];

      for (const file of incoming) {
        const err = validateUploadFile(file);
        if (err) {
          errors.push(`${file.name}：${err}`);
          continue;
        }
        const key = fileKey(file);
        if (existing.has(key)) continue;
        existing.add(key);
        next.push({
          uid: key,
          name: file.name,
          size: file.size,
          originFileObj: file,
        } as UploadFile);
        addedCount++;
      }

      return next;
    });

    errors.slice(0, 3).forEach(msg => message.warning(msg));
    if (errors.length > 3) message.warning(`还有 ${errors.length - 3} 个文件不符合要求`);
    if (addedCount > 1) message.success(`已添加 ${addedCount} 个文件`);
  };

  const removeFile = (uid: string) => {
    if (uploading) return;
    setFileList(prev => prev.filter(f => f.uid !== uid));
  };

  const doUpload = async () => {
    if (fileList.length === 0) { message.warning('请先选择文件'); return; }
    if (!uploadDataset) { message.warning('请选择目标数据集'); return; }

    setUploading(true);
    setUploadIndex(0);
    let success = 0;
    let fail = 0;
    const ds = datasets.find(d => d.id === uploadDataset);
    const queue = fileList.filter(f => f.originFileObj instanceof File);

    const uploadOne = async (f: UploadFile, index: number) => {
      setUploadIndex(index);
      setFileList(prev => prev.map(pf => pf.uid === f.uid ? { ...pf, status: 'uploading' } : pf));
      try {
        await api.uploadDocument(f.originFileObj as File, ds?.name ?? 'default');
        success++;
        setFileList(prev => prev.map(pf => pf.uid === f.uid ? { ...pf, status: 'done' } : pf));
      } catch {
        fail++;
        setFileList(prev => prev.map(pf => pf.uid === f.uid ? { ...pf, status: 'error' } : pf));
      }
    };

    const concurrency = 3;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        await uploadOne(queue[index]!, index);
      }
    });
    await Promise.all(workers);

    setUploading(false);
    if (success > 0) {
      message.success(`上传完成：${success} 成功${fail > 0 ? `，${fail} 失败` : ''}，后台将自动解析入库`);
    } else {
      message.error('上传失败，请检查文件格式或网络后重试');
    }
    if (fail === 0) {
      setUploadOpen(false);
      resetUploadModal();
    }
    load();
  };

  const handleBeforeUpload = (file: File) => {
    const err = validateUploadFile(file);
    if (err) {
      message.warning(`${file.name}：${err}`);
      return AntUpload.LIST_IGNORE;
    }
    addFiles([file]);
    return false;
  };

  const handleDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
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
      onFilter: (value: unknown, r: Document) => r.status === value,
      render: (s: Document['status']) => {
        const cfg = statusConfig[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: '大小', dataIndex: 'fileSize', key: 'fileSize', render: (v: number) => formatFileSize(v), width: 110 },
    { title: '块数', dataIndex: 'chunkCount', key: 'chunkCount', width: 80, render: (v: number) => v?.toLocaleString() ?? '—' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 175, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: Document) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/documents/${r.id}`)}>查看</Button>
          {canWrite && (
            <Popconfirm title="确认删除？" onConfirm={() => { api.deleteDocument(r.id).then(() => { message.success('已删除'); load(); }).catch(() => message.error('失败')); }}>
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const filtered = docs.filter(d => !search || d.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <Card bordered={false}>
        <div className="kc-toolbar">
          {canWrite && (
            <Button type="primary" icon={<UploadOutlined />} onClick={openUploadModal}>上传文档</Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          {canWrite && (
            <>
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
            </>
          )}
          {canWrite && selectedKeys.length > 0 && (
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
          rowSelection={canWrite ? { selectedRowKeys: selectedKeys, onChange: keys => setSelectedKeys(keys as string[]) } : undefined}
        />
      </Card>

      <Modal
        className="kc-upload-modal"
        title={null}
        open={uploadOpen}
        onCancel={closeUploadModal}
        width={480}
        destroyOnClose
        centered
        maskClosable={!uploading}
        closable={!uploading}
        footer={null}
      >
        <div className="kc-upload-modal__head">
          <h3 className="kc-upload-modal__title">上传文档</h3>
        </div>

        <div className={`kc-upload-panel${uploading ? ' kc-upload-panel--busy' : ''}`}>
          <div className="kc-upload-panel__bar">
            <Select
              size="small"
              placeholder="选择数据集"
              value={uploadDataset}
              onChange={v => setUploadDataset(v)}
              disabled={uploading}
              className="kc-upload-panel__dataset"
              options={datasets.map(d => ({ value: d.id, label: datasetDisplayName(d.name) }))}
            />
            {fileList.length > 0 && !uploading && (
              <button type="button" className="kc-upload-panel__clear" onClick={() => setFileList([])}>
                清空
              </button>
            )}
          </div>

          <div className="kc-upload-panel__content">
            {fileList.length === 0 ? (
              <Upload.Dragger
                className="kc-upload-panel__drop"
                multiple
                accept=".txt,.md"
                showUploadList={false}
                disabled={uploading}
                beforeUpload={handleBeforeUpload}
                onDrop={handleDrop}
              >
                <div className="kc-upload-panel__empty">
                  <div className="kc-upload-panel__empty-icon">
                    <UploadOutlined />
                  </div>
                  <p className="kc-upload-panel__empty-title">拖拽或点击选择文件</p>
                  <p className="kc-upload-panel__empty-desc">支持批量多选 · .txt · .md · 最大 50MB</p>
                </div>
              </Upload.Dragger>
            ) : (
              <>
                <ul className="kc-upload-panel__list">
                  {fileList.map(file => {
                    const status = file.status ?? 'ready';
                    return (
                      <li key={file.uid} className={`kc-upload-panel__item kc-upload-panel__item--${status}`}>
                        <span className="kc-upload-panel__item-icon"><FileTextOutlined /></span>
                        <span className="kc-upload-panel__item-name" title={file.name}>{file.name}</span>
                        <span className="kc-upload-panel__item-size">{formatFileSize(file.size ?? 0)}</span>
                        {status === 'uploading' && <LoadingOutlined className="kc-upload-panel__item-state" spin />}
                        {status === 'done' && uploading && <CheckCircleOutlined className="kc-upload-panel__item-state kc-upload-panel__item-state--ok" />}
                        {status === 'error' && <CloseCircleOutlined className="kc-upload-panel__item-state kc-upload-panel__item-state--err" />}
                        {!uploading && status !== 'uploading' && (
                          <button type="button" className="kc-upload-panel__item-remove" aria-label="移除" onClick={() => removeFile(file.uid)}>
                            <DeleteOutlined />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {!uploading && (
                  <Upload
                    className="kc-upload-panel__more"
                    multiple
                    accept=".txt,.md"
                    showUploadList={false}
                    beforeUpload={handleBeforeUpload}
                  >
                    <span className="kc-upload-panel__more-link"><PlusOutlined /> 继续添加（可多选）</span>
                  </Upload>
                )}
              </>
            )}
          </div>

          {uploading && (
            <div className="kc-upload-panel__progress">
              <Progress percent={uploadProgress} size="small" showInfo={false} strokeColor="#1677ff" />
              <span className="kc-upload-panel__progress-text">
                {finishedCount}/{fileList.length} 已完成
                {currentUploadFile?.name ? ` · ${currentUploadFile.name}` : ''}
              </span>
            </div>
          )}
        </div>

        <div className="kc-upload-modal__actions">
          <Button onClick={closeUploadModal} disabled={uploading}>取消</Button>
          <Button
            type="primary"
            loading={uploading}
            disabled={fileList.length === 0 || !uploadDataset}
            onClick={() => { void doUpload(); }}
          >
            {uploading
              ? '上传中…'
              : fileList.length > 0
                ? `上传 ${fileList.length} 个文件 · ${formatFileSize(totalBytes)}`
                : '开始上传'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
