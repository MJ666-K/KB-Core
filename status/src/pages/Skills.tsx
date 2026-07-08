import { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, Switch, message, Popconfirm, Card, Tag, Select } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Skill } from '../types';
import { defaultTablePagination } from '../tablePagination';

interface ToolOption {
  name: string;
  description: string;
}

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [toolOptions, setToolOptions] = useState<ToolOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([api.getSkills(), api.getSkillToolOptions()])
      .then(([r, tools]) => {
        setSkills(r.skills);
        setToolOptions(tools.tools ?? []);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const onEdit = (s: Skill | null) => {
    setEditing(s);
    form.resetFields();
    if (s) form.setFieldsValue({ ...s, tools: s.tools ?? [] });
    setModalOpen(true);
  };

  const onSave = () => {
    form.validateFields().then(values => {
      const tools = Array.isArray(values.tools) ? values.tools : [];
      const payload = { ...values, tools };
      const req = editing ? api.updateSkill(editing.id, payload) : api.createSkill(payload);
      req
        .then(() => { message.success(`${editing ? '更新' : '创建'}成功`); setModalOpen(false); load(); })
        .catch(() => message.error('保存失败'));
    });
  };

  const onDel = (id: string) => {
    api.deleteSkill(id)
      .then(() => { message.success('已删除'); load(); })
      .catch(() => message.error('删除失败'));
  };

  const cols = [
    { title: '标识', dataIndex: 'name', key: 'name', render: (v: string) => <code>{v}</code> },
    { title: '显示名', dataIndex: 'displayName', key: 'displayName', render: (v: string) => <strong>{v}</strong> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '工具', dataIndex: 'tools', key: 'tools', render: (v: string[]) => v && v.length > 0 ? v.map(t => <Tag key={t} color="blue" style={{ marginRight: 4 }}>{t}</Tag>) : <Tag color="default">无</Tag> },
    { title: '版本', dataIndex: 'version', key: 'version', width: 80 },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80, render: (v: boolean) => v ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag> },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: unknown, r: Skill) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该 Skill？" onConfirm={() => onDel(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const expandedRowRender = (record: Skill) => (
    <div style={{ padding: '12px 0' }}>
      <div style={{ marginBottom: 8 }}>
        <strong className="kc-skills-prompt-label">System Prompt (指令):</strong>
      </div>
      <pre className="kc-skills-prompt-pre">
        {record.instructions || '(无指令)'}
      </pre>
    </div>
  );

  return (
    <div>
      <Card bordered={false}>
        <div className="kc-toolbar">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => onEdit(null)}>新建 Skill</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </div>
        <Table
          dataSource={skills}
          columns={cols}
          loading={loading}
          rowKey="id"
          size="middle"
          pagination={defaultTablePagination}
          expandable={{
            expandedRowRender,
            rowExpandable: record => !!record.instructions,
          }}
        />
      </Card>
      <Modal title={editing ? `编辑: ${editing.displayName}` : '新建 Skill'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={onSave} width={900} okText="保存" cancelText="取消" styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '12px 20px' } }}>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="name" label="标识" rules={[{ required: true, message: '请输入标识' }]} style={{ margin: 0 }}>
              <Input disabled={!!editing} placeholder="e.g. legal_qa" />
            </Form.Item>
            <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]} style={{ margin: 0 }}>
              <Input placeholder="e.g. 法律问答" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder="LLM 用来决定是否调用此 Skill" />
          </Form.Item>
          <Form.Item name="tools" label="可用工具" style={{ marginTop: 12, marginBottom: 0 }} extra="从下拉框选择 Skill 可调用的工具，留空表示纯 LLM 对话">
            <Select
              mode="multiple"
              allowClear
              placeholder="选择工具（可多选）"
              optionFilterProp="label"
              options={toolOptions.map(t => ({
                value: t.name,
                label: t.name,
                title: t.description,
              }))}
              optionRender={(opt) => (
                <div>
                  <div><code>{opt.value}</code></div>
                  <div className="kc-skills-tool-desc">{toolOptions.find(x => x.name === opt.value)?.description}</div>
                </div>
              )}
            />
          </Form.Item>
          <Form.Item name="instructions" label="指令 (Markdown)" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input.TextArea rows={10} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} placeholder="# 执行步骤&#10;1. ...&#10;2. ..." />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true} style={{ marginTop: 12, marginBottom: 0 }}>
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
