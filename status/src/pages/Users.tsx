import { useEffect, useState } from 'react';
import { Tabs, Card } from 'antd';
import { TeamOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { canManageRoles, canManageUsers } from '../auth/permissions';
import UserAccounts from '../components/access/UserAccounts';
import RoleManagement from '../components/access/RoleManagement';

type AccessTab = 'users' | 'roles';

function resolveAccessTab(search: string, showUsers: boolean, showRoles: boolean): AccessTab {
  const requested = new URLSearchParams(search).get('tab');
  if (requested === 'roles' && showRoles) return 'roles';
  if (requested === 'users' && showUsers) return 'users';
  if (showRoles && !showUsers) return 'roles';
  return showUsers ? 'users' : 'roles';
}

export default function Users() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const showUsers = canManageUsers(user?.permissions);
  const showRoles = canManageRoles(user?.permissions);

  const [activeKey, setActiveKey] = useState<AccessTab>(() =>
    resolveAccessTab(location.search, showUsers, showRoles),
  );

  // 权限变化时仅修正「当前 tab 已不可用」的情况，不强制跳回账号
  useEffect(() => {
    if (activeKey === 'users' && !showUsers && showRoles) {
      setActiveKey('roles');
      navigate({ pathname: '/users', search: '?tab=roles' }, { replace: true });
    } else if (activeKey === 'roles' && !showRoles && showUsers) {
      setActiveKey('users');
      navigate({ pathname: '/users', search: '?tab=users' }, { replace: true });
    }
  }, [showUsers, showRoles, activeKey, navigate]);

  const onTabChange = (key: string) => {
    const tab = key as AccessTab;
    setActiveKey(tab);
    navigate({ pathname: '/users', search: `?tab=${tab}` }, { replace: true });
  };

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
      <Tabs activeKey={activeKey} onChange={onTabChange} items={items} destroyInactiveTabPane={false} />
    </Card>
  );
}
