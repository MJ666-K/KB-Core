import { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, InputNumber, Switch, message, Popconfirm, Card, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Model } from '../types';
import { defaultTablePagination } from '../tablePagination';
import { useAuth } from '../auth/AuthContext';
import { canManageModels } from '../auth/permissions';

export default function Models() {
  const { user } = useAuth();
  const canManage = canManageModels(user?.permissions);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Model | null>(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.getModels()
      .then(r => setModels(r.models))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const onEdit = (m: Model | null) => {
    setEditing(m);
    form.resetFields();
    if (m) form.setFieldsValue(m);
    setModalOpen(true);
  };

  const onSave = () => {
    form.validateFields().then(values => {
      const req = editing ? api.updateModel(editing.id, values) : api.createModel(values);
      req
        .then(() => { message.success(`${editing ? '更新' : '创建'}成功`); setModalOpen(false); load(); })
        .catch(() => message.error('保存失败'));
    });
  };

  const onDel = (id: string) => {
    api.deleteModel(id)
      .then(() => { message.success('已删除'); load(); })
      .catch(() => message.error('删除失败'));
  };

  const cols = [
    { title: '标识', dataIndex: 'name', key: 'name', render: (v: string) => <code>{v}</code> },
    { title: '显示名', dataIndex: 'displayName', key: 'displayName', render: (v: string) => <strong>{v}</strong> },
    { title: 'API URL', dataIndex: 'apiUrl', key: 'apiUrl', ellipsis: true, render: (v: string) => v || <span className="kc-text-muted">默认</span> },
    { title: 'Temperature', dataIndex: 'temperature', key: 'temperature', render: (v: number) => <Tag color="blue">{v?.toFixed(1) ?? '—'}</Tag> },
    { title: 'MaxTokens', dataIndex: 'maxTokens', key: 'maxTokens', render: (v: number) => <Tag>{v?.toLocaleString() ?? '—'}</Tag> },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', render: (v: boolean) => v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag> },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: Model) => (
        <Space>
          {canManage && (
            <>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(r)}>编辑</Button>
              <Popconfirm title="确认删除该模型？" description="请先确保没有智能体使用该模型" onConfirm={() => onDel(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card bordered={false}>
        <div className="kc-toolbar">
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => onEdit(null)}>新增模型</Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </div>
        <Table dataSource={models} columns={cols} loading={loading} rowKey="id" size="middle" pagination={defaultTablePagination} />
      </Card>
      <Modal title={editing ? `编辑: ${editing.displayName}` : '新增模型'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={onSave} width={780} okText="保存" cancelText="取消" styles={{ body: { padding: '12px 20px' } }}>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="name" label="标识" rules={[{ required: true, message: '请输入标识' }]} style={{ margin: 0 }}>
              <Input disabled={!!editing} placeholder="e.g. qwen-max" />
            </Form.Item>
            <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]} style={{ margin: 0 }}>
              <Input placeholder="e.g. 通义千问-Max" />
            </Form.Item>
          </div>
          <Form.Item name="apiUrl" label="API URL" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input placeholder="留空使用全局配置" />
          </Form.Item>
          <div className="kc-form-params-box">
            <div className="kc-form-params-box__title">推理参数</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item name="temperature" label="Temperature" rules={[{ required: true }]} style={{ margin: 0 }}>
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="maxTokens" label="Max Tokens" rules={[{ required: true }]} style={{ margin: 0 }}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </div>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true} style={{ marginTop: 12, marginBottom: 0 }}>
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
