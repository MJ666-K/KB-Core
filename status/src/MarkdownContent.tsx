import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeCitationMarkers } from './normalizeCitationMarkers';
import { sanitizeAnswerContent } from './sanitizeAnswerContent';

interface Props {
  content: string;
  className?: string;
}

/** 将 [1] 转为可自定义样式的伪链接，避免被 Markdown 误解析 */
function wrapCitationRefs(content: string): string {
  return content.replace(/\[(\d+)\]/g, '[$1](#cite-$1)');
}

export default function MarkdownContent({ content, className = 'kc-chat-md' }: Props) {
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
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
