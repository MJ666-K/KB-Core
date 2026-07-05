import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { compactMarkdown } from './chatLabels';

interface Props {
  content: string;
  className?: string;
}

export default function MarkdownContent({ content, className = 'kc-chat-md' }: Props) {
  const md = compactMarkdown(content);
  if (!md) return null;

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}
