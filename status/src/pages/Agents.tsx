import { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Select, Switch, message, Popconfirm, Card, Tag } from 'antd';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Agent, Dataset } from '../types';
import { datasetDisplayName } from '../datasetLabels';
import { defaultTablePagination } from '../tablePagination';

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api.getAgents(), api.getDatasets(), api.getModels()])
      .then(([a, d, m]) => { setAgents(a.agents); setDatasets(d.datasets); setModels(m.models); })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const onEdit = (agent: Agent | null) => {
    setEditing(agent);
    form.resetFields();
    if (agent) form.setFieldsValue({
      ...agent,
      modelId: agent.model?.id || agent.modelId || '',
      datasetIds: agent.datasetIds || [],
    });
    setModalOpen(true);
  };

  const onSave = () => {
    form.validateFields().then(values => {
      const req = editing ? api.updateAgent(editing.id, values) : api.createAgent(values);
      req
        .then(() => { message.success(`${editing ? '更新' : '创建'}成功`); setModalOpen(false); load(); })
        .catch(() => message.error('保存失败'));
    });
  };

  const onDel = (id: string) => {
    api.deleteAgent(id)
      .then(() => { message.success('已删除'); load(); })
      .catch(() => message.error('删除失败'));
  };

  const filtered = agents.filter(a =>
    !search ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.displayName.toLowerCase().includes(search.toLowerCase())
  );

  const cols = [
    { title: '标识', dataIndex: 'name', key: 'name', render: (v: string) => <code>{v}</code> },
    { title: '显示名', dataIndex: 'displayName', key: 'displayName', render: (v: string) => <strong>{v}</strong> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '模型', dataIndex: 'model', key: 'model', render: (v: any) => v?.displayName ? <Tag color="blue">{v.displayName}</Tag> : <Tag color="default">未配置</Tag> },
    {
      title: '数据集', dataIndex: 'datasetIds', key: 'datasetIds',
      render: (ids: string[]) => {
        if (!ids?.length) return <span className="kc-text-muted">—</span>;
        return (
          <Space size={[4, 4]} wrap>
            {ids.map(id => {
              const ds = datasets.find(d => d.id === id);
              return <Tag key={id}>{datasetDisplayName(ds?.name ?? id)}</Tag>;
            })}
          </Space>
        );
      },
    },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', render: (v: boolean) => v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag> },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: Agent) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该智能体？" onConfirm={() => onDel(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card bordered={false}>
        <div className="kc-toolbar">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => onEdit(null)}>新建 Agent</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Input placeholder="搜索标识 / 显示名..." prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} allowClear style={{ width: 240, marginLeft: 'auto' }} />
        </div>
        <Table dataSource={filtered} columns={cols} loading={loading} rowKey="id" size="middle" pagination={defaultTablePagination} />
      </Card>
      <Modal title={editing ? `编辑: ${editing.displayName}` : '新建 Agent'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={onSave} width={780} okText="保存" cancelText="取消" styles={{ body: { padding: '12px 20px' } }}>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="name" label="标识" rules={[{ required: true, message: '请输入标识' }]} style={{ margin: 0 }}>
              <Input disabled={!!editing} placeholder="e.g. general_legal" />
            </Form.Item>
            <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]} style={{ margin: 0 }}>
              <Input placeholder="e.g. 通用法律助手" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder="该智能体的专长领域和适用场景..." />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Form.Item name="datasetIds" label="数据集" style={{ margin: 0 }}>
              <Select mode="multiple" placeholder="可多选" allowClear showSearch optionFilterProp="label" options={datasets.map(d => ({ value: d.id, label: datasetDisplayName(d.name) }))} />
            </Form.Item>
            <Form.Item name="modelId" label="模型" rules={[{ required: true, message: '请选择模型' }]} style={{ margin: 0 }}>
              <Select placeholder="选择模型" showSearch optionFilterProp="label" options={models.map(m => ({ value: m.id, label: `${m.displayName} (${m.modelId})` }))} />
            </Form.Item>
          </div>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true} style={{ marginTop: 12, marginBottom: 0 }}>
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
