import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  memo,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyOutlined, CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import { message } from 'antd';
import { normalizeCitationMarkers } from './normalizeCitationMarkers';
import { sanitizeAnswerContent } from './sanitizeAnswerContent';

interface Props {
  content: string;
  className?: string;
  /** 流式输出中：流程图仅占位，不尝试渲染（避免不完整语法报错） */
  streaming?: boolean;
}

const MERMAID_LANGS = new Set(['mermaid', 'flowchart', 'graph']);

let mermaidInit: Promise<typeof import('mermaid')['default']> | null = null;

function loadMermaid() {
  if (!mermaidInit) {
    mermaidInit = import('mermaid').then(m => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        suppressErrorRendering: true,
      });
      return m.default;
    });
  }
  return mermaidInit;
}

/** 修正 LLM 常见 Mermaid 语法问题 */
function normalizeMermaidSource(source: string): string {
  let s = source.trim();
  s = s.replace(/\[\d+\]/g, '');
  s = s.replace(/[""]/g, '"').replace(/['']/g, "'");
  const firstLine = s.split('\n')[0]?.trim() ?? '';
  const hasType = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|gitGraph|C4Context)/i.test(firstLine);
  if (!hasType && s.length > 0) {
    s = `flowchart TD\n${s}`;
  }
  return s;
}

function MermaidPlaceholder({ hint }: { hint: string }) {
  return (
    <div className="kc-md-mermaid__placeholder" aria-busy="true" aria-label={hint}>
      <LoadingOutlined spin className="kc-md-mermaid__placeholder-icon" />
      <span>{hint}</span>
    </div>
  );
}

function wrapCitationRefs(content: string): string {
  return content.replace(/\[(\d+)\]/g, '[$1](#cite-$1)');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function tableToTsv(table: HTMLTableElement): string {
  return Array.from(table.querySelectorAll('tr'))
    .map(row => Array.from(row.querySelectorAll('th, td'))
      .map(cell => cell.textContent?.trim().replace(/\s+/g, ' ') ?? '')
      .join('\t'))
    .join('\n');
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const ok = await copyText(text);
    if (!ok) {
      message.error('复制失败');
      return;
    }
    setCopied(true);
    message.success('已复制');
    window.setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button type="button" className="kc-md-copy" onClick={() => { void onCopy(); }} aria-label={label}>
      {copied ? <CheckOutlined /> : <CopyOutlined />}
      <span>{copied ? '已复制' : label}</span>
    </button>
  );
}

function MermaidDiagram({ source, streaming }: { source: string; streaming: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderSeq = useRef(0);
  const baseId = useId().replace(/:/g, '');
  const [failed, setFailed] = useState(false);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (streaming) {
      setFailed(false);
      setRendering(false);
      if (containerRef.current) containerRef.current.innerHTML = '';
      return;
    }

    let cancelled = false;
    renderSeq.current += 1;
    const renderId = `mmd-${baseId}-${renderSeq.current}`;
    const normalized = normalizeMermaidSource(source);

    if (!normalized) {
      setFailed(true);
      setRendering(false);
      return;
    }

    void (async () => {
      setFailed(false);
      setRendering(true);
      if (containerRef.current) containerRef.current.innerHTML = '';

      try {
        const mermaid = await loadMermaid();
        if (cancelled || !containerRef.current) return;

        await mermaid.parse(normalized);
        const { svg } = await mermaid.render(renderId, normalized);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setRendering(false);
        }
      } catch {
        if (!cancelled) {
          if (containerRef.current) containerRef.current.innerHTML = '';
          setFailed(true);
          setRendering(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [source, baseId, streaming]);

  const showPlaceholder = streaming || rendering;

  return (
    <div className="kc-md-block kc-md-mermaid">
      <div className="kc-md-block__bar">
        <span className="kc-md-block__label">流程图</span>
        {!streaming && <CopyButton text={source} label="复制源码" />}
      </div>
      {failed ? (
        <pre className="kc-md-code-block__pre kc-md-mermaid__fallback"><code>{source}</code></pre>
      ) : (
        <div className="kc-md-mermaid__body">
          {showPlaceholder && (
            <MermaidPlaceholder hint={streaming ? '流程图生成中…' : '流程图渲染中…'} />
          )}
          <div
            className={`kc-md-mermaid__canvas${showPlaceholder ? ' kc-md-mermaid__canvas--hidden' : ''}`}
            ref={containerRef}
          />
        </div>
      )}
    </div>
  );
}

function CodeBlock({ lang, code, streaming }: { lang: string; code: string; streaming: boolean }) {
  if (MERMAID_LANGS.has(lang.toLowerCase())) {
    return <MermaidDiagram source={code} streaming={streaming} />;
  }

  return (
    <div className="kc-md-block kc-md-code-block">
      <div className="kc-md-block__bar">
        <span className="kc-md-block__label">{lang || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="kc-md-code-block__pre">
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

function TableWrapper({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const onCopyTable = useCallback(async () => {
    const table = wrapRef.current?.querySelector('table');
    if (!table) return;
    const ok = await copyText(tableToTsv(table));
    if (ok) message.success('表格已复制');
    else message.error('复制失败');
  }, []);

  return (
    <div className="kc-md-block kc-md-table-block" ref={wrapRef}>
      <div className="kc-md-block__bar">
        <span className="kc-md-block__label">表格</span>
        <button type="button" className="kc-md-copy" onClick={() => { void onCopyTable(); }}>
          <CopyOutlined />
          <span>复制表格</span>
        </button>
      </div>
      <div className="kc-md-table-scroll">
        <table>{children}</table>
      </div>
    </div>
  );
}

function extractCodeFromPre(children: ReactNode): { lang: string; code: string } | null {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const el = child as ReactElement<{ className?: string; children?: ReactNode }>;
  const className = el.props.className ?? '';
  const match = /language-([\w-]+)/.exec(className);
  const lang = match?.[1] ?? '';
  const code = String(el.props.children ?? '').replace(/\n$/, '');
  return { lang, code };
}

const MarkdownContent = memo(function MarkdownContent({ content, className = 'kc-chat-md', streaming = false }: Props) {
  const normalized = wrapCitationRefs(normalizeCitationMarkers(sanitizeAnswerContent(content)));
  if (!normalized.trim()) return null;

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#cite-')) {
              return <span className="kc-cite-ref">{children}</span>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          table: ({ children }) => <TableWrapper>{children}</TableWrapper>,
          pre: ({ children }) => {
            const parsed = extractCodeFromPre(children);
            if (!parsed) return <pre>{children}</pre>;
            return <CodeBlock lang={parsed.lang} code={parsed.code} streaming={streaming} />;
          },
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = /language-/.test(codeClass ?? '');
            if (isBlock) {
              return <code className={codeClass} {...props}>{children}</code>;
            }
            return <code className="kc-md-inline-code" {...props}>{children}</code>;
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownContent;
