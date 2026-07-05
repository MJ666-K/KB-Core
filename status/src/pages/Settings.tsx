import { useEffect, useState } from 'react';
import {
  Card, Form, InputNumber, Button, message, Typography, Row, Col, Space, Divider, Tag, Spin,
} from 'antd';
import { SaveOutlined, ReloadOutlined, ScissorOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api';

interface SettingsPayload {
  settings: {
    chunk: { parentTokens: number; childTokens: number; overlapTokens: number };
    query: {
      searchTopK: number;
      denseTopKMultiplier: number;
      rrfK: number;
      rerankTopK: number;
      agentMaxIterations: number;
      agentMaxToolCalls: number;
      resultCacheTtlMs: number;
    };
  };
}

const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 };

export default function Settings() {
  const [chunkForm] = Form.useForm();
  const [queryForm] = Form.useForm();
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!initialLoading) setRefreshing(true);
    api.getSettings()
      .then((data) => {
        const s = data.settings as SettingsPayload['settings'];
        chunkForm.setFieldsValue(s.chunk);
        queryForm.setFieldsValue(s.query);
      })
      .catch(() => message.error('加载配置失败'))
      .finally(() => {
        setInitialLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const [chunk, query] = await Promise.all([
        chunkForm.validateFields(),
        queryForm.validateFields(),
      ]);
      setSaving(true);
      await api.updateSettings({ chunk, query });
      message.success('配置已保存');
    } catch {
      message.error('保存失败，请检查表单');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kc-settings">
      <Card bordered={false} styles={{ body: { padding: '20px 24px 24px' } }}>
        <div className="kc-settings-toolbar">
          <Space direction="vertical" size={2}>
            <Typography.Text strong style={{ fontSize: 15 }}>系统参数</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              切割参数影响新入库 / 重新嵌入；问答参数保存后立即生效
            </Typography.Text>
          </Space>
          <Space size={12}>
            <Button icon={<ReloadOutlined />} onClick={load} loading={refreshing} disabled={initialLoading || saving}>
              重新加载
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} size="middle" disabled={initialLoading}>
              保存配置
            </Button>
          </Space>
        </div>

        <Spin spinning={initialLoading}>
          <div className="kc-settings-body" style={{ minHeight: initialLoading ? 320 : undefined }}>
        <Row gutter={[20, 20]}>
          <Col xs={24} xl={10}>
            <div className="kc-settings-section">
              <div className="kc-settings-section-head">
                <ScissorOutlined className="kc-settings-section-icon" style={{ color: '#1677ff', background: '#e6f4ff' }} />
                <div>
                  <Typography.Text strong>切割参数</Typography.Text>
                  <div><Tag color="blue" style={{ marginTop: 4 }}>入库时生效</Tag></div>
                </div>
              </div>
              <Form form={chunkForm} layout="vertical" requiredMark="optional">
                <div style={fieldGrid}>
                  <Form.Item name="parentTokens" label="父块最大 Token" rules={[{ required: true }]}>
                    <InputNumber min={100} max={8000} style={{ width: '100%' }} placeholder="如 1024" />
                  </Form.Item>
                  <Form.Item name="childTokens" label="子块最大 Token" rules={[{ required: true }]}>
                    <InputNumber min={50} max={2000} style={{ width: '100%' }} placeholder="如 256" />
                  </Form.Item>
                  <Form.Item name="overlapTokens" label="子块重叠 Token" rules={[{ required: true }]}>
                    <InputNumber min={0} max={500} style={{ width: '100%' }} placeholder="如 32" />
                  </Form.Item>
                </div>
              </Form>
            </div>
          </Col>

          <Col xs={24} xl={14}>
            <div className="kc-settings-section">
              <div className="kc-settings-section-head">
                <SearchOutlined className="kc-settings-section-icon" style={{ color: '#52c41a', background: '#f6ffed' }} />
                <div>
                  <Typography.Text strong>问答 / 检索参数</Typography.Text>
                  <div><Tag color="green" style={{ marginTop: 4 }}>即时生效</Tag></div>
                </div>
              </div>
              <Form form={queryForm} layout="vertical" requiredMark="optional">
                <div style={fieldGrid}>
                  <Form.Item name="searchTopK" label="检索 Top K" rules={[{ required: true }]}>
                    <InputNumber min={1} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="denseTopKMultiplier" label="Dense 扩展倍数" rules={[{ required: true }]}>
                    <InputNumber min={1} max={20} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="rrfK" label="RRF 常数 K" rules={[{ required: true }]}>
                    <InputNumber min={1} max={200} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="rerankTopK" label="Rerank 候选数" rules={[{ required: true }]}>
                    <InputNumber min={1} max={100} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="agentMaxIterations" label="Agent 最大迭代" rules={[{ required: true }]}>
                    <InputNumber min={1} max={20} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="agentMaxToolCalls" label="单次最大 Tool 调用" rules={[{ required: true }]}>
                    <InputNumber min={1} max={50} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="resultCacheTtlMs" label="结果缓存 TTL (ms)" rules={[{ required: true }]} style={{ gridColumn: '1 / -1', maxWidth: 320 }}>
                    <InputNumber min={1000} max={3600000} step={1000} style={{ width: '100%' }} />
                  </Form.Item>
                </div>
              </Form>
            </div>
          </Col>
        </Row>

        <Divider style={{ margin: '20px 0 16px' }} />

        <div className="kc-settings-footer">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            修改后请点击「保存配置」；「重新加载」会丢弃未保存的更改并从服务器读取最新值。
          </Typography.Text>
          <Space size={12}>
            <Button icon={<ReloadOutlined />} onClick={load} loading={refreshing} disabled={initialLoading || saving}>
              重新加载
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} disabled={initialLoading}>
              保存配置
            </Button>
          </Space>
        </div>
          </div>
        </Spin>
      </Card>
    </div>
  );
}
