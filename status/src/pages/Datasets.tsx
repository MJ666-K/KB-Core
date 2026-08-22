import { useCallback, useEffect, useState } from 'react';
import {
  Button, Table, Tag, Modal, Input, Select, InputNumber, Form, Space,
  Popconfirm, Drawer, message, Tooltip, Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { canUseDatasets } from '../auth/permissions';
import type { Dataset, DatasetMember } from '../types';

const { Text } = Typography;

const VISIBILITY_LABEL: Record<Dataset['visibility'], string> = {
  private: '私有', shared: '共享', public: '公开',
};
const VISIBILITY_COLOR: Record<Dataset['visibility'], string> = {
  private: 'default', shared: 'blue', public: 'green',
};

type FormValues = {
  name: string;
  description?: string;
  visibility: Dataset['visibility'];
  parentTokens?: number;
  childTokens?: number;
  overlapTokens?: number;
  searchTopK?: number;
  denseTopKMultiplier?: number;
  rrfK?: number;
  rerankTopK?: number;
  denseMinSimilarity?: number;
  rerankMinScore?: number;
};

function toFormValues(d: Dataset): FormValues {
  return {
    name: d.name,
    description: d.description ?? undefined,
    visibility: d.visibility,
    parentTokens: d.chunkConfig?.parentTokens,
    childTokens: d.chunkConfig?.childTokens,
    overlapTokens: d.chunkConfig?.overlapTokens,
    searchTopK: d.retrieveConfig?.searchTopK,
    denseTopKMultiplier: d.retrieveConfig?.denseTopKMultiplier,
    rrfK: d.retrieveConfig?.rrfK,
    rerankTopK: d.retrieveConfig?.rerankTopK,
    denseMinSimilarity: d.retrieveConfig?.denseMinSimilarity,
    rerankMinScore: d.retrieveConfig?.rerankMinScore,
  };
}

export default function Datasets() {
  const { user } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Dataset | null>(null);
  const [membersOpen, setMembersOpen] = useState<Dataset | null>(null);
  const [members, setMembers] = useState<DatasetMember[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [createForm] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDatasets();
      setDatasets(res.datasets);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ visibility: 'private' });
    setCreateOpen(true);
  };

  const openEdit = (d: Dataset) => {
    form.setFieldsValue(toFormValues(d));
    setEditing(d);
  };

  const loadMembers = async (d: Dataset) => {
    try {
      const res = await api.getDatasetMembers(d.id);
      setMembers(res.members);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '加载成员失败');
    }
  };

  const submitCreate = async () => {
    const v = await createForm.validateFields();
    setSubmitting(true);
    try {
      const { parentTokens, childTokens, overlapTokens, searchTopK, denseTopKMultiplier, rrfK, rerankTopK, denseMinSimilarity, rerankMinScore, ...rest } = v;
      await api.createDataset({
        ...rest,
        chunkConfig: { parentTokens, childTokens, overlapTokens } as Record<string, number>,
        retrieveConfig: { searchTopK, denseTopKMultiplier, rrfK, rerankTopK, denseMinSimilarity, rerankMinScore } as Record<string, number>,
      });
      void message.success('创建成功');
      setCreateOpen(false);
      void load();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const { parentTokens, childTokens, overlapTokens, searchTopK, denseTopKMultiplier, rrfK, rerankTopK, denseMinSimilarity, rerankMinScore, ...rest } = v;
      await api.updateDataset(editing.id, {
        ...rest,
        chunkConfig: { parentTokens, childTokens, overlapTokens },
        retrieveConfig: { searchTopK, denseTopKMultiplier, rrfK, rerankTopK, denseMinSimilarity, rerankMinScore },
      });
      void message.success('已保存');
      setEditing(null);
      void load();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (d: Dataset) => {
    try {
      await api.deleteDataset(d.id);
      void message.success('已删除');
      void load();
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const canUse = canUseDatasets(user?.permissions);

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (name: string, r: Dataset) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {r.description && <Text type="secondary" style={{ fontSize: 12 }}>{r.description}</Text>}
        </Space>
      ),
    },
    {
      title: '可见性', dataIndex: 'visibility', key: 'visibility',
      render: (v: Dataset['visibility']) => <Tag color={VISIBILITY_COLOR[v]}>{VISIBILITY_LABEL[v]}</Tag>,
    },
    {
      title: '类型', dataIndex: 'kind', key: 'kind',
      render: (k: string) => k === 'kg' ? <Tag>知识图谱</Tag> : <Tag>文档</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt',
      render: (t: string) => new Date(t).toLocaleString(),
    },
    {
      title: '操作', key: 'action', width: 240,
      render: (_: unknown, r: Dataset) => (
        <Space>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          {r.visibility === 'shared' && (
            <Tooltip title="成员管理">
              <Button size="small" icon={<TeamOutlined />} onClick={() => { void loadMembers(r); setMembersOpen(r); }} />
            </Tooltip>
          )}
          <Popconfirm title="确认删除？库内文档与切片将一并删除" onConfirm={() => remove(r)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Text type="secondary">管理你的知识库：私有库 · 切割/召回策略 · 共享成员</Text>
        {canUse && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建知识库</Button>}
      </div>

      <Table rowKey="id" loading={loading} dataSource={datasets} columns={columns} pagination={false} />

      <Modal title="新建知识库" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建">
        <Form form={createForm} layout="vertical" initialValues={{ visibility: 'private' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：我的法律资料" maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="visibility" label="可见性" rules={[{ required: true }]}>
            <Select options={[
              { value: 'private', label: '私有（仅创建者）' },
              { value: 'shared', label: '共享（指定成员）' },
              { value: 'public', label: '公开（所有人可读）' },
            ]} />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>切割/召回配置可在创建后于编辑页设置，留空则使用全局默认。</Text>
      </Modal>

      <Drawer title="编辑知识库" open={!!editing} onClose={() => setEditing(null)} width={480} extra={<Button type="primary" loading={submitting} onClick={submitEdit}>保存</Button>}>
        {editing && (
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
            <Form.Item name="visibility" label="可见性" rules={[{ required: true }]}>
              <Select options={[
                { value: 'private', label: '私有' },
                { value: 'shared', label: '共享' },
                { value: 'public', label: '公开' },
              ]} />
            </Form.Item>

            <Typography.Title level={5} style={{ marginTop: 16 }}>切割配置（留空用全局默认，仅对新入库生效）</Typography.Title>
            <Space wrap>
              <Form.Item name="parentTokens" label="父块 tokens"><InputNumber min={100} max={8000} placeholder="1200" /></Form.Item>
              <Form.Item name="childTokens" label="子块 tokens"><InputNumber min={50} max={2000} placeholder="300" /></Form.Item>
              <Form.Item name="overlapTokens" label="重叠 tokens"><InputNumber min={0} max={500} placeholder="50" /></Form.Item>
            </Space>

            <Typography.Title level={5} style={{ marginTop: 16 }}>召回配置（留空用全局默认）</Typography.Title>
            <Space wrap>
              <Form.Item name="searchTopK" label="TopK"><InputNumber min={1} max={100} placeholder="10" /></Form.Item>
              <Form.Item name="denseTopKMultiplier" label="扩展倍数"><InputNumber min={1} max={20} placeholder="3" /></Form.Item>
              <Form.Item name="rrfK" label="RRF K"><InputNumber min={1} max={200} placeholder="60" /></Form.Item>
              <Form.Item name="rerankTopK" label="Rerank K"><InputNumber min={1} max={100} placeholder="20" /></Form.Item>
              <Form.Item name="denseMinSimilarity" label="dense 阈值"><InputNumber min={0} max={1} step={0.05} placeholder="0.65" /></Form.Item>
              <Form.Item name="rerankMinScore" label="rerank 阈值"><InputNumber min={0} max={1} step={0.05} placeholder="0.5" /></Form.Item>
            </Space>
          </Form>
        )}
      </Drawer>

      <MembersModal dataset={membersOpen} members={members} onClose={() => setMembersOpen(null)} onChanged={() => membersOpen && loadMembers(membersOpen)} />
    </div>
  );
}

function MembersModal({ dataset, members, onClose, onChanged }: {
  dataset: Dataset | null;
  members: DatasetMember[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<DatasetMember['role']>('viewer');
  if (!dataset) return null;
  return (
    <Modal title={`成员管理 · ${dataset.name}`} open={!!dataset} onCancel={onClose} footer={null} width={560}>
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input placeholder="用户 ID（uuid）" value={newUserId} onChange={e => setNewUserId(e.target.value)} />
        <Select value={newRole} onChange={setNewRole} style={{ width: 120 }} options={[
          { value: 'viewer', label: 'viewer' },
          { value: 'editor', label: 'editor' },
          { value: 'manager', label: 'manager' },
        ]} />
        <Button type="primary" onClick={async () => {
          if (!newUserId) return;
          try { await api.addDatasetMember(dataset.id, { userId: newUserId, role: newRole }); setNewUserId(''); onChanged(); void message.success('已添加'); }
          catch (e) { void message.error(e instanceof Error ? e.message : '添加失败'); }
        }}>添加</Button>
      </Space.Compact>
      <Table rowKey="userId" size="small" dataSource={members} pagination={false} columns={[
        { title: '用户 ID', dataIndex: 'userId', key: 'userId', render: (u: string) => <Text copyable>{u.slice(0, 8)}…</Text> },
        { title: '角色', dataIndex: 'role', key: 'role', render: (r: string) => <Tag>{r}</Tag> },
        {
          title: '操作', key: 'op', render: (_: unknown, m: DatasetMember) => (
            <Popconfirm title="移除该成员？" onConfirm={async () => {
              try { await api.removeDatasetMember(dataset.id, m.userId); onChanged(); void message.success('已移除'); }
              catch (e) { void message.error(e instanceof Error ? e.message : '移除失败'); }
            }}>
              <Button size="small" danger>移除</Button>
            </Popconfirm>
          ),
        },
      ]} />
    </Modal>
  );
}
