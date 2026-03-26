import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { extractMarkdownImageUrls, stripMarkdownImageSyntax, stripTagSyntax } from '../lib/content';
import { useState } from 'react';
import type { MemoSummary } from '../types/shared';

interface MemoCardProps {
  memo: MemoSummary;
  isAuthor?: boolean;
  onOpen?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onEdit?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDelete?: (memo: MemoSummary) => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const countWords = (text: string) => {
  const cleaned = text.replace(/!\[.*?\]\(.*?\)/g, '').replace(/[#*_~`>\-\[\]()]/g, '').trim();
  return cleaned.length;
};

export const MemoCard = ({ memo, isAuthor, onOpen, onOpenTag, onEdit, onChangeVisibility, onDelete }: MemoCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const imageUrls = extractMarkdownImageUrls(memo.content);
  const contentText = stripTagSyntax(stripMarkdownImageSyntax(memo.content));
  const isLong = contentText.length > 200;
  const wordCount = countWords(memo.content);

  const handleShare = () => {
    const url = `${window.location.origin}/memos/${memo.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article style={styles.card}>
      <div style={styles.header}>
        <span style={styles.date}>{memo.displayDate}</span>
        <div style={styles.headerRight}>
          {copied ? <span style={styles.copiedHint}>链接已复制</span> : null}
          <div style={styles.menuWrap}>
            <button
              type="button"
              aria-label="更多操作"
              style={styles.menuTrigger}
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              ···
            </button>
            {menuOpen ? (
              <div style={styles.menuDropdown}>
                <button type="button" style={styles.menuItem} aria-label="查看详情" onClick={() => { setMenuOpen(false); onOpen?.(memo); }}>查看详情</button>
                <button type="button" style={styles.menuItem} aria-label="分享" onClick={handleShare}>分享链接</button>
                {isAuthor ? (
                  <>
                    <button type="button" style={styles.menuItem} aria-label="编辑" onClick={() => { setMenuOpen(false); onEdit?.(memo); }}>编辑</button>
                    {memo.visibility === 'public' ? (
                      <button type="button" style={styles.menuItem} aria-label="设为私密" onClick={() => { setMenuOpen(false); onChangeVisibility?.(memo, 'private'); }}>设为私密</button>
                    ) : (
                      <button type="button" style={styles.menuItem} aria-label="设为公开" onClick={() => { setMenuOpen(false); onChangeVisibility?.(memo, 'public'); }}>设为公开</button>
                    )}
                    <button type="button" style={styles.menuItemDanger} aria-label="删除" onClick={() => { setMenuOpen(false); onDelete?.(memo); }}>删除</button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div style={styles.tags}>
        {memo.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            style={styles.tag}
            onClick={() => onOpenTag?.(tag)}
            aria-label={`#${tag}`}
          >
            #{tag}
          </button>
        ))}
      </div>
      <div style={isLong && !expanded ? { ...styles.content, maxHeight: 160, overflow: 'hidden' } : styles.content}>
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={{
            p: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
            li: ({ children }) => <li style={{ lineHeight: 1.7 }}>{children}</li>,
          }}
        >
          {contentText}
        </ReactMarkdown>
      </div>
      {isLong ? (
        <button
          type="button"
          style={styles.expandButton}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      ) : null}
      {imageUrls.length > 0 ? (
        <div style={styles.previewGrid}>
          {imageUrls.map((url) => (
            <img key={url} src={url} alt="memo preview" style={styles.previewImage} onClick={() => setLightboxUrl(url)} />
          ))}
        </div>
      ) : null}
      <div style={styles.footer}>
        <span style={styles.footerText}>字数: {wordCount}</span>
        <span style={styles.footerText}>创建于 {formatTime(memo.createdAt)}</span>
        {memo.updatedAt !== memo.createdAt ? <span style={styles.footerText}>编辑于 {formatTime(memo.updatedAt)}</span> : null}
      </div>
      {lightboxUrl ? (
        <div style={styles.lightbox} onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="full size" style={styles.lightboxImage} />
        </div>
      ) : null}
    </article>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '16px 20px',
    border: '1px solid #f0f0f0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  copiedHint: {
    fontSize: 12,
    color: '#3aa864',
    fontWeight: 500,
  },
  date: {
    color: '#999',
    fontSize: 13,
  },
  menuWrap: {
    position: 'relative',
  },
  menuTrigger: {
    border: 'none',
    background: 'transparent',
    color: '#999',
    cursor: 'pointer',
    fontSize: 16,
    padding: '2px 6px',
    lineHeight: 1,
    letterSpacing: 1,
  },
  menuDropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    zIndex: 10,
    minWidth: 100,
    padding: '4px 0',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '8px 14px',
    fontSize: 13,
    color: '#444',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  menuItemDanger: {
    display: 'block',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '8px 14px',
    fontSize: 13,
    color: '#e53e3e',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  content: {
    color: '#333',
    fontSize: 14,
    wordBreak: 'break-word',
  },
  expandButton: {
    border: 'none',
    background: 'transparent',
    color: '#3aa864',
    cursor: 'pointer',
    padding: '4px 0 8px',
    fontSize: 13,
  },
  previewGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  previewImage: {
    width: 64,
    height: 64,
    objectFit: 'cover',
    borderRadius: 6,
    background: '#f5f5f5',
    cursor: 'pointer',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    color: '#3aa864',
    background: 'transparent',
    borderRadius: 0,
    padding: 0,
    fontSize: 14,
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #f0f0f0',
  },
  footerText: {
    fontSize: 11,
    color: '#bbb',
  },
  lightbox: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    cursor: 'zoom-out',
  },
  lightboxImage: {
    maxWidth: '90vw',
    maxHeight: '90vh',
    borderRadius: 8,
    objectFit: 'contain',
  },
};
