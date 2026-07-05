import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Space, Typography } from 'antd';
import {
  DashboardOutlined,
  RobotOutlined,
  ApiOutlined,
  ToolOutlined,
  FileTextOutlined,
  MessageOutlined,
  BookOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Models from './pages/Models';
import Skills from './pages/Skills';
import Documents from './pages/Documents';
import DocDetail from './pages/DocDetail';
import Chat from './pages/Chat';
import Settings from './pages/Settings';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '控制台', title: '控制台', subtitle: 'Knowledge Core 数据总览' },
  { key: '/agents', icon: <RobotOutlined />, label: '智能体', title: '智能体', subtitle: '路由子智能体与领域专家配置' },
  { key: '/models', icon: <ApiOutlined />, label: '模型', title: '模型', subtitle: 'LLM 模型与推理参数管理' },
  { key: '/skills', icon: <ToolOutlined />, label: 'Skills', title: 'Skills', subtitle: 'Agent 高级任务单元' },
  { key: '/documents', icon: <FileTextOutlined />, label: '文档', title: '文档', subtitle: '上传 · 刷新 · 重新嵌入 · 删除' },
  { key: '/chat', icon: <MessageOutlined />, label: '智能问答', title: '智能问答', subtitle: '流式对话 · 子智能体路由' },
  { key: '/settings', icon: <SettingOutlined />, label: '参数配置', title: '参数配置', subtitle: '切割参数 · 问答检索参数' },
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey =
    menuItems.find(m =>
      m.key === '/' ? location.pathname === '/' : location.pathname.startsWith(m.key),
    )?.key || '/';

  const isDocDetail = location.pathname.startsWith('/documents/') && location.pathname !== '/documents';
  const currentItem = menuItems.find(m => m.key === selectedKey);

  const headerDisplay = isDocDetail
    ? { icon: currentItem?.icon, title: '文档详情', subtitle: '原文与切片查看器' }
    : { icon: currentItem?.icon, title: currentItem?.title || '控制台', subtitle: currentItem?.subtitle };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark" style={{ position: 'sticky', top: 0, height: '100vh' }}>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              background: '#1677ff',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BookOutlined style={{ fontSize: 18, color: '#fff' }} />
          </div>
          <Space direction="vertical" size={0}>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>Knowledge Core</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>法律知识库</div>
          </Space>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={e => navigate(e.key)}
          style={{ borderRight: 'none' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            height: 64,
            lineHeight: '64px',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Space size={14} align="center">
            <div
              style={{
                width: 36,
                height: 36,
                background: '#e6f4ff',
                color: '#1677ff',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              {headerDisplay.icon}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <Text strong style={{ fontSize: 16 }}>{headerDisplay.title}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{headerDisplay.subtitle}</Text>
            </div>
          </Space>
          <Space size={16} align="center">
            <div style={{ fontSize: 12, color: '#00000073' }}>v0.1</div>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <div style={{ minHeight: 280 }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/models" element={<Models />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/documents/:id" element={<DocDetail />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
