import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Layout, Menu, Typography, Tooltip, Spin } from 'antd';
import {
  DashboardOutlined,
  RobotOutlined,
  ApiOutlined,
  ToolOutlined,
  FileTextOutlined,
  MessageOutlined,
  BookOutlined,
  SettingOutlined,
  LogoutOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Models from './pages/Models';
import Skills from './pages/Skills';
import Documents from './pages/Documents';
import DocDetail from './pages/DocDetail';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Login from './pages/Login';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth, isAuthenticatedSession } from './auth/AuthContext';
import { CHAT_SUBTITLE } from './chatHints';
import { hasAnyPermission, MENU_PERMISSIONS, type Permission } from './auth/permissions';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const ALL_MENU_ITEMS: Array<{
  key: string;
  icon: React.ReactNode;
  label: string;
  title: string;
  subtitle: string;
  permissions: Permission[];
}> = [
  { key: '/', icon: <DashboardOutlined />, label: '控制台', title: '控制台', subtitle: 'Knowledge Core 数据总览', permissions: [MENU_PERMISSIONS['/']] },
  { key: '/agents', icon: <RobotOutlined />, label: '智能体', title: '智能体', subtitle: '路由子智能体与领域专家配置', permissions: [MENU_PERMISSIONS['/agents']] },
  { key: '/models', icon: <ApiOutlined />, label: '模型', title: '模型', subtitle: 'LLM 模型与推理参数管理', permissions: [MENU_PERMISSIONS['/models']] },
  { key: '/skills', icon: <ToolOutlined />, label: 'Skills', title: 'Skills', subtitle: 'Agent 高级任务单元', permissions: [MENU_PERMISSIONS['/skills']] },
  { key: '/documents', icon: <FileTextOutlined />, label: '文档库', title: '文档库', subtitle: '上传 · 刷新 · 重新嵌入 · 删除', permissions: [MENU_PERMISSIONS['/documents'], 'documents:write'] },
  { key: '/chat', icon: <MessageOutlined />, label: '法律助手', title: '法律助手', subtitle: CHAT_SUBTITLE, permissions: [MENU_PERMISSIONS['/chat']] },
  { key: '/users', icon: <TeamOutlined />, label: '访问控制', title: '访问控制', subtitle: '用户账号 · 角色 · 权限', permissions: ['users:manage', 'roles:manage'] },
  { key: '/settings', icon: <SettingOutlined />, label: '参数配置', title: '参数配置', subtitle: '检索流水线 · 文本切割', permissions: [MENU_PERMISSIONS['/settings']] },
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, logout } = useAuth();
  const isLoginPage = location.pathname === '/login';
  const authenticated = Boolean(user && isAuthenticatedSession());

  if (loading) {
    return (
      <div className="kc-auth-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (isLoginPage) {
    if (authenticated) {
      return <Navigate to="/chat" replace />;
    }
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const menuItems = ALL_MENU_ITEMS.filter(m =>
    hasAnyPermission(user?.permissions, m.permissions),
  );

  const selectedKey =
    menuItems.find(m =>
      m.key === '/' ? location.pathname === '/' : location.pathname.startsWith(m.key),
    )?.key || menuItems[0]?.key || '/chat';

  const isDocDetail = location.pathname.startsWith('/documents/') && location.pathname !== '/documents';
  const isChatPage = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const currentItem = ALL_MENU_ITEMS.find(m => m.key === selectedKey);

  const headerDisplay = isDocDetail
    ? { icon: currentItem?.icon, title: '文档详情', subtitle: '原文与切片查看器' }
    : { icon: currentItem?.icon, title: currentItem?.title || '控制台', subtitle: currentItem?.subtitle };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark" className="kc-app-sider">
        <div className="kc-sider-brand">
          <div className="kc-sider-brand-icon"><BookOutlined /></div>
          <div className="kc-sider-brand-text">
            <div className="kc-sider-brand-title">Knowledge Core</div>
            <div className="kc-sider-brand-sub">法律知识库</div>
          </div>
        </div>

        <div className="kc-sider-menu-wrap">
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems.map(({ key, icon, label }) => ({ key, icon, label }))}
            onClick={e => navigate(e.key)}
          />
        </div>

        <div className="kc-sider-footer">
          {user && (
            <div className="kc-sider-profile">
              <div className="kc-sider-profile-main">
                <div className="kc-sider-avatar"><UserOutlined /></div>
                <div className="kc-sider-profile-text">
                  <div className="kc-sider-username" title={user.username}>{user.username}</div>
                  <div className="kc-sider-role">{user.roleLabel || user.role}</div>
                </div>
              </div>
              <Tooltip title="退出登录">
                <button
                  type="button"
                  className="kc-sider-logout-btn"
                  onClick={() => { void logout().then(() => navigate('/login')); }}
                  aria-label="退出登录"
                >
                  <LogoutOutlined />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </Sider>

      <Layout>
        <Header className="kc-app-header">
          <div className="kc-app-header-left">
            <div className="kc-app-header-icon">{headerDisplay.icon}</div>
            <div className="kc-app-header-titles">
              <Text strong style={{ fontSize: 16 }}>{headerDisplay.title}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{headerDisplay.subtitle}</Text>
            </div>
          </div>
          <div className="kc-app-header-version">v0.1</div>
        </Header>
        <Content
          className={isChatPage ? 'kc-page-content kc-page-content-chat' : 'kc-page-content'}
          style={{ padding: isChatPage ? undefined : 24 }}
        >
          <div className={isChatPage ? 'kc-page-inner kc-page-inner-chat' : 'kc-page-inner'}>
            <Routes>
              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/models" element={<Models />} />
                <Route path="/skills" element={<Skills />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/documents/:id" element={<DocDetail />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/chat/:sessionId" element={<Chat />} />
                <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
