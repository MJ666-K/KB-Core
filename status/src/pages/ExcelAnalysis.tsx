import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode, type CSSProperties } from 'react';
import {
  Upload,
  Button,
  message,
  Table,
  Spin,
  Empty,
  Input,
  Pagination,
  Modal,
  Dropdown,
  Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  UploadOutlined,
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  FileExcelOutlined,
  BarChartOutlined,
  FileTextOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  PlusOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  EditOutlined,
  DeleteOutlined,
  SwapOutlined,
  SyncOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  MoreOutlined,
  ColumnWidthOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { getAuthToken } from '../auth/storage';
import MarkdownContent from '../MarkdownContent';
import './excel-analysis.css';

const { TextArea } = Input;

const COL_WIDTH_PRESETS = { narrow: 72, normal: 108, wide: 156 } as const;
const COL_WIDTH_MIN = 52;
const INDEX_COL_WIDTH = 44;
type ColWidthPreset = keyof typeof COL_WIDTH_PRESETS;
const ZOOM_STEPS = [0.75, 0.85, 1, 1.1, 1.2, 1.35] as const;

const CHART_COLORS = ['#1a56db', '#16a34a', '#7c3aed', '#ea580c', '#0891b2', '#db2777'];

const QUERY_HINTS = [
  '哪个区域的销售最高？',
  '最近三个月的趋势如何？',
  '找出异常值',
  '按产品类别汇总',
];

const STATUS_STYLES: Record<string, string> = {
  '已完成': 'done',
  '已退款': 'refund',
  '进行中': 'progress',
  '待处理': 'pending',
};

type TabKey = 'preview' | 'pivots' | 'report' | 'chat';

const NAV_TABS: Array<{ key: TabKey; icon: typeof EyeOutlined; label: string; count?: (ctx: NavCtx) => number | undefined }> = [
  { key: 'preview', icon: EyeOutlined, label: '数据预览' },
  { key: 'pivots', icon: BarChartOutlined, label: '透视表', count: c => c.pivots },
  { key: 'report', icon: FileTextOutlined, label: '分析报告', count: c => c.report ? 1 : 0 },
  { key: 'chat', icon: RobotOutlined, label: '追问' },
];

interface NavCtx { pivots: number; report: boolean }

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
  sampleData?: Record<string, unknown>[];
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
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  result?: QueryResult;
  loading?: boolean;
}

function formatFileTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'XLSX';
}

function colLetter(index: number): string {
  let n = index;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function inferColumnKind(key: string, rows: Record<string, unknown>[]): 'number' | 'status' | 'text' {
  const sample = rows.slice(0, 30).map(r => r[key]).filter(v => v != null && v !== '');
  if (sample.length === 0) return 'text';
  if (sample.every(v => STATUS_STYLES[String(v)])) return 'status';
  if (sample.every(v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))))) {
    return 'number';
  }
  return 'text';
}

function renderCell(
  val: unknown,
  kind: 'number' | 'status' | 'text',
  opts?: { maxWidth?: number; wrap?: boolean },
): ReactNode {
  if (val == null || val === '') return <span className="kc-xls-cell kc-xls-cell--empty"> </span>;
  const text = String(val);
  const style = opts?.maxWidth ? { maxWidth: opts.maxWidth } : undefined;
  const wrapCls = opts?.wrap ? ' kc-xls-cell--wrap' : '';
  if (kind === 'status' && STATUS_STYLES[text]) {
    return <span className={`kc-xls-status kc-xls-status--${STATUS_STYLES[text]}`}>{text}</span>;
  }
  if (kind === 'number') {
    const num = typeof val === 'number' ? val : Number(val);
    const display = Number.isInteger(num) ? num.toLocaleString('zh-CN') : num.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
    return <span className={`kc-xls-cell kc-xls-cell--num${wrapCls}`} style={style}>{display}</span>;
  }
  return <span className={`kc-xls-cell${wrapCls}`} style={style} title={opts?.wrap ? undefined : text}>{text}</span>;
}

function buildDataColumns(
  rows: Record<string, unknown>[],
  opts?: { showIndex?: boolean; excel?: boolean; pageOffset?: number; colWidth?: number; cellWrap?: boolean },
): ColumnsType<Record<string, unknown>> {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]!);
  const kinds = Object.fromEntries(keys.map(k => [k, inferColumnKind(k, rows)])) as Record<string, 'number' | 'status' | 'text'>;
  const pageOffset = opts?.pageOffset ?? 0;
  const colW = opts?.colWidth ?? COL_WIDTH_PRESETS.normal;

  const cols: ColumnsType<Record<string, unknown>> = [];
  if (opts?.showIndex !== false) {
    cols.push({
      title: '',
      key: '__index',
      width: INDEX_COL_WIDTH,
      minWidth: INDEX_COL_WIDTH,
      className: 'kc-xls-col-rowhead',
      render: (_v, _r, i) => <span className="kc-xls-rownum">{pageOffset + i + 1}</span>,
    });
  }
  keys.forEach((key, colIdx) => {
    const kind = kinds[key] ?? 'text';
    cols.push({
      title: opts?.excel ? (
        <span className="kc-xls-colhead">
          <em>{colLetter(colIdx)}</em>
          <span>{key}</span>
        </span>
      ) : key,
      dataIndex: key,
      key,
      ellipsis: !opts?.cellWrap,
      width: colW,
      minWidth: colW,
      align: kind === 'number' ? 'right' : 'left',
      className: kind === 'number' ? 'kc-xls-col-num' : undefined,
      render: (val: unknown) => renderCell(val, kind, { maxWidth: colW, wrap: opts?.cellWrap }),
    });
  });
  return cols;
}

function DataTable({
  rows,
  pageSize = 100,
  compact = false,
  showIndex = true,
  excel = false,
  totalRows,
  page: controlledPage,
  onPageChange,
  zoom = 1,
  maxColWidth,
  cellWrap = false,
}: {
  rows: Record<string, unknown>[];
  pageSize?: number;
  compact?: boolean;
  showIndex?: boolean;
  excel?: boolean;
  totalRows?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  zoom?: number;
  maxColWidth?: number;
  cellWrap?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [bodyScrollY, setBodyScrollY] = useState<number | undefined>(undefined);
  const [internalPage, setInternalPage] = useState(1);
  const page = controlledPage ?? internalPage;
  const serverPaged = totalRows != null && onPageChange != null;

  useEffect(() => {
    if (!serverPaged) setInternalPage(1);
  }, [rows, serverPaged]);

  const displayTotal = totalRows ?? rows.length;
  const pagedRows = useMemo(() => {
    if (serverPaged || pageSize <= 0) return rows;
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize, serverPaged]);

  const pageOffset = serverPaged
    ? (page - 1) * (pageSize > 0 ? pageSize : 0)
    : pageSize > 0 ? (page - 1) * pageSize : 0;

  const sampleRows = rows.length > 0 ? rows : pagedRows;
  const dataColCount = sampleRows.length > 0 ? Object.keys(sampleRows[0]!).length : 0;
  const indexColWidth = showIndex ? INDEX_COL_WIDTH : 0;
  const colWidthCap = maxColWidth ?? COL_WIDTH_PRESETS.normal;

  const adaptiveColWidth = useMemo(() => {
    if (dataColCount === 0) return colWidthCap;
    const available = Math.max(0, containerWidth - indexColWidth);
    const even = Math.floor(available / dataColCount);
    return Math.min(colWidthCap, Math.max(COL_WIDTH_MIN, even));
  }, [containerWidth, dataColCount, indexColWidth, colWidthCap]);

  const columns = useMemo(
    () => buildDataColumns(sampleRows, {
      showIndex, excel, pageOffset, colWidth: adaptiveColWidth, cellWrap,
    }),
    [sampleRows, showIndex, excel, pageOffset, adaptiveColWidth, cellWrap],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setContainerWidth(Math.floor(el.clientWidth));
      if (!excel) {
        setBodyScrollY(undefined);
        return;
      }
      const header = el.querySelector<HTMLElement>('.ant-table-header');
      const headerH = header ? Math.ceil(header.getBoundingClientRect().height) : 36;
      const y = Math.floor(el.clientHeight - headerH);
      setBodyScrollY(y > 60 ? y : undefined);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const header = el.querySelector<HTMLElement>('.ant-table-header');
    if (header) ro.observe(header);
    return () => ro.disconnect();
  }, [excel, zoom, compact, pagedRows.length, columns.length]);

  const colCount = dataColCount + (showIndex ? 1 : 0);

  const handlePageChange = (next: number) => {
    if (onPageChange) onPageChange(next);
    else setInternalPage(next);
  };

  const rangeStart = displayTotal > 0 ? pageOffset + 1 : 0;
  const rangeEnd = Math.min(pageOffset + pagedRows.length, displayTotal);

  const tableWidth = indexColWidth + dataColCount * adaptiveColWidth;
  const scrollX = containerWidth > 0 ? Math.max(containerWidth, tableWidth) : tableWidth;
  const tableScroll = useMemo(() => {
    const cfg: { x?: number; y?: number } = {};
    if (scrollX > 0) cfg.x = scrollX;
    if (bodyScrollY) cfg.y = bodyScrollY;
    return Object.keys(cfg).length > 0 ? cfg : undefined;
  }, [scrollX, bodyScrollY]);

  return (
    <div
      className={`kc-xls-grid${compact ? ' kc-xls-grid--compact' : ''}${excel ? ' kc-xls-grid--excel' : ''}${cellWrap ? ' kc-xls-grid--wrap' : ''}`}
      style={{ '--xls-zoom': String(zoom) } as CSSProperties}
    >
      <div className="kc-xls-grid__scroll" ref={scrollRef}>
        <Table
          dataSource={pagedRows}
          rowKey={(_, i) => String(pageOffset + (i ?? 0))}
          columns={columns}
          pagination={false}
          size="small"
          bordered={excel}
          tableLayout="fixed"
          scroll={tableScroll}
          rowClassName={(_, i) => (i % 2 === 1 ? 'kc-xls-row-alt' : '')}
        />
      </div>
      {pageSize > 0 && displayTotal > 0 && (
        <footer className="kc-xls-grid__footer">
          <div className="kc-xls-grid__footer-left">
            <span className="kc-xls-grid__stat">
              {serverPaged && displayTotal > pagedRows.length
                ? `第 ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} 行 · 共 ${displayTotal.toLocaleString()} 行${colCount > 0 ? ` · ${colCount} 列` : ''}`
                : `${displayTotal.toLocaleString()} 行${colCount > 0 ? ` × ${colCount} 列` : ''}`}
            </span>
          </div>
          {displayTotal > pageSize && (
            <Pagination
              className="kc-xls-grid__pager"
              current={page}
              pageSize={pageSize}
              total={displayTotal}
              size="small"
              showSizeChanger={false}
              showLessItems
              onChange={handlePageChange}
            />
          )}
        </footer>
      )}
    </div>
  );
}

function buildChartOption(viz: PivotData['visualization']) {
  if (!viz) return null;
  if (viz.chartType === 'bar' || viz.chartType === 'line') {
    return {
      color: CHART_COLORS,
      tooltip: { trigger: 'axis' as const, backgroundColor: 'rgba(15,23,42,0.92)', borderWidth: 0, textStyle: { color: '#f8fafc' } },
      legend: { bottom: 4, textStyle: { color: '#64748b', fontSize: 12 } },
      grid: { left: '2%', right: '2%', bottom: '14%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: viz.categories,
        axisLabel: { rotate: (viz.categories?.length || 0) > 8 ? 32 : 0, color: '#94a3b8', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' as const } },
      },
      series: viz.series?.map((s, i) => ({
        name: s.name,
        type: viz.chartType,
        data: s.data,
        smooth: viz.chartType === 'line',
        barMaxWidth: 36,
        itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length], borderRadius: viz.chartType === 'bar' ? [4, 4, 0, 0] : 0 },
        areaStyle: viz.chartType === 'line' ? { opacity: 0.12 } : undefined,
      })),
    };
  }
  if (viz.chartType === 'heatmap' && viz.heatmapData) {
    const xValues = [...new Set(viz.heatmapData.map(d => d.x))];
    const yValues = [...new Set(viz.heatmapData.map(d => d.y))];
    const data = viz.heatmapData.map(d => [xValues.indexOf(d.x), yValues.indexOf(d.y), d.value]);
    return {
      tooltip: { position: 'top' as const },
      grid: { left: '10%', right: '6%', bottom: '18%', top: '4%' },
      xAxis: { type: 'category' as const, data: xValues, splitArea: { show: true } },
      yAxis: { type: 'category' as const, data: yValues, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: Math.max(...viz.heatmapData.map(d => d.value)),
        calculable: true,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: '0%',
        inRange: { color: ['#eff6ff', '#3b82f6', '#1e3a8a'] },
      },
      series: [{ type: 'heatmap' as const, data, label: { show: true, fontSize: 10 } }],
    };
  }
  return null;
}

export default function ExcelAnalysis() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileSearch, setFileSearch] = useState('');

  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [pivots, setPivots] = useState<PivotData[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTotalRows, setPreviewTotalRows] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const PREVIEW_PAGE_SIZE = 100;

  const [activeTab, setActiveTab] = useState<TabKey>('preview');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [querying, setQuerying] = useState(false);

  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [tableZoom, setTableZoom] = useState(1);
  const [tableCompact, setTableCompact] = useState(true);
  const [tableColWidth, setTableColWidth] = useState<ColWidthPreset>('normal');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const authFetch = useCallback((url: string, init?: RequestInit) => {
    const token = getAuthToken();
    return fetch(url, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }, []);

  const loadFileList = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAuthToken();
      const response = await fetch('/api/excel/list', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (data.success) setFiles(data.list);
    } catch {
      message.error('加载历史记录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadFileList(); }, [loadFileList]);

  const loadPreview = useCallback(async (
    profileId: string,
    sheetIndex: number,
    page = 1,
    fallback?: Record<string, unknown>[],
    sheetRowCount?: number,
  ) => {
    setPreviewLoading(true);
    setPreviewError(null);
    const offset = (page - 1) * PREVIEW_PAGE_SIZE;
    if (page === 1 && fallback?.length) {
      setPreviewData(fallback.slice(0, PREVIEW_PAGE_SIZE));
      setPreviewTotalRows(sheetRowCount ?? fallback.length);
    } else if (page === 1) {
      setPreviewData([]);
      setPreviewTotalRows(sheetRowCount ?? 0);
    }
    try {
      const token = getAuthToken();
      const response = await fetch(
        `/api/excel/preview/${profileId}?limit=${PREVIEW_PAGE_SIZE}&offset=${offset}&sheet=${sheetIndex}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json() as {
        success?: boolean;
        rows?: Record<string, unknown>[];
        totalRows?: number;
        error?: string;
        fallback?: boolean;
      };
      if (!response.ok || data.success === false) {
        throw new Error(data.error || '预览加载失败');
      }
      const rows = data.rows ?? [];
      const total = data.totalRows ?? sheetRowCount ?? rows.length;
      setPreviewTotalRows(total);
      if (rows.length > 0) {
        setPreviewData(rows);
      } else if (page === 1 && fallback?.length) {
        setPreviewData(fallback.slice(0, PREVIEW_PAGE_SIZE));
        setPreviewTotalRows(sheetRowCount ?? fallback.length);
      } else {
        setPreviewData([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '预览加载失败';
      setPreviewError(msg);
      if (page === 1 && fallback?.length) {
        setPreviewData(fallback.slice(0, PREVIEW_PAGE_SIZE));
        setPreviewTotalRows(sheetRowCount ?? fallback.length);
      } else if (page === 1) {
        setPreviewData([]);
        message.error(msg);
      }
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const selectFile = useCallback(async (file: FileInfo) => {
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
        const profileSheets = profile.sheets as SheetInfo[];
        setSheets(profileSheets);
        setActiveSheet(0);
        setPreviewPage(1);
        setPivots(data.pivots || []);
        setReport(data.report);
        const firstSheet = profileSheets[0];
        await loadPreview(file.id, 0, 1, firstSheet?.sampleData, firstSheet?.rowCount);
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `已加载 **${profile.fileNames[0]}**，共 ${file.totalRows.toLocaleString()} 行。你可以继续追问，或点击快捷问题。`,
        }]);
        setActiveTab('preview');
      }
    } catch {
      message.error('加载文件失败');
    } finally {
      setLoading(false);
    }
  }, [loadPreview]);

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
      if (!data.success) throw new Error(data.error || '上传失败');
      message.success(`分析完成：${data.totalRows.toLocaleString()} 行`);
      const newFile: FileInfo = {
        id: data.profileId,
        fileNames: [data.fileName],
        fileCount: 1,
        totalRows: data.totalRows,
        createdAt: new Date().toISOString(),
      };
      setFiles(prev => [newFile, ...prev.filter(f => f.id !== newFile.id)]);
      await selectFile(newFile);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleQuery = async (questionOverride?: string) => {
    const question = (questionOverride ?? inputValue).trim();
    if (!selectedFile || !question) return;
    setInputValue('');
    setQuerying(true);
    const assistantMsgId = `assistant-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
    }, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      loading: true,
    }]);
    try {
      const token = getAuthToken();
      const response = await fetch('/api/excel/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profileId: selectedFile.id, question }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || '查询失败');
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsgId
          ? { ...msg, content: `查询完成，共 ${data.rowCount} 条结果。`, result: { sql: data.sql, rows: data.rows, rowCount: data.rowCount }, loading: false }
          : msg,
      ));
    } catch (err) {
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsgId
          ? { ...msg, content: `查询失败：${err instanceof Error ? err.message : '未知错误'}`, loading: false }
          : msg,
      ));
    } finally {
      setQuerying(false);
    }
  };

  const handleRename = async () => {
    if (!selectedFile || !renameValue.trim()) return;
    setActionLoading(true);
    try {
      const response = await authFetch(`/api/excel/${selectedFile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: renameValue.trim() }),
      });
      const data = await response.json() as { success?: boolean; error?: string; fileName?: string };
      if (!data.success) throw new Error(data.error || '重命名失败');
      const newName = data.fileName ?? renameValue.trim();
      setSelectedFile(prev => prev ? { ...prev, fileNames: [newName] } : null);
      setFiles(prev => prev.map(f => (f.id === selectedFile.id ? { ...f, fileNames: [newName] } : f)));
      setRenameOpen(false);
      message.success('已重命名');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!selectedFile) return;
    setActionLoading(true);
    try {
      const response = await authFetch(`/api/excel/${selectedFile.id}`, { method: 'DELETE' });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!data.success) throw new Error(data.error || '删除失败');
      setFiles(prev => prev.filter(f => f.id !== selectedFile.id));
      setSelectedFile(null);
      message.success('工作簿已删除');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReanalyze = async () => {
    if (!selectedFile) return;
    setActionLoading(true);
    setLoading(true);
    try {
      const response = await authFetch(`/api/excel/${selectedFile.id}/reanalyze`, { method: 'POST' });
      const data = await response.json() as { success?: boolean; error?: string; pivots?: PivotData[]; report?: ReportData };
      if (!data.success) throw new Error(data.error || '重新分析失败');
      setPivots(data.pivots || []);
      setReport(data.report ?? null);
      message.success('透视表与报告已重新生成');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重新分析失败');
    } finally {
      setActionLoading(false);
      setLoading(false);
    }
  };

  const handleReplaceFile = async (file: File) => {
    if (!selectedFile) return;
    setActionLoading(true);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await authFetch(`/api/excel/${selectedFile.id}/replace`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json() as {
        success?: boolean;
        error?: string;
        fileName?: string;
        totalRows?: number;
        sheets?: SheetInfo[];
        pivots?: PivotData[];
        report?: ReportData;
      };
      if (!data.success) throw new Error(data.error || '替换失败');
      const updated: FileInfo = {
        ...selectedFile,
        fileNames: [data.fileName ?? file.name],
        totalRows: data.totalRows ?? selectedFile.totalRows,
        createdAt: new Date().toISOString(),
      };
      setSelectedFile(updated);
      setFiles(prev => [updated, ...prev.filter(f => f.id !== updated.id)]);
      const profileSheets = data.sheets ?? [];
      setSheets(profileSheets);
      setActiveSheet(0);
      setPreviewPage(1);
      setPivots(data.pivots || []);
      setReport(data.report ?? null);
      const firstSheet = profileSheets[0];
      await loadPreview(selectedFile.id, 0, 1, firstSheet?.sampleData, firstSheet?.rowCount);
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `已替换为 **${data.fileName}**，共 ${(data.totalRows ?? 0).toLocaleString()} 行。`,
      }]);
      message.success('文件已替换并重新分析');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '替换失败');
    } finally {
      setActionLoading(false);
      setLoading(false);
    }
  };

  const zoomOut = () => {
    const idx = ZOOM_STEPS.findIndex(z => z >= tableZoom - 0.001);
    const next = ZOOM_STEPS[Math.max(0, (idx < 0 ? 0 : idx) - 1)];
    if (next) setTableZoom(next);
  };

  const zoomIn = () => {
    const idx = ZOOM_STEPS.findIndex(z => z >= tableZoom - 0.001);
    const base = idx < 0 ? ZOOM_STEPS.length - 1 : idx;
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, base + 1)];
    if (next) setTableZoom(next);
  };

  const fileMenuItems: MenuProps['items'] = selectedFile ? [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: '重命名',
      onClick: () => {
        setRenameValue(selectedFile.fileNames[0] ?? '');
        setRenameOpen(true);
      },
    },
    {
      key: 'replace',
      icon: <SwapOutlined />,
      label: (
        <Upload
          accept=".xlsx,.xls"
          showUploadList={false}
          beforeUpload={f => { void handleReplaceFile(f); return false; }}
          disabled={actionLoading}
        >
          <span>替换文件</span>
        </Upload>
      ),
    },
    {
      key: 'reanalyze',
      icon: <SyncOutlined />,
      label: '重新分析',
      onClick: () => void handleReanalyze(),
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除工作簿',
      danger: true,
      onClick: () => {
        Modal.confirm({
          title: '删除工作簿',
          content: `确定删除「${selectedFile.fileNames[0]}」？透视表、报告与预览数据将一并删除。`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => handleDeleteFile(),
        });
      },
    },
  ] : [];

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return files;
    return files.filter(f => f.fileNames.some(n => n.toLowerCase().includes(q)));
  }, [files, fileSearch]);

  const handleSheetChange = useCallback((index: number) => {
    setActiveSheet(index);
    setPreviewPage(1);
    if (!selectedFile) return;
    const sheet = sheets[index];
    void loadPreview(selectedFile.id, index, 1, sheet?.sampleData, sheet?.rowCount);
  }, [selectedFile, sheets, loadPreview]);

  const handlePreviewPageChange = useCallback((page: number) => {
    setPreviewPage(page);
    if (!selectedFile) return;
    const sheet = sheets[activeSheet];
    void loadPreview(selectedFile.id, activeSheet, page, sheet?.sampleData, sheet?.rowCount);
  }, [selectedFile, sheets, activeSheet, loadPreview]);

  const currentSheet = sheets[activeSheet];
  const navCtx: NavCtx = { pivots: pivots.length, report: !!report };

  const renderPreview = () => (
    <div className="kc-excel-preview">
      <div className="kc-excel-formula-bar">
        <span className="kc-excel-formula-bar__fx">fx</span>
        <span className="kc-excel-formula-bar__sep" />
        <span className="kc-excel-formula-bar__hint">
          {previewLoading && previewData.length === 0
            ? '加载数据中…'
            : previewTotalRows > 0
              ? `数据表 · ${previewTotalRows.toLocaleString()} 行${currentSheet ? ` · ${currentSheet.columns.length} 列` : ''}${previewError ? '（缓存数据）' : ''}`
              : previewError ?? '暂无预览数据'}
        </span>
        <div className="kc-excel-grid-tools">
          <Tooltip title="缩小">
            <button type="button" className="kc-excel-grid-tools__btn" onClick={zoomOut} disabled={tableZoom <= ZOOM_STEPS[0]}>
              <ZoomOutOutlined />
            </button>
          </Tooltip>
          <span className="kc-excel-grid-tools__zoom">{Math.round(tableZoom * 100)}%</span>
          <Tooltip title="放大">
            <button type="button" className="kc-excel-grid-tools__btn" onClick={zoomIn} disabled={tableZoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
              <ZoomInOutlined />
            </button>
          </Tooltip>
          <span className="kc-excel-grid-tools__sep" />
          <Tooltip title="列宽：窄 / 标准 / 宽">
            <button
              type="button"
              className="kc-excel-grid-tools__btn kc-excel-grid-tools__btn--text"
              onClick={() => setTableColWidth(w => (w === 'narrow' ? 'normal' : w === 'normal' ? 'wide' : 'narrow'))}
            >
              <ColumnWidthOutlined />
              {tableColWidth === 'narrow' ? '窄' : tableColWidth === 'wide' ? '宽' : '标准'}
            </button>
          </Tooltip>
          <Tooltip title="紧凑行高">
            <button
              type="button"
              className={`kc-excel-grid-tools__btn kc-excel-grid-tools__btn--text${tableCompact ? ' is-active' : ''}`}
              onClick={() => setTableCompact(v => !v)}
            >
              紧凑
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="kc-excel-grid-wrap">
        <Spin spinning={previewLoading && previewData.length > 0}>
        {previewLoading && previewData.length === 0 ? (
          <div className="kc-excel-grid-loading"><Spin tip="加载预览数据…" /></div>
        ) : previewData.length > 0 ? (
          <DataTable
            rows={previewData}
            pageSize={PREVIEW_PAGE_SIZE}
            totalRows={previewTotalRows}
            page={previewPage}
            onPageChange={handlePreviewPageChange}
            excel
            showIndex
            zoom={tableZoom}
            compact={tableCompact}
            maxColWidth={COL_WIDTH_PRESETS[tableColWidth]}
          />
        ) : (
          <div className="kc-excel-grid-loading">
            <Empty description={previewError ?? '暂无数据'} />
          </div>
        )}
        </Spin>
      </div>
      {sheets.length > 0 && (
        <div className="kc-excel-sheetbar">
          <div className="kc-excel-sheetbar__tabs">
            {sheets.map((s, i) => (
              <button
                key={s.sheetName}
                type="button"
                className={`kc-excel-sheetbar__tab${activeSheet === i ? ' is-active' : ''}`}
                onClick={() => handleSheetChange(i)}
              >
                <TableOutlined />
                <span>{s.sheetName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderPivots = () => (
    <div className="kc-excel-tab-scroll">
      {pivots.length === 0 ? (
        <div className="kc-excel-tab-empty"><Empty description="暂无透视表，上传后将自动生成" /></div>
      ) : (
        pivots.map(pivot => {
          const chartOption = buildChartOption(pivot.visualization);
          return (
            <article key={pivot.pivotId || pivot.id} className="kc-excel-pivot">
              <header className="kc-excel-pivot__head">
                <div>
                  <h3 className="kc-excel-pivot__title">{pivot.name}</h3>
                  <p className="kc-excel-pivot__sub">{pivot.rowCount.toLocaleString()} 行聚合结果</p>
                </div>
              </header>
              {chartOption && (
                <div className="kc-excel-pivot__chart">
                  <ReactECharts option={chartOption} style={{ height: '100%', width: '100%' }} />
                </div>
              )}
              <div className="kc-excel-pivot__table">
                <DataTable rows={pivot.rows.slice(0, 10)} pageSize={0} compact showIndex={false} excel />
                {pivot.rows.length > 10 && (
                  <p className="kc-excel-pivot__more">显示前 10 行，共 {pivot.rows.length.toLocaleString()} 行</p>
                )}
              </div>
            </article>
          );
        })
      )}
    </div>
  );

  const renderReport = () => (
    <div className="kc-excel-tab-scroll kc-excel-tab-scroll--report">
      {report ? (
        <article className="kc-excel-report">
          <MarkdownContent content={report.content} className="kc-excel-report-md" />
        </article>
      ) : (
        <div className="kc-excel-tab-empty"><Empty description="暂无分析报告" /></div>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="kc-excel-chat">
      <div className="kc-excel-chat__messages">
        {messages.length > 1 && (
          <div className="kc-excel-chat__toolbar">
            <Button
              size="small"
              type="text"
              className="kc-excel-chat__clear"
              onClick={() => setMessages(messages.filter(m => m.id === 'welcome'))}
            >
              清空对话
            </Button>
          </div>
        )}
        <div className="kc-excel-chat__thread">
          {messages.map(msg => (
            <div key={msg.id} className={`kc-excel-msg kc-excel-msg--${msg.role}${msg.id === 'welcome' ? ' kc-excel-msg--welcome' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="kc-excel-msg__avatar">
                  <RobotOutlined />
                </div>
              )}
              <div className="kc-excel-msg__body">
                {msg.id === 'welcome' && (
                  <div className="kc-excel-welcome-card">
                    <div className="kc-excel-welcome-card__text">
                      {msg.loading ? (
                        <span className="kc-excel-msg__loading"><Spin size="small" /> 正在查询…</span>
                      ) : (
                        <MarkdownContent content={msg.content} className="kc-excel-msg__md" />
                      )}
                    </div>
                    <div className="kc-excel-hints">
                      {QUERY_HINTS.map(h => (
                        <button key={h} type="button" className="kc-excel-hint" onClick={() => void handleQuery(h)} disabled={querying}>
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {msg.id !== 'welcome' && (
                  <>
                    <div className="kc-excel-msg__bubble">
                      {msg.loading ? (
                        <span className="kc-excel-msg__loading"><Spin size="small" /> 正在查询…</span>
                      ) : msg.role === 'assistant' ? (
                        <MarkdownContent content={msg.content} className="kc-excel-msg__md" />
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.result && (
                      <div className="kc-excel-query-result">
                        <div className="kc-excel-query-result__head">
                          <BarChartOutlined />
                          <span>查询结果 · {msg.result.rowCount.toLocaleString()} 行</span>
                        </div>
                        <details className="kc-excel-sql">
                          <summary>查看 SQL</summary>
                          <pre className="kc-excel-sql__code">{msg.result.sql}</pre>
                        </details>
                        <div className="kc-excel-query-result__table">
                          <DataTable rows={msg.result.rows.slice(0, 10)} pageSize={0} compact excel maxColWidth={COL_WIDTH_PRESETS.normal} />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="kc-excel-msg__avatar kc-excel-msg__avatar--user">
                  <UserOutlined />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="kc-excel-chat__composer">
        <div className="kc-excel-chat__composer-inner">
          <TextArea
            className="kc-excel-chat__textarea"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); void handleQuery(); } }}
            placeholder="输入问题，Shift+Enter 换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={querying}
          />
          <Button
            type="primary"
            className="kc-excel-chat__send"
            icon={<SendOutlined />}
            onClick={() => void handleQuery()}
            loading={querying}
            disabled={!inputValue.trim()}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="kc-excel">
      <div className="kc-excel-shell">
        <aside className={`kc-excel-dock${dockCollapsed ? ' is-collapsed' : ''}`}>
          <div className="kc-excel-dock__titlebar">
            {!dockCollapsed && (
              <>
                <FileExcelOutlined />
                <span className="kc-excel-dock__title">工作簿</span>
              </>
            )}
            <button
              type="button"
              className="kc-excel-dock__toggle"
              onClick={() => setDockCollapsed(v => !v)}
              aria-label={dockCollapsed ? '展开工作簿' : '收起工作簿'}
            >
              {dockCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
          </div>

          {!dockCollapsed && (
            <>
          <div className="kc-excel-dock__upload">
            <Upload
              accept=".xlsx,.xls"
              beforeUpload={f => { void handleUpload(f); return false; }}
              showUploadList={false}
              disabled={uploading}
            >
              <div
                className={`kc-excel-open${dragging ? ' is-over' : ''}${uploading ? ' is-loading' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={() => setDragging(false)}
              >
                <div className="kc-excel-open__icon">
                  {uploading ? <Spin size="small" /> : <PlusOutlined />}
                </div>
                <div className="kc-excel-open__text">
                  <strong>{uploading ? '正在分析…' : '打开工作簿'}</strong>
                  <span>拖入或点击选择 .xlsx / .xls</span>
                </div>
              </div>
            </Upload>
          </div>

          <div className="kc-excel-dock__search">
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索文件名…"
              value={fileSearch}
              onChange={e => setFileSearch(e.target.value)}
              allowClear
              size="small"
            />
          </div>

          <div className="kc-excel-dock__list">
            <div className="kc-excel-dock__list-head">
              <span>最近打开</span>
              <button type="button" className="kc-excel-dock__refresh" onClick={() => void loadFileList()} aria-label="刷新">
                <ReloadOutlined spin={loading} />
              </button>
            </div>
            <div className="kc-excel-dock__list-body">
              {loading && filteredFiles.length === 0 ? (
                <div className="kc-excel-dock__empty"><Spin size="small" /></div>
              ) : filteredFiles.length === 0 ? (
                <div className="kc-excel-dock__empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作簿" /></div>
              ) : (
                filteredFiles.map(item => {
                  const name = item.fileNames[0] ?? '未命名';
                  const ext = fileExt(name);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`kc-xls-file${selectedFile?.id === item.id ? ' is-active' : ''}`}
                      onClick={() => void selectFile(item)}
                    >
                      <span className="kc-xls-file__icon" aria-hidden>
                        <FileExcelOutlined />
                        <em>{ext}</em>
                      </span>
                      <span className="kc-xls-file__info">
                        <span className="kc-xls-file__name" title={name}>{name}</span>
                        <span className="kc-xls-file__meta">
                          <span>{item.totalRows.toLocaleString()} 行</span>
                          <span>{formatFileTime(item.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
            </>
          )}
        </aside>

        <main className="kc-excel-stage">
          {!selectedFile ? (
            <div className="kc-excel-hero">
              <div className="kc-excel-hero__icon"><FileExcelOutlined /></div>
              <h1>Excel 智能分析</h1>
              <p>上传表格，自动完成数据画像、透视汇总、可视化与自然语言追问。</p>
              <Upload accept=".xlsx,.xls" beforeUpload={f => { void handleUpload(f); return false; }} showUploadList={false} disabled={uploading}>
                <Button type="primary" size="large" icon={<UploadOutlined />} loading={uploading} className="kc-excel-hero__btn">
                  打开工作簿
                </Button>
              </Upload>
            </div>
          ) : (
            <Spin spinning={loading} wrapperClassName="kc-excel-stage__spin">
              <header className="kc-excel-banner">
                <div className="kc-excel-banner__main">
                  <div className="kc-excel-banner__icon"><FileExcelOutlined /></div>
                  <div className="kc-excel-banner__info">
                    <h2 className="kc-excel-banner__title">{selectedFile.fileNames[0]}</h2>
                    <p className="kc-excel-banner__sub">
                      共 {selectedFile.totalRows.toLocaleString()} 行
                      {sheets.length > 1 ? ` · ${sheets.length} 个工作表` : currentSheet ? ` · ${currentSheet.columns.length} 列` : ''}
                    </p>
                  </div>
                </div>
                <div className="kc-excel-metrics">
                  <div className="kc-excel-metric"><strong>{sheets.length}</strong><span>工作表</span></div>
                  <div className="kc-excel-metric"><strong>{pivots.length}</strong><span>透视表</span></div>
                  <div className="kc-excel-metric"><strong>{report ? '✓' : '—'}</strong><span>报告</span></div>
                </div>
                <div className="kc-excel-banner__actions">
                  <Dropdown menu={{ items: fileMenuItems }} trigger={['click']} disabled={actionLoading}>
                    <Button icon={<MoreOutlined />} loading={actionLoading}>管理</Button>
                  </Dropdown>
                </div>
              </header>

              <nav className="kc-excel-tabs" role="tablist">
                {NAV_TABS.map(tab => {
                  const Icon = tab.icon;
                  const count = tab.count?.(navCtx);
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab.key}
                      className={`kc-excel-tabs__item${activeTab === tab.key ? ' is-active' : ''}`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      <Icon />
                      <span>{tab.label}</span>
                      {count !== undefined && count > 0 && <em>{count}</em>}
                    </button>
                  );
                })}
              </nav>

              <div className="kc-excel-workspace">
                {activeTab === 'preview' && renderPreview()}
                {activeTab === 'pivots' && renderPivots()}
                {activeTab === 'report' && renderReport()}
                {activeTab === 'chat' && renderChat()}
              </div>
            </Spin>
          )}
        </main>
      </div>

      <Modal
        title="重命名工作簿"
        open={renameOpen}
        onOk={() => void handleRename()}
        onCancel={() => setRenameOpen(false)}
        confirmLoading={actionLoading}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          placeholder="输入新的显示名称"
          maxLength={120}
          onPressEnter={() => void handleRename()}
        />
      </Modal>
    </div>
  );
}
