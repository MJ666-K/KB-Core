import { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Spin, Typography } from 'antd';
import {
  FileTextOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  RobotOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { api } from '../api';

export default function Dashboard() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch(() => setStats({}))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const items = [
    {
      title: '知识库数量',
      value: stats?.documentCount ?? 0,
      icon: <FileTextOutlined />,
      color: '#1677ff',
      bg: '#e6f4ff',
    },
    {
      title: '文档块总数',
      value: stats?.chunkCount ?? 0,
      icon: <DatabaseOutlined />,
      color: '#52c41a',
      bg: '#f6ffed',
    },
    {
      title: '向量化文档块',
      value: stats?.embeddingCount ?? 0,
      icon: <ThunderboltOutlined />,
      color: '#722ed1',
      bg: '#f9f0ff',
    },
    {
      title: '今日查询',
      value: stats?.todayQueryCount ?? 0,
      icon: <SearchOutlined />,
      color: '#fa8c16',
      bg: '#fff7e6',
    },
    {
      title: '总查询数',
      value: stats?.queryCount ?? 0,
      icon: <RobotOutlined />,
      color: '#13c2c2',
      bg: '#e6fffb',
    },
    {
      title: '智能体数量',
      value: stats?.agentCount ?? 0,
      icon: <ApiOutlined />,
      color: '#eb2f96',
      bg: '#fff0f6',
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]}>
        {items.map(item => (
          <Col xs={24} sm={12} md={8} xl={4} key={item.title}>
            <Card className="kc-stat-card" bordered={false}>
              <Statistic
                title={item.title}
                value={item.value}
                prefix={
                  <span
                    style={{
                      background: item.bg,
                      color: item.color,
                      padding: '6px 8px',
                      borderRadius: 6,
                      fontSize: 18,
                      marginRight: 4,
                    }}
                  >
                    {item.icon}
                  </span>
                }
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Card
        title="欢迎使用 Knowledge Core"
        bordered={false}
        style={{ marginTop: 24 }}
      >
        <Typography.Paragraph>
          这是一个基于 Agent 架构的法律知识库管理系统。您可以通过左侧导航栏管理智能体、模型、Skills、文档，或直接进入法律助手体验。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          提示：在开始之前，请确保已上传文档并完成向量化嵌入。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
