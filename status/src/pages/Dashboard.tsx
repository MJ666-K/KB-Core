import { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Spin, Typography, Table, Tag } from 'antd';
import {
  FileTextOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  RobotOutlined,
  ApiOutlined,
  ToolOutlined,
  TeamOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { datasetDisplayName } from '../datasetLabels';

interface Stats {
  documentCount: number;
  chunkCount: number;
  embeddingCount: number;
  queryCount: number;
  todayQueryCount: number;
  agentCount: number;
  modelCount: number;
  skillCount: number;
  userCount: number;
  sessionCount: number;
  datasetStats?: Array<{ name: string; docCount: number; chunkCount: number }>;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const s = stats ?? {
    documentCount: 0,
    chunkCount: 0,
    embeddingCount: 0,
    queryCount: 0,
    todayQueryCount: 0,
    agentCount: 0,
    modelCount: 0,
    skillCount: 0,
    userCount: 0,
    sessionCount: 0,
  };

type StatTone = 'blue' | 'green' | 'purple' | 'orange' | 'cyan' | 'pink' | 'indigo' | 'teal';

  const items: Array<{
    title: string;
    value: number;
    icon: React.ReactNode;
    tone: StatTone;
  }> = [
    { title: '文档数量', value: s.documentCount, icon: <FileTextOutlined />, tone: 'blue' },
    { title: '文档块总数', value: s.chunkCount, icon: <DatabaseOutlined />, tone: 'green' },
    { title: '已向量化块', value: s.embeddingCount, icon: <ThunderboltOutlined />, tone: 'purple' },
    { title: '今日查询', value: s.todayQueryCount, icon: <SearchOutlined />, tone: 'orange' },
    { title: '累计查询', value: s.queryCount, icon: <RobotOutlined />, tone: 'cyan' },
    { title: '智能体', value: s.agentCount, icon: <ApiOutlined />, tone: 'pink' },
    { title: 'Skills', value: s.skillCount, icon: <ToolOutlined />, tone: 'indigo' },
    { title: '聊天会话', value: s.sessionCount, icon: <MessageOutlined />, tone: 'teal' },
  ];

  return (
    <div>
      <Row gutter={[16, 16]}>
        {items.map(item => (
          <Col xs={24} sm={12} md={8} xl={6} key={item.title}>
            <Card className="kc-stat-card" bordered={false}>
              <Statistic
                title={item.title}
                value={item.value}
                prefix={
                  <span className={`kc-stat-icon kc-stat-icon--${item.tone}`}>
                    {item.icon}
                  </span>
                }
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="数据集概览" bordered={false}>
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={s.datasetStats ?? []}
              locale={{ emptyText: '暂无数据集' }}
              columns={[
                {
                  title: '数据集',
                  dataIndex: 'name',
                  render: (v: string) => <Tag>{datasetDisplayName(v)}</Tag>,
                },
                { title: '文档数', dataIndex: 'docCount', width: 100 },
                { title: '块数', dataIndex: 'chunkCount', width: 100 },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="系统概况" bordered={false}>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic title="模型数量" value={s.modelCount} prefix={<ApiOutlined />} />
              </Col>
              <Col span={12}>
                <Statistic title="活跃用户" value={s.userCount} prefix={<TeamOutlined />} />
              </Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
              数据来自 PostgreSQL 实时统计。上传文档并完成嵌入后，文档与向量块数量会自动更新。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
