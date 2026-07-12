import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Form, Input, Select, Switch, message, Popconfirm, Tag, Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, UserOutlined, LockOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { defaultTablePagination } from '../../tablePagination';
import AccessModal from './AccessModal';
import RoleSelector from './RoleSelector';
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

export default function UserAccounts() {
  const { user: currentUser, refreshProfile } = useAuth();
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
          .then(async () => {
            if (editing.id === currentUser?.id) {
              await refreshProfile();
            }
            message.success(
              editing.id === currentUser?.id
                ? '已更新，当前账号权限已同步'
                : '已更新。该用户需刷新页面后权限才会生效',
            );
            setModalOpen(false);
            load();
          })
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

      <AccessModal
        open={modalOpen}
        title={isCreate ? '新建用户' : `编辑用户 · ${editing?.username}`}
        subtitle={isCreate ? '创建登录账号并分配角色，权限随角色自动生效' : '修改密码、角色或账号状态'}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        okText={isCreate ? '创建用户' : '保存修改'}
        width={isCreate ? 680 : 560}
      >
        <Form form={form} layout="vertical" requiredMark={false} className="kc-access-form" size="middle">
          {isCreate ? (
            <>
              <div className="kc-access-form__section">
                <div className="kc-access-form__section-title">账号信息</div>
                <div className="kc-access-form__row">
                  <Form.Item name="username" label="用户名" rules={[
                    { required: true, message: '必填' },
                    { pattern: /^[a-zA-Z0-9_-]+$/, message: '仅支持字母、数字、下划线和连字符' },
                  ]}>
                    <Input prefix={<UserOutlined />} placeholder="analyst_01" maxLength={64} />
                  </Form.Item>
                  <Form.Item name="password" label="初始密码" rules={[
                    { required: true, message: '必填' },
                    { min: 6, message: '至少 6 位' },
                  ]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" />
                  </Form.Item>
                </div>
              </div>

              <div className="kc-access-form__section">
                <div className="kc-access-form__section-title">分配角色</div>
                <Form.Item name="role" rules={[{ required: true, message: '请选择角色' }]} className="kc-access-form__role-field">
                  <RoleSelector roles={roles} />
                </Form.Item>
              </div>
            </>
          ) : (
            <>
              <div className="kc-access-form__section">
                <div className="kc-access-form__section-title">安全设置</div>
                <Form.Item name="password" label="新密码" extra="留空则不修改密码">
                  <Input.Password prefix={<LockOutlined />} placeholder="留空不修改" />
                </Form.Item>
                <Form.Item name="role" label="角色" rules={[{ required: true }]}>
                  <Select
                    options={roles.map(r => ({ value: r.key, label: r.label }))}
                    disabled={editing?.id === currentUser?.id}
                  />
                </Form.Item>
                <Form.Item name="disabled" label="账号状态" valuePropName="checked">
                  <Switch checkedChildren="禁用" unCheckedChildren="正常" disabled={editing?.id === currentUser?.id} />
                </Form.Item>
              </div>

              {selectedRole && (
                <div className="kc-access-form__section">
                  <div className="kc-access-form__section-title">当前角色权限</div>
                  <div className="kc-role-selector__preview">
                    <div className="kc-role-selector__preview-head">
                      <span className="kc-role-selector__preview-title">{selectedRole.label}</span>
                      <span className="kc-role-selector__preview-count">{selectedRole.permissions.length} 项</span>
                    </div>
                    <PermissionGroupDisplay permissions={selectedRole.permissions} compact />
                  </div>
                </div>
              )}
            </>
          )}
        </Form>
      </AccessModal>
    </>
  );
}
