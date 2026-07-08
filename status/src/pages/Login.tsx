import { useState } from 'react';
import { Button, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined, BookOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

const { Title, Paragraph, Text } = Typography;

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/chat';

  const onLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('欢迎回来');
      navigate(from, { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败，请检查账号密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="kc-login-page">
      <div className="kc-login-bg" aria-hidden>
        <div className="kc-login-bg-gradient" />
        <div className="kc-login-bg-orb kc-login-bg-orb--1" />
        <div className="kc-login-bg-orb kc-login-bg-orb--2" />
        <div className="kc-login-bg-orb kc-login-bg-orb--3" />
        <div className="kc-login-bg-grid" />
        <div className="kc-login-bg-lines" />
      </div>

      <div className="kc-login-theme-toggle">
        <ThemeToggle className="kc-login-theme-btn" />
      </div>
      <div className="kc-login-shell">
        <section className="kc-login-brand">
          <div className="kc-login-brand-inner">
            <div className="kc-login-logo">
              <BookOutlined />
            </div>
            <Title level={2} className="kc-login-brand-title">Knowledge Core</Title>
            <Paragraph className="kc-login-brand-desc">
              面向法律场景的智能知识库，支持文档检索、Agent 问答与多轮对话。
            </Paragraph>
            <ul className="kc-login-features">
              <li><SafetyCertificateOutlined /> 混合检索 + 重排序</li>
              <li><SafetyCertificateOutlined /> 多 Agent 协同分析</li>
              <li><SafetyCertificateOutlined /> 会话持久化与断线恢复</li>
            </ul>
          </div>
          <div className="kc-login-brand-glow kc-login-brand-glow--a" aria-hidden />
          <div className="kc-login-brand-glow kc-login-brand-glow--b" aria-hidden />
        </section>

        <section className="kc-login-panel">
          <div className="kc-login-panel-inner">
            <div className="kc-login-panel-header">
              <Title level={3}>欢迎使用</Title>
              <Text type="secondary">登录后即可使用法律知识库与智能问答助手</Text>
            </div>

            <Form
              layout="vertical"
              onFinish={onLogin}
              requiredMark={false}
              className="kc-login-form"
            >
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input
                  prefix={<UserOutlined className="kc-login-input-icon" />}
                  placeholder="请输入用户名"
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  prefix={<LockOutlined className="kc-login-input-icon" />}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                <Button type="primary" htmlType="submit" block loading={loading} className="kc-login-submit">
                  进入系统
                </Button>
              </Form.Item>
            </Form>
          </div>
        </section>
      </div>
    </div>
  );
}
