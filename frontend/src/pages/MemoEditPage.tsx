import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAuthorMemo, fetchDashboardTags, fetchMe, updateMemo } from '../lib/api';
import { getCaretCoords, getRecentTags, recordRecentTag } from '../lib/caret';
import { extractMarkdownImageUrls, stripMarkdownImageSyntax } from '../lib/content';
import { useTheme, colors } from '../lib/theme';

const getApiBase = () => (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ || '';

/** Tag highlight overlay — sits behind the transparent textarea */
const HighlightOverlay = ({ text, textColor, isDark }: { text: string; textColor: string; isDark: boolean }) => {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|#[^\s#]+)/g);
  const codeBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={overlayStyle} aria-hidden="true">
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

export const MemoEditPage = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const c = colors(isDark);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const dismissedTagMatchRef = useRef<string | null>(null);

  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const isAuthor = me?.authenticated && me.role === 'author';

  const { data, isLoading } = useQuery({
    queryKey: ['author-memo', slug],
    queryFn: () => fetchAuthorMemo(slug),
    enabled: Boolean(slug) && !meLoading && Boolean(isAuthor),
  });

  const memo = data?.memo;

  const { data: tagsData } = useQuery({
    queryKey: ['dashboard-tags'],
    queryFn: fetchDashboardTags,
    enabled: Boolean(isAuthor),
  });
  const existingTags: string[] = (tagsData?.tags ?? []).map((t: { tag: string }) => t.tag);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[] | null>(null);
  const [visibility, setVisibility] = useState<string | null>(null);
  const [displayDate, setDisplayDate] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [tagDropdown, setTagDropdown] = useState<{ suggestions: string[]; top: number; left: number } | null>(null);
  const [tagIndex, setTagIndex] = useState(0);

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
    const before = (textContent ?? '').slice(0, cursorPos);
    const match = before.match(/#([^\s#]*)$/);
    if (!match) return;
    const current = textContent ?? '';
    const newContent = current.slice(0, cursorPos - match[0].length) + '#' + tag + ' ' + current.slice(cursorPos);
    setTextContent(newContent);
    setTagDropdown(null);
    dismissedTagMatchRef.current = null;
    recordRecentTag(tag);
    setTimeout(() => {
      const newPos = cursorPos - match[0].length + tag.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    }, 0);
  };

  useEffect(() => {
    if (memo && textContent === null) {
      const urls = extractMarkdownImageUrls(memo.content);
      const text = stripMarkdownImageSyntax(memo.content)
        .replace(/\n+---+\n+\*\*附件[：:]\*\*\n*/g, '\n')
        .replace(/\n+---+\s*$/g, '')
        .trim();
      setTextContent(text);
      setImageUrls(urls);
    }
  }, [memo, textContent]);

  const editText = textContent ?? '';
  const editImages = imageUrls ?? [];

  useEffect(() => {
    if (lightboxIndex === null || editImages.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => i === null ? null : (i - 1 + editImages.length) % editImages.length);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => i === null ? null : (i + 1) % editImages.length);
      if (e.key === 'Escape') setLightboxIndex(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex, editImages.length]);

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
  const editVisibility = (visibility ?? memo?.visibility ?? 'public') as 'public' | 'private';
  const editDisplayDate = displayDate ?? memo?.displayDate ?? '';

  // ── Editor helpers ──────────────────────────────────────────────

  const wrapSelection = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = editText.slice(start, end);
    const wrapped = `${before}${selected || '文本'}${after}`;
    const next = editText.slice(0, start) + wrapped + editText.slice(end);
    setTextContent(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + (selected || '文本').length);
    }, 0);
  };

  const insertLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = editText.lastIndexOf('\n', start - 1) + 1;
    const next = editText.slice(0, lineStart) + prefix + editText.slice(lineStart);
    setTextContent(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + prefix.length, start + prefix.length); }, 0);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadImage = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${getApiBase()}/api/uploads`, { method: 'POST', credentials: 'include', body: form });
    const { url } = await res.json() as { url: string };
    setImageUrls((prev) => [...(prev ?? []), url]);
  };

  // ── Save ────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: () => {
      const imgPart = editImages.map((url) => `![](${url})`).join('\n');
      const fullContent = [editText.trim(), imgPart].filter(Boolean).join('\n');
      return updateMemo(memo!.id, { content: fullContent, visibility: editVisibility, displayDate: editDisplayDate });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['author-memo', slug] });
      navigate(`/memos/${slug}`);
    },
  });

  if (isLoading || meLoading) return <div style={{ padding: 32 }}>Loading...</div>;
  if (!isAuthor) return <div style={{ padding: 32 }}>无权限编辑</div>;
  if (!memo) return <div style={{ padding: 32 }}>Memo not found</div>;

  // ── Styles ──────────────────────────────────────────────────────

  const sharedFont: React.CSSProperties = {
    fontSize: 15, lineHeight: 1.6,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    letterSpacing: 'normal', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  };

  return (
    <>
    <div style={{ padding: 32, maxWidth: 880, margin: '0 auto', color: c.textPrimary }}>
      <h2 style={{ marginBottom: 16 }}>编辑 Memo</h2>

      {/* Editor card */}
      <div style={{ background: c.cardBg, borderRadius: 12, border: `1px solid ${c.borderMedium}`, overflow: 'hidden', marginBottom: 16 }}>

        {/* Textarea + overlay */}
        <div ref={editorWrapRef} style={{ position: 'relative' }}>
          <HighlightOverlay text={editText} textColor={c.textPrimary} isDark={isDark} />
          <textarea
            ref={textareaRef}
            style={{
              ...sharedFont,
              width: '100%', minHeight: 400, padding: '16px 20px 8px',
              border: 'none', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              background: 'transparent', color: 'transparent', caretColor: c.textPrimary,
              position: 'relative', zIndex: 1,
            }}
            value={editText}
            onChange={(e) => { setTextContent(e.target.value); updateTagSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
            onBlur={(e) => {
              if (!tagDropdown) return;
              closeTagSuggestions(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                dismissTagSuggestions(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
                return;
              }
              if (tagDropdown) {
                const len = tagDropdown.suggestions.length;
                if (e.key === 'ArrowDown') { e.preventDefault(); setTagIndex((i) => (i + 1) % len); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setTagIndex((i) => (i - 1 + len) % len); return; }
                if (e.key === 'Enter') { e.preventDefault(); applyTagSuggestion(tagDropdown.suggestions[tagIndex]); return; }
              }
            }}
            onKeyUp={(e) => {
              if (e.key === 'Escape') return;
              if (tagDropdown && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
              updateTagSuggestions(textContent ?? '', (e.target as HTMLTextAreaElement).selectionStart);
            }}
            onCompositionEnd={(e) => { const ta = e.target as HTMLTextAreaElement; updateTagSuggestions(ta.value, ta.selectionStart); }}
            onScroll={(e) => {
              const overlay = (e.target as HTMLElement).previousElementSibling as HTMLElement;
              if (overlay) overlay.scrollTop = (e.target as HTMLElement).scrollTop;
              updateTagSuggestions(textContent ?? '', textareaRef.current?.selectionStart ?? 0);
            }}
          />
        </div>

        {/* Image thumbnails */}
        {editImages.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 20px 8px' }}>
            {editImages.map((url, i) => (
              <div key={url} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', background: '#f5f5f5', display: 'block' }}
                  onClick={() => setLightboxIndex(i)} />
                <button type="button" title="删除图片"
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  onClick={() => setImageUrls((prev) => (prev ?? []).filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderTop: `1px solid ${c.borderLight}` }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
            {/* Tag */}
            <button type="button" style={{ ...toolBtn, color: '#3aa864', fontWeight: 700 }} title="添加标签" onClick={() => {
              const ta = textareaRef.current;
              if (!ta) return;
              const pos = ta.selectionStart;
              const prefix = pos > 0 && editText[pos - 1] !== ' ' && editText[pos - 1] !== '\n' ? ' #' : '#';
              const next = editText.slice(0, pos) + prefix + editText.slice(pos);
              setTextContent(next);
              setTimeout(() => { ta.focus(); ta.setSelectionRange(pos + prefix.length, pos + prefix.length); }, 0);
            }}>#</button>
            <span style={divider} />
            <button type="button" style={toolBtn} title="加粗" onClick={() => wrapSelection('**', '**')}><strong>B</strong></button>
            <button type="button" style={toolBtn} title="斜体" onClick={() => wrapSelection('*', '*')}><em>I</em></button>
            <button type="button" style={toolBtn} title="下划线" onClick={() => wrapSelection('<u>', '</u>')}><span style={{ textDecoration: 'underline' }}>U</span></button>
            <span style={divider} />
            <button type="button" style={toolBtn} title="无序列表" onClick={() => insertLinePrefix('- ')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="#666"/><circle cx="4" cy="12" r="1" fill="#666"/><circle cx="4" cy="18" r="1" fill="#666"/></svg>
            </button>
            <button type="button" style={toolBtn} title="有序列表" onClick={() => insertLinePrefix('1. ')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">1</text><text x="2" y="14" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">2</text><text x="2" y="20" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">3</text></svg>
            </button>
            <span style={divider} />
            {/* Image upload */}
            <button type="button" style={{ ...toolBtn, padding: 4 }} title="上传图片" onClick={() => fileInputRef.current?.click()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) { await handleUploadImage(file); e.target.value = ''; }
              }} />
            <span style={divider} />
            {/* Visibility */}
            <select value={editVisibility} onChange={(e) => setVisibility(e.target.value)}
              style={{ borderRadius: 8, border: `1px solid ${c.borderMedium}`, padding: '0 8px', background: c.cardBg, color: c.textTertiary, fontSize: 14, height: 32, boxSizing: 'border-box' }}>
              <option value="public">公开</option>
              <option value="private">私密</option>
            </select>
            {/* Date */}
            <input type="date" value={editDisplayDate} onChange={(e) => setDisplayDate(e.target.value)}
              style={{ borderRadius: 8, border: `1px solid ${c.borderMedium}`, padding: '0 8px', background: c.cardBg, color: c.textTertiary, fontSize: 14, height: 32, boxSizing: 'border-box' }} />
          </div>
          {/* Save button */}
          <button type="button" disabled={mutation.isPending}
            style={{ border: 'none', borderRadius: 8, padding: '6px 18px', background: '#31d266', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14, height: 36, flexShrink: 0 }}
            onClick={() => mutation.mutate()}>
            {mutation.isPending ? '保存中…' : '保存'}
          </button>
          <button type="button"
            style={{ border: `1px solid ${c.borderMedium}`, borderRadius: 8, padding: '6px 14px', background: c.cardBg, color: c.textPrimary, cursor: 'pointer', fontSize: 14, height: 36, flexShrink: 0 }}
            onClick={() => navigate(`/memos/${slug}`)}>
            取消
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out' }}
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).dataset.touchX = String(e.touches[0].clientX); }}
          onTouchEnd={(e) => {
            const startX = Number((e.currentTarget as HTMLElement).dataset.touchX ?? 0);
            const diff = e.changedTouches[0].clientX - startX;
            if (Math.abs(diff) < 40) return;
            e.stopPropagation();
            setLightboxIndex((i) => i === null ? null : diff < 0
              ? (i + 1) % editImages.length
              : (i - 1 + editImages.length) % editImages.length);
          }}
        >
          {editImages.length > 1 && (
            <button type="button" style={arrowStyle('left')}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + editImages.length) % editImages.length); }}>‹</button>
          )}
          <img src={editImages[lightboxIndex]} alt="" style={{ maxWidth: '80vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain', cursor: 'default' }} onClick={(e) => e.stopPropagation()} />
          {editImages.length > 1 && (
            <button type="button" style={arrowStyle('right')}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % editImages.length); }}>›</button>
          )}
          {editImages.length > 1 && (
            <span style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontSize: 13, background: 'rgba(0,0,0,0.4)', padding: '3px 10px', borderRadius: 12 }}>
              {lightboxIndex + 1} / {editImages.length}
            </span>
          )}
        </div>
      )}
    </div>
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

// ── Static styles ────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  fontSize: 15, lineHeight: 1.6,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  padding: '16px 20px 8px', boxSizing: 'border-box',
  overflow: 'hidden', pointerEvents: 'none',
};

const toolBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  padding: '4px 6px', fontSize: 14, color: '#666', borderRadius: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 28,
};

const divider: React.CSSProperties = {
  width: 1, height: 16, background: '#e0e0e0', margin: '0 2px', flexShrink: 0,
};

const arrowStyle = (side: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute', [side]: 16,
  background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
  fontSize: 40, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
});
