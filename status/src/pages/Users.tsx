import { useEffect, useState } from 'react';
import { Tabs, Card } from 'antd';
import { TeamOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { canManageRoles, canManageUsers } from '../auth/permissions';
import UserAccounts from '../components/access/UserAccounts';
import RoleManagement from '../components/access/RoleManagement';

export default function Users() {
  const { user } = useAuth();
  const showUsers = canManageUsers(user?.permissions);
  const showRoles = canManageRoles(user?.permissions);

  const [activeKey, setActiveKey] = useState(showUsers ? 'users' : 'roles');

  useEffect(() => {
    if (!showUsers && showRoles) setActiveKey('roles');
    if (showUsers && !showRoles) setActiveKey('users');
  }, [showUsers, showRoles]);

  const items = [
    showUsers && {
      key: 'users',
      label: (
        <span><TeamOutlined /> 用户账号</span>
      ),
      children: <UserAccounts />,
    },
    showRoles && {
      key: 'roles',
      label: (
        <span><SafetyCertificateOutlined /> 角色权限</span>
      ),
      children: <RoleManagement />,
    },
  ].filter(Boolean) as Array<{ key: string; label: React.ReactNode; children: React.ReactNode }>;

  return (
    <Card bordered={false} className="kc-access-page">
      <Tabs activeKey={activeKey} onChange={setActiveKey} items={items} />
    </Card>
  );
}
