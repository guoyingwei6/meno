import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { extractMarkdownImageUrls, stripMarkdownImageSyntax, stripTagSyntax } from '../lib/content';
import { useEffect, useState } from 'react';
import type { MemoSummary } from '../types/shared';
import { useTheme, colors } from '../lib/theme';

interface MemoCardProps {
  memo: MemoSummary;
  isAuthor?: boolean;
  isTrash?: boolean;
  onOpen?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onEdit?: (memo: MemoSummary) => void;
  onRestore?: (memo: MemoSummary) => void;
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

export const MemoCard = ({ memo, isAuthor, isTrash, onOpen, onOpenTag, onEdit, onRestore, onChangeVisibility, onDelete }: MemoCardProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const imageUrls = extractMarkdownImageUrls(memo.content);
  const contentText = stripTagSyntax(stripMarkdownImageSyntax(memo.content));
  const isLong = contentText.length > 200;
  const wordCount = countWords(memo.content);

  useEffect(() => {
    if (lightboxIndex === null || imageUrls.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => i === null ? null : (i - 1 + imageUrls.length) % imageUrls.length);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => i === null ? null : (i + 1) % imageUrls.length);
      if (e.key === 'Escape') setLightboxIndex(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex, imageUrls.length]);

  const handleShare = () => {
    const url = `${window.location.origin}/memos/${memo.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article style={{ ...styles.card, background: c.cardBg, borderColor: c.border }}>
      <div style={styles.header}>
        <span style={{ ...styles.date, color: c.textMuted }}>{memo.displayDate}</span>
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
              <div style={{ ...styles.menuDropdown, background: c.cardBg, borderColor: c.border }}>
                <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="查看详情" onClick={() => { setMenuOpen(false); onOpen?.(memo); }}>查看详情</button>
                <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="分享" onClick={handleShare}>分享链接</button>
                {isAuthor && isTrash ? (
                  <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="恢复" onClick={() => { setMenuOpen(false); onRestore?.(memo); }}>恢复</button>
                ) : isAuthor ? (
                  <>
                    <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="编辑" onClick={() => { setMenuOpen(false); onEdit?.(memo); }}>编辑</button>
                    {memo.visibility === 'public' ? (
                      <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="设为私密" onClick={() => { setMenuOpen(false); onChangeVisibility?.(memo, 'private'); }}>设为私密</button>
                    ) : (
                      <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="设为公开" onClick={() => { setMenuOpen(false); onChangeVisibility?.(memo, 'public'); }}>设为公开</button>
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
      <div style={isLong && !expanded ? { ...styles.content, color: c.textSecondary, maxHeight: 160, overflow: 'hidden' } : { ...styles.content, color: c.textSecondary }}>
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={{
            p: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
            li: ({ children }) => <li style={{ lineHeight: 1.7 }}>{children}</li>,
            h1: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h2: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h3: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h4: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h5: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h6: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
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
          {imageUrls.map((url, i) => (
            <img key={url} src={url} alt="memo preview" loading="lazy" decoding="async" style={styles.previewImage} onClick={() => setLightboxIndex(i)} />
          ))}
        </div>
      ) : null}
      <div style={{ ...styles.footer, borderTopColor: c.border }}>
        <span style={styles.footerText}>字数: {wordCount}</span>
        <span style={styles.footerText}>创建于 {formatTime(memo.createdAt)}</span>
        {memo.updatedAt !== memo.createdAt ? <span style={styles.footerText}>编辑于 {formatTime(memo.updatedAt)}</span> : null}
      </div>
      {lightboxIndex !== null ? (
        <div style={styles.lightbox} onClick={() => setLightboxIndex(null)}>
          {imageUrls.length > 1 && (
            <button
              type="button"
              style={styles.lightboxArrowLeft}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + imageUrls.length) % imageUrls.length); }}
            >‹</button>
          )}
          <img src={imageUrls[lightboxIndex]} alt="full size" style={styles.lightboxImage} onClick={(e) => e.stopPropagation()} />
          {imageUrls.length > 1 && (
            <button
              type="button"
              style={styles.lightboxArrowRight}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % imageUrls.length); }}
            >›</button>
          )}
          {imageUrls.length > 1 && (
            <span style={styles.lightboxCounter}>{lightboxIndex + 1} / {imageUrls.length}</span>
          )}
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
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    cursor: 'zoom-out',
  },
  lightboxImage: {
    maxWidth: '80vw',
    maxHeight: '85vh',
    borderRadius: 8,
    objectFit: 'contain',
    cursor: 'default',
  },
  lightboxArrowLeft: {
    position: 'absolute',
    left: 16,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    fontSize: 40,
    lineHeight: 1,
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
  },
  lightboxArrowRight: {
    position: 'absolute',
    right: 16,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    fontSize: 40,
    lineHeight: 1,
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
  },
  lightboxCounter: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    background: 'rgba(0,0,0,0.4)',
    padding: '3px 10px',
    borderRadius: 12,
  },
};
