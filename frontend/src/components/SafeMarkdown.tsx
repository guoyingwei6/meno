import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Only allow URLs that can be rendered without executing code.  Markdown HTML
 * is intentionally not enabled in this component (see `skipHtml` below), so
 * this is the second line of defence for links and images.
 */
export const isSafeMarkdownUrl = (value: string): boolean => {
  const url = value.trim();
  if (!url || url.startsWith('//')) return false;
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;

  try {
    const parsed = new URL(url, typeof window === 'undefined' ? 'https://meno.invalid' : window.location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const safeUrlTransform: UrlTransform = (url) => (isSafeMarkdownUrl(url) ? url : '');

export interface SafeMarkdownProps {
  content: string;
  components?: Components;
}

/**
 * Shared Markdown renderer for memo cards, detail pages and source/share
 * previews. Raw HTML is disabled rather than passed through `rehypeRaw`; this
 * keeps user content as Markdown/text and prevents event attributes, iframe,
 * style and srcdoc payloads from becoming DOM nodes.
 */
export const SafeMarkdown = ({ content, components }: SafeMarkdownProps) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    urlTransform={safeUrlTransform}
    components={components}
  >
    {content}
  </ReactMarkdown>
);
