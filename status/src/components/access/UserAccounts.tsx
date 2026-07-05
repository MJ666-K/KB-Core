import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, Select, Switch, message, Popconfirm, Tag, Typography, Row, Col,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, UserOutlined, LockOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { defaultTablePagination } from '../../tablePagination';
import PermissionGroupDisplay from './PermissionGroupDisplay';

const { Text } = Typography;

interface UserRow {
  id: string;
  username: string;
  role: string;
  roleLabel?: string;
  disabled: boolean;
  createdAt: string;
}

interface RoleOption {
  id: string;
  key: string;
  label: string;
  description: string;
  permissions: string[];
}

function RolePreview({ role }: { role: RoleOption }) {
  return (
    <div className="kc-user-role-preview">
      <div className="kc-user-role-preview-top">
        <Text strong>{role.label}</Text>
        <Text type="secondary" className="kc-user-role-preview-key">{role.key}</Text>
      </div>
      {role.description && (
        <Text type="secondary" className="kc-user-role-preview-desc">{role.description}</Text>
      )}
      <PermissionGroupDisplay permissions={role.permissions} compact />
    </div>
  );
}

export default function UserAccounts() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form] = Form.useForm();
  const selectedRoleKey = Form.useWatch('role', form) as string | undefined;

  const load = () => {
    setLoading(true);
    Promise.all([api.getUsers(), api.getAssignableRoles()])
      .then(([u, r]) => {
        setUsers(u.users);
        setRoles(r.roles);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const selectedRole = roles.find(r => r.key === selectedRoleKey);
  const isCreate = !editing;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: roles[0]?.key ?? 'user', disabled: false });
    setModalOpen(true);
  };

  const openEdit = (row: UserRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ role: row.role, disabled: row.disabled });
    setModalOpen(true);
  };

  const onSave = () => {
    form.validateFields().then(values => {
      if (editing) {
        const payload: { role?: string; password?: string; disabled?: boolean } = { disabled: values.disabled };
        if (values.password) payload.password = values.password;
        if (values.role !== editing.role) payload.role = values.role;
        api.updateUser(editing.id, payload)
          .then(() => { message.success('已更新'); setModalOpen(false); load(); })
          .catch(err => message.error(err instanceof Error ? err.message : '更新失败'));
      } else {
        api.createUser({ username: values.username, password: values.password, role: values.role })
          .then(() => { message.success('用户已创建'); setModalOpen(false); load(); })
          .catch(err => message.error(err instanceof Error ? err.message : '创建失败'));
      }
    });
  };

  const cols = [
    { title: '用户名', dataIndex: 'username', render: (v: string) => <strong>{v}</strong> },
    { title: '角色', render: (_: unknown, row: UserRow) => <Tag>{row.roleLabel ?? row.role}</Tag> },
    {
      title: '状态', dataIndex: 'disabled', width: 80,
      render: (v: boolean) => v ? <Tag color="error">禁用</Tag> : <Tag color="success">正常</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', width: 130,
      render: (_: unknown, row: UserRow) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          {row.id !== currentUser?.id && (
            <Popconfirm title="确定删除？" onConfirm={() => {
              api.deleteUser(row.id)
                .then(() => { message.success('已删除'); load(); })
                .catch(err => message.error(err instanceof Error ? err.message : '删除失败'));
            }}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="kc-access-toolbar">
        <Text type="secondary">管理登录账号，通过分配角色控制访问权限</Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button>
        </Space>
      </div>

      <Table rowKey="id" loading={loading} dataSource={users} columns={cols} pagination={defaultTablePagination} />

      <Modal
        title={isCreate ? '新建用户' : `编辑 · ${editing.username}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        okText={isCreate ? '创建' : '保存'}
        width={760}
        destroyOnClose
        className="kc-user-modal"
        styles={{ body: { padding: '12px 20px 4px' } }}
      >
        <Form form={form} layout="vertical" requiredMark={false} className="kc-user-form" size="middle">
          {isCreate ? (
            <>
              <Row gutter={16} align="top">
                <Col span={8}>
                  <Form.Item name="username" label="用户名" rules={[
                    { required: true, message: '必填' },
                    { pattern: /^[a-zA-Z0-9_-]+$/, message: '格式不正确' },
                  ]}>
                    <Input prefix={<UserOutlined />} placeholder="analyst_01" maxLength={64} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="password" label="初始密码" rules={[
                    { required: true, message: '必填' },
                    { min: 6, message: '至少 6 位' },
                  ]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="role" label="角色" rules={[{ required: true, message: '必选' }]}>
                    <Select
                      placeholder="选择角色"
                      optionLabelProp="label"
                      options={roles.map(r => ({ value: r.key, label: r.label, desc: r.description }))}
                      optionRender={(opt) => (
                        <div className="kc-user-role-option">
                          <span className="kc-user-role-option-label">{opt.label}</span>
                          {opt.data.desc && <span className="kc-user-role-option-desc">{opt.data.desc as string}</span>}
                        </div>
                      )}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {selectedRole && <RolePreview role={selectedRole} />}
            </>
          ) : (
            <Row gutter={16} align="top">
              <Col span={12}>
                <Form.Item name="password" label="新密码" extra="留空不修改">
                  <Input.Password prefix={<LockOutlined />} placeholder="留空不修改" />
                </Form.Item>
                <Form.Item name="role" label="角色" rules={[{ required: true }]}>
                  <Select
                    options={roles.map(r => ({ value: r.key, label: r.label }))}
                    disabled={editing.id === currentUser?.id}
                  />
                </Form.Item>
                <Form.Item name="disabled" label="状态" valuePropName="checked">
                  <Switch checkedChildren="禁用" unCheckedChildren="正常" disabled={editing.id === currentUser?.id} />
                </Form.Item>
              </Col>
              <Col span={12}>
                {selectedRole && <RolePreview role={selectedRole} />}
              </Col>
            </Row>
          )}
        </Form>
      </Modal>
    </>
  );
}
