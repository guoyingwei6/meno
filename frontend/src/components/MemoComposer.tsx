import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCaretCoords, getRecentTags, recordRecentTag } from '../lib/caret';
import { useTheme, colors } from '../lib/theme';

interface MemoComposerSubmitInput {
  content: string;
  visibility: 'public' | 'private';
  displayDate: string;
}

interface MemoComposerProps {
  defaultDisplayDate: string;
  onSubmit: (input: MemoComposerSubmitInput) => Promise<void>;
  existingTags?: Array<{ tag: string; count: number }>;
}

interface UploadedImage {
  url: string;
  name: string;
}

const getApiBase = () => (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ || '';

/** Renders text with #tags in green and code blocks with background — sits behind transparent textarea */
const HighlightOverlay = ({ text, textColor, isDark }: { text: string; textColor: string; isDark: boolean }) => {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|#[^\s#]+)/g);
  const codeBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={styles.highlightOverlay} aria-hidden="true">
      {parts.map((part, i) => {
        if (part.startsWith('```'))
          return <span key={i} style={{ color: textColor, background: codeBg, borderRadius: 3 }}>{part}</span>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1)
          return <span key={i} style={{ color: textColor, background: codeBg, borderRadius: 3 }}>{part}</span>;
        if (/^#[^\s#]+$/.test(part))
          return <span key={i} style={{ color: '#3aa864', fontWeight: 500 }}>{part}</span>;
        return <span key={i} style={{ color: textColor }}>{part}</span>;
      })}
      <span>{'\n '}</span>
    </div>
  );
};

const areSuggestionsEqual = (prev: string[] | undefined, next: string[]) => {
  if (!prev) return false;
  return prev.length === next.length && prev.every((tag, index) => tag === next[index]);
};

const isInsideCodeBlock = (text: string, pos: number): boolean => {
  const before = text.slice(0, pos);
  const fenced = (before.match(/```/g) || []).length;
  if (fenced % 2 === 1) return true;
  const withoutFenced = before.replace(/```[\s\S]*?```/g, '');
  const backticks = (withoutFenced.match(/`/g) || []).length;
  return backticks % 2 === 1;
};

const getTagMatchBeforeCursor = (value: string, cursorPos: number) => {
  if (isInsideCodeBlock(value, cursorPos)) return null;
  return value.slice(0, cursorPos).match(/#([^\s#]*)$/);
};

const restoreTextareaFocus = (textarea: HTMLTextAreaElement | null, cursorPos: number) => {
  if (!textarea) return;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
};

export const MemoComposer = ({ defaultDisplayDate, onSubmit, existingTags = [] }: MemoComposerProps) => {
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [displayDate, setDisplayDate] = useState(defaultDisplayDate);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [tagDropdown, setTagDropdown] = useState<{ suggestions: string[]; top: number; left: number } | null>(null);
  const [tagIndex, setTagIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const { isDark } = useTheme();
  const c = colors(isDark);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const dismissedTagMatchRef = useRef<string | null>(null);

  const updateTagSuggestions = (value: string, cursorPos: number) => {
    const ta = textareaRef.current;
    const match = getTagMatchBeforeCursor(value, cursorPos);
    if (!match || !ta) {
      dismissedTagMatchRef.current = null;
      setTagDropdown(null);
      return;
    }
    if (dismissedTagMatchRef.current === match[0]) {
      setTagDropdown(null);
      return;
    }
    dismissedTagMatchRef.current = null;
    const prefix = match[1];
    const recent = getRecentTags();
    const suggestions = existingTags
      .map((t) => t.tag)
      .filter((t) => t.startsWith(prefix) && t !== prefix)
      .sort((a, b) => {
        const ia = recent.indexOf(a), ib = recent.indexOf(b);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    if (!suggestions.length) { setTagDropdown(null); setTagIndex(0); return; }
    const coords = getCaretCoords(ta);
    setTagDropdown({ suggestions, ...coords });
    setTagIndex((current) => {
      if (areSuggestionsEqual(tagDropdown?.suggestions, suggestions) && current < suggestions.length) return current;
      return 0;
    });
  };

  const dismissTagSuggestions = (value: string, cursorPos: number) => {
    const match = getTagMatchBeforeCursor(value, cursorPos);
    dismissedTagMatchRef.current = match?.[0] ?? null;
    setTagDropdown(null);
    restoreTextareaFocus(textareaRef.current, cursorPos);
  };

  const closeTagSuggestions = (value: string, cursorPos: number) => {
    const match = getTagMatchBeforeCursor(value, cursorPos);
    dismissedTagMatchRef.current = match?.[0] ?? null;
    setTagDropdown(null);
  };

  const applyTagSuggestion = (tag: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;
    const before = content.slice(0, cursorPos);
    const match = before.match(/#([^\s#]*)$/);
    if (!match) return;
    const newContent = content.slice(0, cursorPos - match[0].length) + '#' + tag + ' ' + content.slice(cursorPos);
    setContent(newContent);
    setTagDropdown(null);
    dismissedTagMatchRef.current = null;
    recordRecentTag(tag);
    setTimeout(() => {
      const newPos = cursorPos - match[0].length + tag.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const uploadImage = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${getApiBase()}/api/uploads`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const payload = (await response.json()) as { url: string };
    setImages((prev) => [...prev, { url: payload.url, name: file.name }]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadImage(file);
        return;
      }
    }
  };

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
    if (!fullContent || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ content: fullContent, visibility, displayDate });
      setContent('');
      setVisibility('public');
      setDisplayDate(defaultDisplayDate);
      setImages([]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismissTagSuggestions(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
      return;
    }
    // Tag dropdown navigation
    if (tagDropdown) {
      const len = tagDropdown.suggestions.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setTagIndex((i) => (i + 1) % len); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setTagIndex((i) => (i - 1 + len) % len); return; }
      if (e.key === 'Enter') { e.preventDefault(); applyTagSuggestion(tagDropdown.suggestions[tagIndex]); return; }
    }
    // Format shortcuts: Ctrl/Cmd + B/I/U
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
    else if (e.key === 'i') { e.preventDefault(); wrapSelection('*', '*'); }
    else if (e.key === 'u') { e.preventDefault(); wrapSelection('<u>', '</u>'); }
  };

  useEffect(() => {
    if (!tagDropdown) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      const ta = textareaRef.current;
      if (!ta) return;
      dismissTagSuggestions(ta.value, ta.selectionStart ?? ta.value.length);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [tagDropdown]);

  return (
    <>
    <section style={{ ...styles.card, background: c.cardBg, borderColor: c.borderMedium }}>
      <div ref={editorWrapRef} style={styles.editorWrap}>
        <HighlightOverlay text={content} textColor={c.textPrimary} isDark={isDark} />
        <textarea
          ref={textareaRef}
          style={{ ...styles.textarea, caretColor: c.textPrimary }}
          placeholder="现在的想法是..."
          value={content}
          onBlur={(e) => {
            if (!tagDropdown) return;
            closeTagSuggestions(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
          }}
          onChange={(event) => {
            setContent(event.target.value);
            updateTagSuggestions(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyUp={(e) => {
            if (e.key === 'Escape') return;
            if (tagDropdown && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
            updateTagSuggestions(content, (e.target as HTMLTextAreaElement).selectionStart);
          }}
          onPaste={handlePaste}
          onKeyDown={handleEditorKeyDown}
          onCompositionEnd={(e) => { const ta = e.target as HTMLTextAreaElement; updateTagSuggestions(ta.value, ta.selectionStart); }}
          onScroll={(e) => {
            const overlay = (e.target as HTMLElement).previousElementSibling as HTMLElement;
            if (overlay) overlay.scrollTop = (e.target as HTMLElement).scrollTop;
            // update dropdown position on scroll
            updateTagSuggestions(content, textareaRef.current?.selectionStart ?? content.length);
          }}
        />
      </div>
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
      <div style={{ ...styles.toolbar, borderTopColor: c.borderLight }}>
        <div style={styles.toolsRow}>
          <button type="button" style={{ ...styles.fmtButton, color: '#3aa864', fontWeight: 700 }} title="添加标签" onClick={() => {
            const ta = textareaRef.current;
            if (!ta) return;
            const pos = ta.selectionStart;
            const before = content.slice(0, pos);
            const after = content.slice(pos);
            const prefix = pos > 0 && content[pos - 1] !== ' ' && content[pos - 1] !== '\n' ? ' #' : '#';
            setContent(before + prefix + after);
            setTimeout(() => { ta.focus(); ta.setSelectionRange(pos + prefix.length, pos + prefix.length); }, 0);
          }}>
            #
          </button>
          <span style={styles.fmtDivider} />
          <button type="button" style={styles.fmtButton} title="加粗" onClick={() => wrapSelection('**', '**')}>
            <strong>B</strong>
          </button>
          <button type="button" style={styles.fmtButton} title="斜体" onClick={() => wrapSelection('*', '*')}>
            <em>I</em>
          </button>
          <button type="button" style={styles.fmtButton} title="下划线" onClick={() => wrapSelection('<u>', '</u>')}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button type="button" style={styles.fmtButton} title="代码块" onClick={() => wrapSelection('```\n', '\n```')}>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>&lt;/&gt;</span>
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
              await uploadImage(file);
              input.value = '';
            }}
          />
          <label style={styles.selectWrap}>
            <select aria-label="可见性" value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')} style={{ ...styles.select, background: c.inputBg, color: c.textTertiary, borderColor: c.borderMedium }}>
              <option value="public">公开</option>
              <option value="private">私密</option>
            </select>
          </label>
          <input aria-label="归属日期" type="date" value={displayDate} onChange={(event) => setDisplayDate(event.target.value)} style={{ ...styles.dateInput, background: c.inputBg, color: c.textTertiary, borderColor: c.borderMedium }} />
        </div>
        <button type="button" style={{ ...styles.submitButton, ...(submitting ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} onClick={handleSubmit} disabled={submitting} title={submitting ? '发布中...' : '发布'}>
          {submitting ? <span style={{ fontSize: 12, color: '#fff' }}>...</span> : <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>}
        </button>
      </div>
    </section>
    {tagDropdown && createPortal(
      <div style={{ position: 'fixed', top: tagDropdown.top, left: tagDropdown.left, zIndex: 9999, background: isDark ? '#2a2a2a' : '#fff', border: `1px solid ${c.borderMedium}`, borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 160, maxWidth: 280, maxHeight: `${5 * 40}px`, overflowY: 'auto' }}>
        {tagDropdown.suggestions.map((tag, i) => (
          <button key={tag} type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); applyTagSuggestion(tag); }}
            onMouseEnter={() => setTagIndex(i)}
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: i === tagIndex ? (isDark ? '#333' : '#f0f0f0') : 'transparent', padding: '8px 14px', fontSize: 14, color: '#3aa864', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            #{tag}
          </button>
        ))}
      </div>,
      document.body,
    )}
    </>
  );
};

const sharedFont: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.6,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  letterSpacing: 'normal',
  wordSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e8e8e8',
    overflow: 'hidden',
    marginBottom: 16,
  },
  editorWrap: {
    position: 'relative',
  },
  highlightOverlay: {
    ...sharedFont,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: '16px 20px 8px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  textarea: {
    ...sharedFont,
    width: '100%',
    minHeight: 100,
    padding: '16px 20px 8px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    boxSizing: 'border-box',
    background: 'transparent',
    color: 'transparent',
    position: 'relative',
    zIndex: 1,
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
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 12px',
    borderTop: '1px solid #f5f5f5',
  },
  toolsRow: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
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
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    padding: '0 8px',
    background: '#fff',
    fontSize: 14,
    color: '#555',
    height: 32,
    boxSizing: 'border-box',
  },
  dateInput: {
    borderRadius: 8,
    border: '1px solid #e0e0e0',
    padding: '0 8px',
    background: '#fff',
    fontSize: 14,
    color: '#555',
    height: 32,
    boxSizing: 'border-box',
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
