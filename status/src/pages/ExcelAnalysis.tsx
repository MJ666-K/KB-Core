import { useState, useEffect, useRef } from 'react';
import {
  Card,
  Upload,
  Button,
  message,
  Typography,
  Space,
  Input,
  Table,
  Tag,
  Spin,
  Empty,
  Tabs,
  List,
  Switch,
  Divider,
} from 'antd';
import {
  UploadOutlined,
  SendOutlined,
  DatabaseOutlined,
  RobotOutlined,
  UserOutlined,
  FileExcelOutlined,
  BarChartOutlined,
  FileTextOutlined,
  EyeOutlined,
  CodeOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import * as d3 from 'd3';
import { getAuthToken } from '../auth/storage';
import MarkdownContent from '../MarkdownContent';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface FileInfo {
  id: string;
  fileNames: string[];
  fileCount: number;
  totalRows: number;
  createdAt: string;
}

interface ColumnInfo {
  name: string;
  type: string;
}

interface SheetInfo {
  sheetName: string;
  rowCount: number;
  columns: ColumnInfo[];
  duckdbTable: string;
}

interface PivotData {
  id?: string;
  pivotId?: string;
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  visualization: {
    chartType: string;
    categories?: string[];
    series?: Array<{ name: string; data: number[] }>;
    heatmapData?: Array<{ x: string; y: string; value: number }>;
  };
  sql: string;
}

interface ReportData {
  id?: string;
  reportId?: string;
  content: string;
  title?: string;
}

interface QueryResult {
  sql?: string;
  code?: string;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  output?: string;
  explanation?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result?: QueryResult;
  loading?: boolean;
  thinking?: string[];
  suggestions?: string[];
}

export default function ExcelAnalysis() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [pivots, setPivots] = useState<PivotData[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([]);
  
  const [activeTab, setActiveTab] = useState('preview');
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);
  const [useCode, setUseCode] = useState(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [querying, setQuerying] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const d3ContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadFileList();
  }, []);

  useEffect(() => {
    if (activeTab === 'pivots' && pivots.length > 0 && d3ContainerRef.current) {
      renderD3Chart();
    }
  }, [activeTab, pivots]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const renderD3Chart = () => {
    if (!d3ContainerRef.current || pivots.length === 0) return;

    const container = d3ContainerRef.current;
    container.innerHTML = '';

    const pivot = pivots[0]!;
    const viz = pivot.visualization;

    if (viz.chartType === 'bar' && viz.categories && viz.series) {
      const width = container.clientWidth;
      const height = 400;
      const margin = { top: 20, right: 30, bottom: 60, left: 60 };

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

      const x = d3.scaleBand()
        .domain(viz.categories)
        .range([margin.left, width - margin.right])
        .padding(0.3);

      const y = d3.scaleLinear()
        .domain([0, d3.max(viz.series[0]!.data) || 0])
        .nice()
        .range([height - margin.bottom, margin.top]);

      svg.append('g')
        .attr('fill', '#1890ff')
        .selectAll('rect')
        .data(viz.series[0]!.data)
        .join('rect')
        .attr('x', (_, i) => x(viz.categories![i]!)!)
        .attr('y', d => y(d))
        .attr('height', d => y(0) - y(d))
        .attr('width', x.bandwidth());

      svg.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x))
        .selectAll('text')
        .attr('transform', 'rotate(-45)')
        .style('text-anchor', 'end');

      svg.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));
    }
  };

  const loadFileList = async () => {
    setLoading(true);
    try {
      const token = getAuthToken();
      const response = await fetch('/api/excel/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setFiles(data.list);
      }
    } catch (err) {
      console.error('加载文件列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectFile = async (file: FileInfo) => {
    setSelectedFile(file);
    setLoading(true);
    try {
      const token = getAuthToken();
      const response = await fetch(`/api/excel/result/${file.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      
      if (data.success) {
        const profile = data.profile;
        setSheets(profile.sheets);
        setPivots(data.pivots || []);
        setReport(data.report);
        
        loadPreview(file.id);
        
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `已加载文件 **${profile.fileNames[0]}**，共 ${file.totalRows} 行数据。\n\n你可以继续追问，例如：\n- "哪个区域的销售最高？"\n- "最近三个月的趋势如何？"\n- "找出异常值"`,
        }]);
        
        setActiveTab('preview');
      }
    } catch (err) {
      message.error('加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (profileId: string) => {
    try {
      const token = getAuthToken();
      const response = await fetch(`/api/excel/preview/${profileId}?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setPreviewData(data.rows || []);
    } catch (err) {
      console.error('加载预览失败:', err);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = getAuthToken();
      const response = await fetch('/api/excel/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || '上传失败');
      }

      message.success(`分析完成：${data.totalRows} 行数据，生成 ${data.pivots?.length || 0} 个透视表`);
      
      await loadFileList();
      
      const newFile: FileInfo = {
        id: data.profileId,
        fileNames: [data.fileName],
        fileCount: 1,
        totalRows: data.totalRows,
        createdAt: new Date().toISOString(),
      };
      setFiles(prev => [newFile, ...prev]);
      selectFile(newFile);
      
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleQuery = async () => {
    if (!selectedFile || !inputValue.trim()) return;

    const question = inputValue.trim();
    setInputValue('');
    setQuerying(true);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    setMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: question,
    }, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      loading: true,
      thinking: [],
      suggestions: [],
    }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const token = getAuthToken();
      const response = await fetch('/api/excel/query/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          profileId: selectedFile.id, 
          question, 
          useCode,
          history: messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10)
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';
      let currentResult: Partial<QueryResult> = {};
      let currentThinking: string[] = [];
      let currentSuggestions: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const event = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            try {
              const data = JSON.parse(dataStr);
              
              if (dataStr.includes('"event":"thinking"') || line.includes('event:thinking')) {
                currentThinking.push(data.message);
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, thinking: [...currentThinking] }
                    : msg
                ));
              } else if (line.includes('event:sql')) {
                currentResult.sql = data.sql;
              } else if (line.includes('event:code')) {
                currentResult.code = data.code;
              } else if (line.includes('event:data')) {
                currentResult.rows = data.rows;
                currentResult.rowCount = data.rowCount;
              } else if (line.includes('event:output')) {
                currentResult.output = data.output;
              } else if (line.includes('event:explanation')) {
                currentResult.explanation = data.explanation;
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { 
                        ...msg, 
                        content: data.explanation,
                        result: { ...currentResult } as QueryResult,
                        thinking: currentThinking,
                      }
                    : msg
                ));
              } else if (line.includes('event:suggestions')) {
                currentSuggestions = data.suggestions || [];
                setSuggestions(currentSuggestions);
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { ...msg, suggestions: currentSuggestions }
                    : msg
                ));
              } else if (line.includes('event:done')) {
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMsgId
                    ? { 
                        ...msg, 
                        loading: false,
                        result: { ...currentResult } as QueryResult,
                        thinking: currentThinking,
                        suggestions: currentSuggestions,
                      }
                    : msg
                ));
              } else if (line.includes('event:error')) {
                throw new Error(data.error || '查询失败');
              }
            } catch (err) {
              if (err instanceof Error && err.message !== '查询失败') {
                console.error('解析 SSE 数据失败:', err);
              }
            }
          }
        }
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        message.info('查询已取消');
      } else {
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: `查询失败：${err instanceof Error ? err.message : '未知错误'}`,
                loading: false,
              }
            : msg
        ));
      }
    } finally {
      setQuerying(false);
      abortControllerRef.current = null;
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  const renderChart = (viz: PivotData['visualization']) => {
    if (!viz) return null;

    if (viz.chartType === 'bar' || viz.chartType === 'line') {
      return {
        tooltip: { trigger: 'axis' },
        xAxis: { 
          type: 'category', 
          data: viz.categories,
          axisLabel: { rotate: (viz.categories?.length || 0) > 10 ? 45 : 0 }
        },
        yAxis: { type: 'value' },
        series: viz.series?.map((s) => ({
          name: s.name,
          type: viz.chartType,
          data: s.data,
          itemStyle: { color: viz.chartType === 'bar' ? '#1890ff' : '#52c41a' },
        })),
        grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      };
    }

    if (viz.chartType === 'heatmap' && viz.heatmapData) {
      const xValues = [...new Set(viz.heatmapData.map((d) => d.x))];
      const yValues = [...new Set(viz.heatmapData.map((d) => d.y))];
      const data = viz.heatmapData.map((d) => [
        xValues.indexOf(d.x),
        yValues.indexOf(d.y),
        d.value,
      ]);

      return {
        tooltip: { position: 'top' },
        xAxis: { type: 'category', data: xValues },
        yAxis: { type: 'category', data: yValues },
        visualMap: {
          min: 0,
          max: Math.max(...viz.heatmapData.map((d) => d.value)),
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: '0%',
        },
        series: [{
          type: 'heatmap',
          data,
          label: { show: true },
        }],
      };
    }

    return null;
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
        <Space>
          <DatabaseOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          <Title level={4} style={{ margin: 0 }}>Excel 智能分析</Title>
          <Tag color="blue">Agent 驱动</Tag>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadFileList}>刷新</Button>
        </Space>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 280, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
          <div style={{ padding: 16, borderBottom: '1px solid #f0f0f0' }}>
            <Upload
              accept=".xlsx,.xls"
              beforeUpload={(file) => {
                handleUpload(file);
                return false;
              }}
              showUploadList={false}
              disabled={uploading}
            >
              <Button type="primary" icon={<UploadOutlined />} block loading={uploading}>
                {uploading ? '分析中...' : '上传 Excel'}
              </Button>
            </Upload>
          </div>
          
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>历史分析</Text>
            <List
              size="small"
              loading={loading}
              dataSource={files}
              locale={{ emptyText: <Empty description="暂无分析记录" /> }}
              renderItem={(item) => (
                <List.Item
                  onClick={() => selectFile(item)}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: selectedFile?.id === item.id ? '#e6f7ff' : 'transparent',
                    marginBottom: 4,
                    border: '1px solid #f0f0f0',
                  }}
                >
                  <List.Item.Meta
                    avatar={<FileExcelOutlined style={{ fontSize: 20, color: '#52c41a' }} />}
                    title={<Text ellipsis style={{ maxWidth: 180 }}>{item.fileNames[0]}</Text>}
                    description={
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.totalRows.toLocaleString()} 行 · {new Date(item.createdAt).toLocaleDateString()}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selectedFile ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty
                image={<DatabaseOutlined style={{ fontSize: 80, color: '#d9d9d9' }} />}
                description={
                  <div>
                    <Paragraph type="secondary">上传 Excel 文件开始分析</Paragraph>
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      支持 .xlsx、.xls 格式，自动生透视表和分析报告
                    </Paragraph>
                  </div>
                }
              />
            </div>
          ) : (
            <>
              <div style={{ padding: '12px 24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
                <Space>
                  <FileExcelOutlined style={{ fontSize: 20, color: '#52c41a' }} />
                  <Text strong>{selectedFile.fileNames[0]}</Text>
                  <Tag color="blue">{selectedFile.totalRows.toLocaleString()} 行</Tag>
                  <Tag>{sheets.length} 个 Sheet</Tag>
                  <Tag color="green">{pivots.length} 个透视表</Tag>
                </Space>
              </div>

              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                tabBarStyle={{ padding: '0 24px', marginBottom: 0 }}
                items={[
                  {
                    key: 'preview',
                    label: <span><EyeOutlined /> 数据预览</span>,
                    children: (
                      <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
                        {previewData.length > 0 ? (
                          <Table
                            dataSource={previewData}
                            rowKey={(_, i) => String(i)}
                            pagination={{ pageSize: 20, showSizeChanger: false }}
                            size="small"
                            scroll={{ x: 'max-content' }}
                            columns={
                              previewData.length > 0
                                ? Object.keys(previewData[0]!).map(key => ({
                                    title: key,
                                    dataIndex: key,
                                    key,
                                    render: (val: unknown) => String(val ?? ''),
                                  }))
                                : []
                            }
                          />
                        ) : (
                          <Spin />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'pivots',
                    label: <span><BarChartOutlined /> 透视表</span>,
                    children: (
                      <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
                        {pivots.length === 0 ? (
                          <Empty description="暂无透视表" />
                        ) : (
                          <>
                            <div ref={d3ContainerRef} style={{ marginBottom: 24 }} />
                            {pivots.map((pivot) => (
                              <Card
                                key={pivot.pivotId || pivot.id}
                                title={pivot.name}
                                extra={<Tag>{pivot.rowCount} 行</Tag>}
                                style={{ marginBottom: 16 }}
                              >
                                {renderChart(pivot.visualization) && (
                                  <ReactECharts
                                    option={renderChart(pivot.visualization)!}
                                    style={{ height: 300, marginBottom: 16 }}
                                  />
                                )}
                                {pivot.rows && pivot.rows.length > 0 && (
                                  <Table
                                    dataSource={pivot.rows.slice(0, 10)}
                                    rowKey={(_, i) => String(i)}
                                    pagination={false}
                                    size="small"
                                    scroll={{ x: 'max-content' }}
                                    columns={
                                      pivot.rows.length > 0
                                        ? Object.keys(pivot.rows[0]!).map(key => ({
                                            title: key,
                                            dataIndex: key,
                                            key,
                                            render: (val: unknown) => String(val ?? ''),
                                          }))
                                        : []
                                    }
                                  />
                                )}
                                {pivot.rows && pivot.rows.length > 10 && (
                                  <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
                                    显示前 10 行，共 {pivot.rows.length} 行
                                  </Text>
                                )}
                              </Card>
                            ))}
                          </>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'report',
                    label: <span><FileTextOutlined /> 分析报告</span>,
                    children: (
                      <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
                        {report ? (
                          <>
                            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                              <Button
                                icon={showMarkdownSource ? <EyeOutlined /> : <CodeOutlined />}
                                onClick={() => setShowMarkdownSource(!showMarkdownSource)}
                              >
                                {showMarkdownSource ? '预览' : '源码'}
                              </Button>
                            </div>
                            {showMarkdownSource ? (
                              <pre style={{ 
                                background: '#f5f5f5', 
                                padding: 16, 
                                borderRadius: 8,
                                whiteSpace: 'pre-wrap',
                                fontSize: 13,
                              }}>
                                {report.content}
                              </pre>
                            ) : (
                              <MarkdownContent content={report.content} />
                            )}
                          </>
                        ) : (
                          <Empty description="暂无分析报告" />
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'chat',
                    label: <span><RobotOutlined /> 追问</span>,
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
                          {messages.map((msg) => (
                            <div
                              key={msg.id}
                              style={{
                                marginBottom: 16,
                                display: 'flex',
                                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                                gap: 12,
                              }}
                            >
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  background: msg.role === 'user' ? '#1890ff' : '#52c41a',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#fff',
                                  flexShrink: 0,
                                }}
                              >
                                {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                              </div>
                              <div style={{ flex: 1, maxWidth: 'calc(100% - 44px)' }}>
                                <div
                                  style={{
                                    background: msg.role === 'user' ? '#e6f7ff' : '#f6ffed',
                                    padding: 12,
                                    borderRadius: 8,
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {msg.loading ? (
                                    <div>
                                      <Spin size="small" />
                                      {msg.thinking && msg.thinking.length > 0 && (
                                        <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                                          {msg.thinking.map((t, i) => (
                                            <div key={i}>💭 {t}</div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <MarkdownContent content={msg.content} />
                                  )}
                                </div>
                                
                                {msg.result && !msg.loading && (
                                  <div style={{ marginTop: 12 }}>
                                    {msg.result.sql && (
                                      <Card size="small" title="SQL" style={{ marginBottom: 8 }}>
                                        <pre style={{ margin: 0, fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                                          {msg.result.sql}
                                        </pre>
                                      </Card>
                                    )}
                                    {msg.result.code && (
                                      <Card size="small" title="Python 代码" style={{ marginBottom: 8 }}>
                                        <pre style={{ margin: 0, fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                                          {msg.result.code}
                                        </pre>
                                      </Card>
                                    )}
                                    {msg.result.output && (
                                      <Card size="small" title="执行结果" style={{ marginBottom: 8 }}>
                                        <pre style={{ margin: 0, fontSize: 12, background: '#f6ffed', padding: 8, borderRadius: 4 }}>
                                          {msg.result.output}
                                        </pre>
                                      </Card>
                                    )}
                                    {msg.result.rows && msg.result.rows.length > 0 && (
                                      <Table
                                        dataSource={msg.result.rows.slice(0, 10)}
                                        rowKey={(_, i) => String(i)}
                                        pagination={false}
                                        size="small"
                                        scroll={{ x: 'max-content' }}
                                        columns={
                                          msg.result.rows.length > 0
                                            ? Object.keys(msg.result.rows[0]!).map(key => ({
                                                title: key,
                                                dataIndex: key,
                                                key,
                                                render: (val: unknown) => String(val ?? ''),
                                              }))
                                            : []
                                        }
                                      />
                                    )}
                                  </div>
                                )}

                                {msg.suggestions && msg.suggestions.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
                                      <BulbOutlined /> 推荐问题：
                                    </Text>
                                    <Space wrap>
                                      {msg.suggestions.map((s, i) => (
                                        <Tag
                                          key={i}
                                          color="blue"
                                          style={{ cursor: 'pointer' }}
                                          onClick={() => handleSuggestionClick(s)}
                                        >
                                          {s}
                                        </Tag>
                                      ))}
                                    </Space>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                          <div ref={messagesEndRef} />
                        </div>
                        <div style={{ padding: 16, borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                          <Space style={{ marginBottom: 8 }}>
                            <Switch 
                              checked={useCode} 
                              onChange={setUseCode} 
                              checkedChildren="代码" 
                              unCheckedChildren="SQL" 
                            />
                            <Text type="secondary">
                              {useCode ? '使用 Python 代码生成（复杂分析）' : '使用 SQL 查询（简单查询）'}
                            </Text>
                          </Space>
                          <Space.Compact style={{ width: '100%' }}>
                            <TextArea
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              onPressEnter={(e) => {
                                if (!e.shiftKey) {
                                  e.preventDefault();
                                  handleQuery();
                                }
                              }}
                              placeholder="输入你的问题，例如：哪个区域销售最高？"
                              autoSize={{ minRows: 1, maxRows: 4 }}
                              disabled={querying}
                            />
                            <Button
                              type="primary"
                              icon={useCode ? <ThunderboltOutlined /> : <SendOutlined />}
                              onClick={handleQuery}
                              loading={querying}
                              style={{ height: 'auto' }}
                            >
                              发送
                            </Button>
                          </Space.Compact>
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
