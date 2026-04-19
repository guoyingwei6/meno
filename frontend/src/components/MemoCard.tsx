import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { getCaretCoords, getRecentTags, recordRecentTag } from '../lib/caret';
import { uploadFile } from '../lib/api';
import { extractMarkdownImageUrls, stripMarkdownImageSyntax, stripTagSyntax } from '../lib/content';
import type { MemoSummary } from '../types/shared';
import { useTheme, colors } from '../lib/theme';
import { getAiConfig, chatCompletionsUrl } from '../lib/ai-config';

interface MemoCardProps {
  memo: MemoSummary;
  isAuthor?: boolean;
  isTrash?: boolean;
  onOpen?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onSaveEdit?: (memo: MemoSummary, input: { content: string; visibility: 'public' | 'private'; displayDate: string }) => void;
  onRestore?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDelete?: (memo: MemoSummary) => void;
  allTags?: string[];
  onFillTags?: (id: number, newContent: string) => void;
  onPin?: (memo: MemoSummary) => void;
  onFavorite?: (memo: MemoSummary) => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const countWords = (text: string) => {
  const cleaned = text.replace(/!\[.*?\]\(.*?\)/g, '').replace(/[#*_~`>\-\[\]()]/g, '').trim();
  return cleaned.length;
};

const contentFontSize = 14;
const contentLineHeight = 1.7;
const collapsedContentLines = 6;
const collapsedContentMaxHeight = contentFontSize * contentLineHeight * collapsedContentLines + 8;

const areSuggestionsEqual = (prev: string[] | undefined, next: string[]) => {
  if (!prev) return false;
  return prev.length === next.length && prev.every((tag, index) => tag === next[index]);
};

const restoreTextareaFocus = (textarea: HTMLTextAreaElement | null, cursorPos: number) => {
  if (!textarea) return;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
};

const EditHighlightOverlay = ({ text, textColor, isDark }: { text: string; textColor: string; isDark: boolean }) => {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|#[^\s#]+)/g);
  const codeBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={editStyles.highlightOverlay} aria-hidden="true">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          return <span key={i} style={{ color: textColor, background: codeBg, borderRadius: 3 }}>{part}</span>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return <span key={i} style={{ color: textColor, background: codeBg, borderRadius: 3 }}>{part}</span>;
        }
        if (/^#[^\s#]+$/.test(part)) {
          return <span key={i} style={{ color: '#3aa864', fontWeight: 500 }}>{part}</span>;
        }
        return <span key={i} style={{ color: textColor }}>{part}</span>;
      })}
      <span>{'\n '}</span>
    </div>
  );
};

const VoiceNoteBlock = ({ voiceNote, isDark }: { voiceNote?: MemoSummary['voiceNote']; isDark: boolean }) => {
  if (!voiceNote) return null;

  return (
    <div style={{ ...styles.voiceBlock, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
      <audio controls preload="none" src={voiceNote.audioUrl} style={styles.voiceAudio} />
      {voiceNote.transcriptStatus !== 'done' ? <p style={styles.voicePending}>语音已保存，等待转写</p> : null}
    </div>
  );
};

export const MemoCard = ({ memo, isAuthor, isTrash, onOpen, onOpenTag, onSaveEdit, onRestore, onChangeVisibility, onDelete, allTags, onFillTags, onPin, onFavorite }: MemoCardProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [fillLoading, setFillLoading] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null);
  const [checkedTags, setCheckedTags] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('public');
  const [editDisplayDate, setEditDisplayDate] = useState('');
  const [editTagDropdown, setEditTagDropdown] = useState<{ suggestions: string[]; top: number; left: number } | null>(null);
  const [editTagIndex, setEditTagIndex] = useState(0);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);
  const dismissedEditTagMatchRef = useRef<string | null>(null);
  const imageUrls = extractMarkdownImageUrls(memo.content);
  const contentText = stripTagSyntax(stripMarkdownImageSyntax(memo.content));
  const isLong = contentText.length > 200;
  const wordCount = countWords(memo.content);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => i === null ? null : (i - 1 + imageUrls.length) % imageUrls.length);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => i === null ? null : (i + 1) % imageUrls.length);
      if (e.key === 'Escape') setLightboxIndex(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex, imageUrls.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2000);
  };

  const handleShare = () => {
    const url = `${window.location.origin}/memos/${memo.slug}`;
    navigator.clipboard.writeText(url);
    setMenuOpen(false);
    showToast('链接已复制');
  };

  const handleFillTags = async () => {
    const config = getAiConfig();
    if (!config) {
      setMenuOpen(false);
      showToast('请先配置 AI');
      return;
    }
    if (!allTags?.length) {
      setMenuOpen(false);
      showToast('暂无可用标签，请先创建标签');
      return;
    }
    setFillLoading(true);
    try {
      const resp = await fetch(chatCompletionsUrl(config.url), {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content: '你是标签推荐助手。只能从用户提供的标签列表中选择，不得新造标签。返回格式为 JSON 数组，如 ["tag1","tag2"]，不要包含其他内容。',
            },
            {
              role: 'user',
              content: `笔记内容：\n${memo.content}\n\n可用标签列表：${allTags.join(', ')}\n\n请从可用标签中选出适合此笔记的标签。`,
            },
          ],
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? '';
      let tags: string[] = [];
      try {
        tags = JSON.parse(raw);
      } catch {
        const match = raw.match(/\[[\s\S]*?\]/);
        if (match) tags = JSON.parse(match[0]);
        else throw new Error('AI 返回格式无法解析');
      }
      if (!Array.isArray(tags)) throw new Error('AI 返回格式无法解析');
      const newTags = tags.filter((t: string) => !memo.tags.includes(t));
      if (newTags.length === 0) {
        setMenuOpen(false);
        showToast('未找到新的匹配标签');
      } else {
        setMenuOpen(false);
        setSuggestedTags(newTags);
        setCheckedTags(newTags);
      }
    } catch (e) {
      showToast(`AI 调用失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setFillLoading(false);
    }
  };

  const handleApplyTags = () => {
    if (checkedTags.length === 0) { setSuggestedTags(null); return; }
    const newContent = checkedTags.map((t) => `#${t}`).join(' ') + '\n' + memo.content;
    onFillTags?.(memo.id, newContent);
    setSuggestedTags(null);
  };

  const isInsideCodeBlock = (text: string, pos: number): boolean => {
    const before = text.slice(0, pos);
    const fenced = (before.match(/```/g) || []).length;
    if (fenced % 2 === 1) return true;
    const withoutFenced = before.replace(/```[\s\S]*?```/g, '');
    const backticks = (withoutFenced.match(/`/g) || []).length;
    return backticks % 2 === 1;
  };

  const getEditTagMatch = (value: string, cursorPos: number) => {
    if (isInsideCodeBlock(value, cursorPos)) return null;
    return value.slice(0, cursorPos).match(/#([^\s#]*)$/);
  };

  const updateEditTagSuggestions = (value: string, cursorPos: number) => {
    const ta = editTextareaRef.current;
    const match = getEditTagMatch(value, cursorPos);
    if (!match || !ta) {
      dismissedEditTagMatchRef.current = null;
      setEditTagDropdown(null);
      return;
    }
    if (dismissedEditTagMatchRef.current === match[0]) {
      setEditTagDropdown(null);
      return;
    }
    dismissedEditTagMatchRef.current = null;
    const prefix = match[1];
    const recent = getRecentTags();
    const suggestions = (allTags ?? [])
      .filter((tag) => tag.startsWith(prefix) && tag !== prefix)
      .sort((a, b) => {
        const ia = recent.indexOf(a);
        const ib = recent.indexOf(b);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    if (!suggestions.length) {
      setEditTagDropdown(null);
      setEditTagIndex(0);
      return;
    }
    const coords = getCaretCoords(ta);
    setEditTagDropdown({ suggestions, ...coords });
    setEditTagIndex((current) => {
      if (areSuggestionsEqual(editTagDropdown?.suggestions, suggestions) && current < suggestions.length) return current;
      return 0;
    });
  };

  const applyEditTagSuggestion = (tag: string) => {
    const ta = editTextareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;
    const before = editContent.slice(0, cursorPos);
    const match = before.match(/#([^\s#]*)$/);
    if (!match) return;
    const newContent = editContent.slice(0, cursorPos - match[0].length) + '#' + tag + ' ' + editContent.slice(cursorPos);
    setEditContent(newContent);
    setEditTagDropdown(null);
    dismissedEditTagMatchRef.current = null;
    recordRecentTag(tag);
    setTimeout(() => {
      const newPos = cursorPos - match[0].length + tag.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const editWrapSelection = (before: string, after: string) => {
    const ta = editTextareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = editContent.slice(start, end);
    const wrapped = `${before}${selected || '文本'}${after}`;
    const next = editContent.slice(0, start) + wrapped + editContent.slice(end);
    setEditContent(next);
    setTimeout(() => {
      ta.focus();
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + (selected || '文本').length;
      ta.setSelectionRange(cursorStart, cursorEnd);
    }, 0);
  };

  const editInsertLinePrefix = (prefix: string) => {
    const ta = editTextareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = editContent.lastIndexOf('\n', start - 1) + 1;
    const next = editContent.slice(0, lineStart) + prefix + editContent.slice(lineStart);
    setEditContent(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    }, 0);
  };

  const startEditing = () => {
    setMenuOpen(false);
    setEditContent(
      stripMarkdownImageSyntax(memo.content)
        .replace(/\n+---+\n+\*\*附件[：:]\*\*\n*/g, '\n')
        .replace(/\n+---+\s*$/g, '')
        .trim(),
    );
    setEditImages(extractMarkdownImageUrls(memo.content));
    setEditVisibility(memo.visibility);
    setEditDisplayDate(memo.displayDate);
    setEditTagDropdown(null);
    setEditTagIndex(0);
    dismissedEditTagMatchRef.current = null;
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditTagDropdown(null);
    dismissedEditTagMatchRef.current = null;
  };

  const handleSaveEdit = () => {
    const textPart = editContent.trim();
    const imagePart = editImages.map((url) => `![](${url})`).join('\n');
    const fullContent = [textPart, imagePart].filter(Boolean).join('\n');
    if (!fullContent) return;
    onSaveEdit?.(memo, { content: fullContent, visibility: editVisibility, displayDate: editDisplayDate });
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      if (editTagDropdown) {
        e.preventDefault();
        const cursorPos = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
        const match = getEditTagMatch(e.currentTarget.value, cursorPos);
        dismissedEditTagMatchRef.current = match?.[0] ?? null;
        setEditTagDropdown(null);
        restoreTextareaFocus(editTextareaRef.current, cursorPos);
        return;
      }
      cancelEditing();
      return;
    }
    if (editTagDropdown) {
      const len = editTagDropdown.suggestions.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setEditTagIndex((i) => (i + 1) % len); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setEditTagIndex((i) => (i - 1 + len) % len); return; }
      if (e.key === 'Enter') { e.preventDefault(); applyEditTagSuggestion(editTagDropdown.suggestions[editTagIndex]); return; }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
    else if (e.key === 'b') { e.preventDefault(); editWrapSelection('**', '**'); }
    else if (e.key === 'i') { e.preventDefault(); editWrapSelection('*', '*'); }
    else if (e.key === 'u') { e.preventDefault(); editWrapSelection('<u>', '</u>'); }
  };

  const handleEditUploadImage = async (file: File) => {
    try {
      const { url } = await uploadFile(file);
      setEditImages((prev) => [...prev, url]);
    } catch (error) {
      showToast(`图片上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  useEffect(() => {
    if (!editTagDropdown) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      const ta = editTextareaRef.current;
      if (!ta) return;
      const cursorPos = ta.selectionStart ?? ta.value.length;
      const match = getEditTagMatch(ta.value, cursorPos);
      dismissedEditTagMatchRef.current = match?.[0] ?? null;
      setEditTagDropdown(null);
      restoreTextareaFocus(ta, cursorPos);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editTagDropdown, editContent]);

  if (editing) {
    const editWordCount = countWords([editContent.trim(), editImages.map((url) => `![](${url})`).join('\n')].filter(Boolean).join('\n'));

    return (
      <>
        <article style={{ ...styles.card, background: c.cardBg, borderColor: c.accent }}>
          <div style={styles.header}>
            <span style={{ ...styles.date, color: c.textMuted }}>编辑 Memo</span>
          </div>
          <div style={editStyles.editorWrap}>
            <EditHighlightOverlay text={editContent} textColor={c.textPrimary} isDark={isDark} />
            <textarea
              ref={editTextareaRef}
              autoFocus
              style={{ ...editStyles.textarea, caretColor: c.textPrimary }}
              value={editContent}
              onBlur={(e) => {
                if (!editTagDropdown) return;
                const cursorPos = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
                const match = getEditTagMatch(e.currentTarget.value, cursorPos);
                dismissedEditTagMatchRef.current = match?.[0] ?? null;
                setEditTagDropdown(null);
              }}
              onChange={(e) => {
                setEditContent(e.target.value);
                updateEditTagSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={handleEditKeyDown}
              onKeyUp={(e) => {
                if (e.key === 'Escape') return;
                if (editTagDropdown && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
                updateEditTagSuggestions(editContent, (e.target as HTMLTextAreaElement).selectionStart);
              }}
              onCompositionEnd={(e) => {
                const ta = e.target as HTMLTextAreaElement;
                updateEditTagSuggestions(ta.value, ta.selectionStart);
              }}
              onScroll={(e) => {
                const overlay = (e.target as HTMLElement).previousElementSibling as HTMLElement;
                if (overlay) overlay.scrollTop = (e.target as HTMLElement).scrollTop;
                updateEditTagSuggestions(editContent, editTextareaRef.current?.selectionStart ?? editContent.length);
              }}
            />
          </div>
          {editImages.length > 0 ? (
            <div style={editStyles.imageGrid}>
              {editImages.map((url, index) => (
                <div key={`${url}-${index}`} style={editStyles.imageWrap}>
                  <img src={url} alt="" style={editStyles.imageThumb} />
                  <button type="button" aria-label="删除图片" style={editStyles.imageRemove} onClick={() => setEditImages((prev) => prev.filter((_, i) => i !== index))}>✕</button>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ ...editStyles.toolbar, borderTopColor: c.borderLight }}>
            <div style={editStyles.toolsRow}>
              <button
                type="button"
                style={{ ...editStyles.fmtButton, color: '#3aa864', fontWeight: 700 }}
                title="添加标签"
                onClick={() => {
                  const ta = editTextareaRef.current;
                  if (!ta) return;
                  const pos = ta.selectionStart;
                  const prefix = pos > 0 && editContent[pos - 1] !== ' ' && editContent[pos - 1] !== '\n' ? ' #' : '#';
                  const next = editContent.slice(0, pos) + prefix + editContent.slice(pos);
                  setEditContent(next);
                  setTimeout(() => {
                    ta.focus();
                    ta.setSelectionRange(pos + prefix.length, pos + prefix.length);
                  }, 0);
                }}
              >
                #
              </button>
              <button type="button" style={{ ...editStyles.fmtButton, padding: 4 }} title="上传图片" onClick={() => editFileInputRef.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
              </button>
              <input
                ref={editFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  await handleEditUploadImage(file);
                  e.currentTarget.value = '';
                }}
              />
              <span style={editStyles.fmtDivider} />
              <button type="button" style={editStyles.fmtButton} title="加粗" onClick={() => editWrapSelection('**', '**')}><strong>B</strong></button>
              <button type="button" style={editStyles.fmtButton} title="斜体" onClick={() => editWrapSelection('*', '*')}><em>I</em></button>
              <button type="button" style={editStyles.fmtButton} title="下划线" onClick={() => editWrapSelection('<u>', '</u>')}><span style={{ textDecoration: 'underline' }}>U</span></button>
              <button type="button" style={editStyles.fmtButton} title="代码块" onClick={() => editWrapSelection('```\n', '\n```')}><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>&lt;/&gt;</span></button>
              <span style={editStyles.fmtDivider} />
              <button type="button" style={editStyles.fmtButton} title="无序列表" onClick={() => editInsertLinePrefix('- ')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="#666"/><circle cx="4" cy="12" r="1" fill="#666"/><circle cx="4" cy="18" r="1" fill="#666"/></svg>
              </button>
              <button type="button" style={editStyles.fmtButton} title="有序列表" onClick={() => editInsertLinePrefix('1. ')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">1</text><text x="2" y="14" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">2</text><text x="2" y="20" fill="#666" stroke="none" fontSize="8" fontFamily="sans-serif">3</text></svg>
              </button>
            </div>
            <div style={editStyles.actionsRow}>
              <span style={{ ...styles.footerText, color: c.textMuted }}>字数: {editWordCount}</span>
              <label style={editStyles.selectWrap}>
                <select value={editVisibility} onChange={(e) => setEditVisibility(e.target.value as 'public' | 'private')} style={{ ...editStyles.select, background: c.inputBg, color: c.textTertiary, borderColor: c.borderMedium }}>
                  <option value="public">公开</option>
                  <option value="private">私密</option>
                </select>
              </label>
              <input type="date" value={editDisplayDate} onChange={(e) => setEditDisplayDate(e.target.value)} style={{ ...editStyles.select, background: c.inputBg, color: c.textTertiary, borderColor: c.borderMedium }} />
              <button type="button" style={{ ...editStyles.cancelButton, borderColor: c.borderMedium, background: c.cardBg, color: c.textPrimary }} onClick={cancelEditing}>取消</button>
              <button type="button" style={editStyles.saveButton} onClick={handleSaveEdit} aria-label="保存编辑" title="保存编辑">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              </button>
            </div>
          </div>
          {toastMsg ? <div style={{ ...styles.footer, borderTopColor: c.border, marginTop: 0 }}><span style={styles.copiedHint}>{toastMsg}</span></div> : null}
        </article>
        {editTagDropdown && typeof document !== 'undefined' ? createPortal(
          <div style={{ position: 'fixed', top: editTagDropdown.top, left: editTagDropdown.left, zIndex: 9999, background: isDark ? '#2a2a2a' : '#fff', border: `1px solid ${c.borderMedium}`, borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', minWidth: 160, maxWidth: 280, maxHeight: `${5 * 40}px`, overflowY: 'auto' }}>
            {editTagDropdown.suggestions.map((tag, i) => (
              <button key={tag} type="button" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); applyEditTagSuggestion(tag); }} onMouseEnter={() => setEditTagIndex(i)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: i === editTagIndex ? (isDark ? '#333' : '#f0f0f0') : 'transparent', padding: '8px 14px', fontSize: 14, color: '#3aa864', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                #{tag}
              </button>
            ))}
          </div>,
          document.body,
        ) : null}
      </>
    );
  }

  return (
    <article style={{ ...styles.card, background: c.cardBg, borderColor: c.border }}>
      <div style={styles.header}>
        <span style={{ ...styles.date, color: c.textMuted }}>{memo.pinnedAt && '📌 '}{memo.favoritedAt && isAuthor && <span style={{ color: '#f0c040' }}>⭐ </span>}{memo.displayDate}</span>
        <div style={styles.headerRight}>
          {toastMsg ? <span style={styles.copiedHint}>{toastMsg}</span> : null}
          <div ref={menuRef} style={styles.menuWrap}>
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
                    <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label={memo.pinnedAt ? '取消置顶' : '置顶'} onClick={() => { setMenuOpen(false); onPin?.(memo); }}>{memo.pinnedAt ? '取消置顶' : '置顶'}</button>
                    <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label={memo.favoritedAt ? '取消收藏' : '收藏'} onClick={() => { setMenuOpen(false); onFavorite?.(memo); }}>{memo.favoritedAt ? '取消收藏' : '收藏'}</button>
                    <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="编辑" onClick={startEditing}>编辑</button>
                    <button
                      type="button"
                      style={{ ...styles.menuItem, color: fillLoading ? c.textMuted : '#3aa864' }}
                      aria-label={fillLoading ? '分析中...' : '填充标签（AI）'}
                      disabled={fillLoading}
                      onClick={handleFillTags}
                    >
                      {fillLoading ? '分析中...' : '填充标签（AI）'}
                    </button>
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
      <div style={isLong && !expanded ? { ...styles.content, color: c.textSecondary, maxHeight: collapsedContentMaxHeight, overflow: 'hidden' } : { ...styles.content, color: c.textSecondary }}>
        <VoiceNoteBlock voiceNote={memo.voiceNote} isDark={isDark} />
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={{
            p: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{children}</p>,
            ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
            li: ({ children }) => <li style={{ lineHeight: 1.7 }}>{children}</li>,
            h1: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h2: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h3: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h4: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h5: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h6: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            pre: ({ children }) => <pre style={{ margin: '0 0 8px', padding: 12, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre', fontSize: 13, lineHeight: 1.5 }}>{children}</pre>,
            code: ({ children, className }) => className
              ? <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', fontSize: 13 }}>{children}</code>
              : <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', fontSize: 13, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: '2px 5px', borderRadius: 3 }}>{children}</code>,
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
        <div
          style={styles.lightbox}
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).dataset.touchX = String(e.touches[0].clientX); }}
          onTouchEnd={(e) => {
            const startX = Number((e.currentTarget as HTMLElement).dataset.touchX ?? 0);
            const diff = e.changedTouches[0].clientX - startX;
            if (Math.abs(diff) < 40) return;
            e.stopPropagation();
            setLightboxIndex((i) => i === null ? null : diff < 0
              ? (i + 1) % imageUrls.length
              : (i - 1 + imageUrls.length) % imageUrls.length);
          }}
        >
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
      {suggestedTags !== null ? (
        <div style={styles.lightbox} onClick={() => setSuggestedTags(null)}>
          <div
            style={{ ...styles.confirmModal, background: c.cardBg }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: c.textPrimary }}>AI 建议添加以下标签</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {suggestedTags.map((tag) => (
                <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: c.textPrimary }}>
                  <input
                    type="checkbox"
                    aria-label={`#${tag}`}
                    checked={checkedTags.includes(tag)}
                    onChange={(e) => {
                      setCheckedTags((prev) =>
                        e.target.checked ? [...prev, tag] : prev.filter((t) => t !== tag),
                      );
                    }}
                  />
                  <span style={{ color: '#3aa864', fontWeight: 500 }}>#{tag}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSuggestedTags(null)}
                style={{ border: `1px solid ${c.borderMedium}`, background: c.cardBg, color: c.textPrimary, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>
                取消
              </button>
              <button type="button" aria-label="应用" onClick={handleApplyTags}
                style={{ border: 'none', background: '#3aa864', color: '#fff', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                应用
              </button>
            </div>
          </div>
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
    fontSize: contentFontSize,
    wordBreak: 'break-word',
  },
  voiceBlock: {
    marginBottom: 14,
    padding: '12px 14px',
    borderRadius: 12,
  },
  voiceAudio: {
    width: '100%',
    minWidth: 0,
    display: 'block',
  },
  voicePending: {
    margin: '10px 0 0',
    fontSize: 13,
    lineHeight: 1.6,
    color: '#8a8a8a',
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
  confirmModal: {
    borderRadius: 12,
    padding: 24,
    minWidth: 260,
    maxWidth: 340,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    cursor: 'default',
  },
};

const sharedEditFont: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.6,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  letterSpacing: 'normal',
  wordSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const editStyles: Record<string, React.CSSProperties> = {
  editorWrap: {
    position: 'relative',
  },
  highlightOverlay: {
    ...sharedEditFont,
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
    ...sharedEditFont,
    width: '100%',
    minHeight: 140,
    padding: '16px 20px 8px',
    border: 'none',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
    background: 'transparent',
    color: 'transparent',
    position: 'relative',
    zIndex: 1,
  },
  imageGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    padding: '4px 20px 8px',
  },
  imageWrap: {
    position: 'relative',
    width: 80,
    height: 80,
  },
  imageThumb: {
    width: 80,
    height: 80,
    objectFit: 'cover',
    borderRadius: 8,
    background: '#f5f5f5',
  },
  imageRemove: {
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
    flexDirection: 'column',
    gap: 10,
    padding: '8px 12px 12px',
    borderTop: '1px solid #f5f5f5',
  },
  toolsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
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
  cancelButton: {
    border: '1px solid #e0e0e0',
    borderRadius: 8,
    padding: '0 14px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    height: 32,
  },
  saveButton: {
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
