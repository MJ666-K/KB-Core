import { useEffect, useState } from 'react';
import {
  Button, Space, Form, Input, message, Popconfirm, Tag, Typography, Empty, Spin,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, LockOutlined, TeamOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import AccessModal from './AccessModal';
import PermissionPicker, { type PermGroup } from './PermissionPicker';
import PermissionGroupDisplay from './PermissionGroupDisplay';

const { Text } = Typography;

interface RoleRow {
  id: string;
  key: string;
  label: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  userCount?: number;
}

const SUPERADMIN_LOCKED = ['users:manage', 'roles:manage'] as const;

export default function RoleManagement() {
  const { user, refreshProfile } = useAuth();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([api.getRoles(), api.getRoleMeta()])
      .then(([r, m]) => {
        setRoles(r.roles);
        setGroups(m.groups);
      })
      .catch(() => message.error('加载角色失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ permissions: ['chat:use', 'kg:view', 'documents:read'] });
    setModalOpen(true);
  };

  const openEdit = (row: RoleRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ label: row.label, description: row.description, permissions: row.permissions });
    setModalOpen(true);
  };

  const onSave = () => {
    form.validateFields().then(values => {
      const req = editing
        ? api.updateRole(editing.id, { label: values.label, description: values.description, permissions: values.permissions })
        : api.createRole({ key: values.key, label: values.label, description: values.description, permissions: values.permissions });
      req
        .then(async () => {
          await load();
          if (editing?.key === user?.role) {
            await refreshProfile();
          }
          message.success(
            editing?.key === user?.role
              ? '已更新，当前账号权限已同步'
              : '已更新。使用该角色的账号需刷新页面后权限才会生效',
          );
          setModalOpen(false);
        })
        .catch(err => message.error(err instanceof Error ? err.message : '保存失败'));
    });
  };

  return (
    <Spin spinning={loading}>
      <div className="kc-access-toolbar">
        <Text type="secondary">自定义角色并配置权限，用户分配角色后自动生效</Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建角色</Button>
        </Space>
      </div>

      {roles.length === 0 ? (
        <Empty description="暂无角色" />
      ) : (
        <div className="kc-role-list">
          {roles.map(role => (
            <div key={role.id} className={`kc-role-row ${role.isSystem ? 'is-system' : ''}`}>
              <div className="kc-role-row-meta">
                <div className="kc-role-row-title-line">
                  <Text strong>{role.label}</Text>
                  {role.isSystem && <Tag bordered={false} color="blue" icon={<LockOutlined />}>内置</Tag>}
                  <code className="kc-role-row-key">{role.key}</code>
                  <span className="kc-role-row-count"><TeamOutlined /> {role.userCount ?? 0}</span>
                </div>
                {role.description && (
                  <Text type="secondary" className="kc-role-row-desc">{role.description}</Text>
                )}
              </div>
              <div className="kc-role-row-perms">
                <span className="kc-role-row-perm-count">{role.permissions.length} 项权限</span>
                <PermissionGroupDisplay permissions={role.permissions} />
              </div>
              <div className="kc-role-row-actions">
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(role)} />
                {!role.isSystem && (
                  <Popconfirm title="确定删除？" onConfirm={() => {
                    api.deleteRole(role.id)
                      .then(() => { message.success('已删除'); load(); })
                      .catch(err => message.error(err instanceof Error ? err.message : '删除失败'));
                  }}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AccessModal
        open={modalOpen}
        title={editing ? `编辑角色 · ${editing.label}` : '新建角色'}
        subtitle={editing ? '修改名称、描述和权限配置' : '定义角色标识与权限，创建后分配给对应用户'}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        okText={editing ? '保存修改' : '创建角色'}
        width={880}
      >
        <Form form={form} layout="vertical" requiredMark={false} className="kc-access-form" size="middle">
          <div className="kc-access-form__section">
            <div className="kc-access-form__section-title">基本信息</div>
            <div className={`kc-access-form__row${editing ? ' kc-access-form__row--2col' : ' kc-access-form__row--3col'}`}>
              {!editing && (
                <Form.Item name="key" label="标识" extra="创建后不可修改" rules={[
                  { required: true, message: '必填' },
                  { pattern: /^[a-z][a-z0-9_]*$/, message: '小写字母开头，仅含字母数字下划线' },
                ]}>
                  <Input placeholder="reviewer" maxLength={32} />
                </Form.Item>
              )}
              <Form.Item name="label" label="名称" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="审核员" maxLength={64} />
              </Form.Item>
              <Form.Item name="description" label="描述">
                <Input placeholder="角色用途说明（可选）" maxLength={256} />
              </Form.Item>
            </div>
          </div>

          <div className="kc-access-form__section">
            <div className="kc-access-form__section-title">权限配置</div>
            <Form.Item
              name="permissions"
              rules={[{ required: true, type: 'array', min: 1, message: '至少选择一项权限' }]}
              className="kc-access-form__perm-field"
            >
              <PermissionPicker
                groups={groups}
                locked={editing?.key === 'superadmin' ? [...SUPERADMIN_LOCKED] : undefined}
              />
            </Form.Item>
          </div>
        </Form>
      </AccessModal>
    </Spin>
  );
}
