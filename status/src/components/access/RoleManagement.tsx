import { useEffect, useState } from 'react';
import {
  Button, Space, Modal, Form, Input, message, Popconfirm, Tag, Typography, Checkbox, Row, Col, Empty, Spin,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, LockOutlined, TeamOutlined } from '@ant-design/icons';
import { api } from '../../api';
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

interface PermGroup {
  title: string;
  permissions: Array<{ key: string; label: string }>;
}

export default function RoleManagement() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form] = Form.useForm();
  const selectedPerms = Form.useWatch('permissions', form) as string[] | undefined;

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
    form.setFieldsValue({ permissions: ['chat:use', 'documents:read'] });
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
        .then(() => { message.success(editing ? '已更新' : '已创建'); setModalOpen(false); load(); })
        .catch(err => message.error(err instanceof Error ? err.message : '保存失败'));
    });
  };

  const togglePerm = (perm: string, checked: boolean) => {
    const current = selectedPerms ?? [];
    form.setFieldValue('permissions', checked ? [...current, perm] : current.filter(p => p !== perm));
  };

  if (loading) return <div className="kc-access-loading"><Spin /></div>;

  return (
    <>
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

      <Modal
        title={editing ? `编辑角色 · ${editing.label}` : '新建角色'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        okText={editing ? '保存' : '创建'}
        width={720}
        destroyOnClose
        className="kc-role-modal"
        styles={{ body: { padding: '12px 20px 4px' } }}
      >
        <Form form={form} layout="vertical" requiredMark={false} className="kc-role-form" size="middle">
          <Row gutter={16}>
            {!editing && (
              <Col span={8}>
                <Form.Item name="key" label="标识" extra="创建后不可改" rules={[
                  { required: true }, { pattern: /^[a-z][a-z0-9_]*$/, message: '格式不正确' },
                ]}>
                  <Input placeholder="reviewer" maxLength={32} />
                </Form.Item>
              </Col>
            )}
            <Col span={editing ? 12 : 8}>
              <Form.Item name="label" label="名称" rules={[{ required: true }]}>
                <Input placeholder="审核员" maxLength={64} />
              </Form.Item>
            </Col>
            <Col span={editing ? 12 : 8}>
              <Form.Item name="description" label="描述">
                <Input placeholder="角色用途说明" maxLength={256} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="permissions"
            label={`权限（已选 ${(selectedPerms ?? []).length} 项）`}
            rules={[{ required: true, type: 'array', min: 1, message: '至少选一项' }]}
          >
            <div className="kc-perm-picker-grid">
              {groups.map(group => (
                <div key={group.title} className="kc-perm-picker-col">
                  <div className="kc-perm-picker-col-title">{group.title}</div>
                  <div className="kc-perm-picker-col-items">
                    {group.permissions.map(p => (
                      <Checkbox
                        key={p.key}
                        checked={(selectedPerms ?? []).includes(p.key)}
                        onChange={e => togglePerm(p.key, e.target.checked)}
                      >
                        {p.label}
                      </Checkbox>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
