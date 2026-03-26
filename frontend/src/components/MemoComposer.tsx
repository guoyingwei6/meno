import { useRef, useState } from 'react';

interface MemoComposerSubmitInput {
  content: string;
  visibility: 'public' | 'private' | 'draft';
  displayDate: string;
}

interface MemoComposerProps {
  defaultDisplayDate: string;
  onSubmit: (input: MemoComposerSubmitInput) => Promise<void>;
}

interface UploadedImage {
  url: string;
  name: string;
}

const getApiBase = () => (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ || '';

export const MemoComposer = ({ defaultDisplayDate, onSubmit }: MemoComposerProps) => {
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'draft'>('public');
  const [displayDate, setDisplayDate] = useState(defaultDisplayDate);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const wrapSelection = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const wrapped = `${before}${selected || '文本'}${after}`;
    const next = content.slice(0, start) + wrapped + content.slice(end);
    setContent(next);
    setTimeout(() => {
      ta.focus();
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + (selected || '文本').length;
      ta.setSelectionRange(cursorStart, cursorEnd);
    }, 0);
  };

  const insertLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  };

  const handleSubmit = async () => {
    const textPart = content.trim();
    const imagePart = images.map((img) => `![](${img.url})`).join('\n');
    const fullContent = [textPart, imagePart].filter(Boolean).join('\n');
    if (!fullContent) return;
    await onSubmit({ content: fullContent, visibility, displayDate });
    setContent('');
    setVisibility('public');
    setDisplayDate(defaultDisplayDate);
    setImages([]);
  };

  return (
    <section style={styles.card}>
      <textarea
        ref={textareaRef}
        style={styles.textarea}
        placeholder="现在的想法是..."
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      {images.length > 0 ? (
        <div style={styles.imagePreviewGrid}>
          {images.map((img, i) => (
            <div key={img.url} style={styles.imagePreviewWrap}>
              <img src={img.url} alt={img.name} style={styles.imagePreviewThumb} />
              <button
                type="button"
                aria-label={`删除 ${img.name}`}
                style={styles.imageRemoveButton}
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div style={styles.toolbar}>
        <div style={styles.toolsLeft}>
          <button type="button" style={styles.fmtButton} title="加粗" onClick={() => wrapSelection('**', '**')}>
            <strong>B</strong>
          </button>
          <button type="button" style={styles.fmtButton} title="斜体" onClick={() => wrapSelection('*', '*')}>
            <em>I</em>
          </button>
          <button type="button" style={styles.fmtButton} title="下划线" onClick={() => wrapSelection('<u>', '</u>')}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <span style={styles.fmtDivider} />
          <button type="button" style={styles.fmtButton} title="无序列表" onClick={() => insertLinePrefix('- ')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="#666"/><circle cx="4" cy="12" r="1" fill="#666"/><circle cx="4" cy="18" r="1" fill="#666"/></svg>
          </button>
          <button type="button" style={styles.fmtButton} title="有序列表" onClick={() => insertLinePrefix('1. ')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">1</text><text x="2" y="14" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">2</text><text x="2" y="20" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">3</text></svg>
          </button>
          <span style={styles.fmtDivider} />
          <button type="button" style={styles.toolIcon} title="上传图片" onClick={() => fileInputRef.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </button>
          <input
            ref={fileInputRef}
            aria-label="上传图片"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append('file', file);
              const response = await fetch(`${getApiBase()}/api/uploads`, {
                method: 'POST',
                credentials: 'include',
                body: form,
              });
              const payload = (await response.json()) as { url: string };
              setImages((prev) => [...prev, { url: payload.url, name: file.name }]);
              input.value = '';
            }}
          />
          <label style={styles.selectWrap}>
            <select aria-label="可见性" value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private' | 'draft')} style={styles.select}>
              <option value="public">公开</option>
              <option value="private">私密</option>
            </select>
          </label>
          <label style={styles.selectWrap}>
            <input aria-label="归属日期" type="date" value={displayDate} onChange={(event) => setDisplayDate(event.target.value)} style={styles.dateInput} />
          </label>
        </div>
        <button type="button" style={styles.submitButton} onClick={handleSubmit}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e8e8e8',
    overflow: 'hidden',
    marginBottom: 16,
  },
  textarea: {
    width: '100%',
    minHeight: 100,
    padding: '16px 20px 8px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    fontSize: 15,
    lineHeight: 1.6,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  imagePreviewGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    padding: '4px 20px 8px',
  },
  imagePreviewWrap: {
    position: 'relative',
    width: 80,
    height: 80,
  },
  imagePreviewThumb: {
    width: 80,
    height: 80,
    objectFit: 'cover',
    borderRadius: 8,
    background: '#f5f5f5',
  },
  imageRemoveButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.5)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderTop: '1px solid #f5f5f5',
  },
  toolsLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  fmtButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '4px 6px',
    fontSize: 14,
    color: '#666',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
  },
  fmtDivider: {
    width: 1,
    height: 16,
    background: '#e0e0e0',
    margin: '0 2px',
  },
  toolIcon: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
  },
  selectWrap: {
    display: 'flex',
    alignItems: 'center',
  },
  select: {
    borderRadius: 6,
    border: '1px solid #e6e6e6',
    padding: '4px 8px',
    background: '#fff',
    fontSize: 13,
    color: '#666',
  },
  dateInput: {
    borderRadius: 6,
    border: '1px solid #e6e6e6',
    padding: '4px 8px',
    background: '#fff',
    fontSize: 13,
    color: '#666',
  },
  submitButton: {
    border: 'none',
    borderRadius: '50%',
    width: 36,
    height: 36,
    background: '#31d266',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
};
