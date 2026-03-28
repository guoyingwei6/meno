import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAuthorMemo, fetchMe, updateMemo } from '../lib/api';
import { extractMarkdownImageUrls, stripMarkdownImageSyntax } from '../lib/content';
import { useTheme, colors } from '../lib/theme';

export const MemoEditPage = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const c = colors(isDark);

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
  });
  const isAuthor = me?.authenticated && me.role === 'author';

  const { data, isLoading } = useQuery({
    queryKey: ['author-memo', slug],
    queryFn: () => fetchAuthorMemo(slug),
    enabled: Boolean(slug) && !meLoading && Boolean(isAuthor),
  });

  const memo = data?.memo;

  // Separate text content and image URLs
  const [textContent, setTextContent] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[] | null>(null);
  const [visibility, setVisibility] = useState<string | null>(null);
  const [displayDate, setDisplayDate] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Initialize text + images from memo content (runs once when memo loads)
  useEffect(() => {
    if (memo && textContent === null) {
      const urls = extractMarkdownImageUrls(memo.content);
      const text = stripMarkdownImageSyntax(memo.content)
        // Remove flomo attachment block: ---\n**附件：** (with any number of surrounding newlines)
        .replace(/\n+---+\n+\*\*附件[：:]\*\*\n*/g, '\n')
        // Remove trailing --- separator
        .replace(/\n+---+\s*$/g, '')
        .trim();
      setTextContent(text);
      setImageUrls(urls);
    }
  }, [memo, textContent]);

  const editText = textContent ?? '';
  const editImages = imageUrls ?? [];
  const editVisibility = (visibility ?? memo?.visibility ?? 'public') as 'public' | 'private' | 'draft';
  const editDisplayDate = displayDate ?? memo?.displayDate ?? '';

  const mutation = useMutation({
    mutationFn: () => {
      // Reassemble: text + image markdown at the end
      const imgPart = editImages.map((url) => `![](${url})`).join('\n');
      const fullContent = [editText.trim(), imgPart].filter(Boolean).join('\n');
      return updateMemo(memo!.id, {
        content: fullContent,
        visibility: editVisibility,
        displayDate: editDisplayDate,
      });
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

  const pageBg: React.CSSProperties = { padding: 32, maxWidth: 880, margin: '0 auto', color: c.textPrimary };
  const textareaStyle: React.CSSProperties = {
    width: '100%', minHeight: 400, padding: 16, borderRadius: 12,
    border: `1px solid ${c.borderMedium}`, fontSize: 15, lineHeight: 1.6,
    boxSizing: 'border-box', resize: 'vertical',
    background: c.cardBg, color: c.textPrimary,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  return (
    <div style={pageBg}>
      <h2 style={{ marginBottom: 16 }}>编辑 Memo</h2>

      <textarea
        style={textareaStyle}
        value={editText}
        onChange={(e) => setTextContent(e.target.value)}
      />

      {/* Image thumbnails */}
      {editImages.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {editImages.map((url, i) => (
            <div key={url} style={{ position: 'relative' }}>
              <img
                src={url}
                alt=""
                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', background: '#f5f5f5', display: 'block' }}
                onClick={() => setLightboxIndex(i)}
              />
              <button
                type="button"
                title="删除图片"
                style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onClick={() => setImageUrls((prev) => (prev ?? []).filter((_, idx) => idx !== i))}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: c.textSecondary }}>可见性</span>
          <select value={editVisibility} onChange={(e) => setVisibility(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.borderMedium}`, background: c.cardBg, color: c.textPrimary }}>
            <option value="public">公开</option>
            <option value="private">私密</option>
            <option value="draft">草稿</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: c.textSecondary }}>归属日期</span>
          <input type="date" value={editDisplayDate} onChange={(e) => setDisplayDate(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${c.borderMedium}`, background: c.cardBg, color: c.textPrimary }} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button
          type="button"
          style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: '#31d266', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? '保存中...' : '保存'}
        </button>
        <button
          type="button"
          style={{ padding: '10px 20px', borderRadius: 12, border: `1px solid ${c.borderMedium}`, background: c.cardBg, color: c.textPrimary, cursor: 'pointer' }}
          onClick={() => navigate(`/memos/${slug}`)}
        >
          取消
        </button>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out' }}
          onClick={() => setLightboxIndex(null)}
        >
          {editImages.length > 1 && (
            <button type="button"
              style={{ position: 'absolute', left: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 40, padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + editImages.length) % editImages.length); }}
            >‹</button>
          )}
          <img src={editImages[lightboxIndex]} alt="" style={{ maxWidth: '80vw', maxHeight: '85vh', borderRadius: 8, objectFit: 'contain', cursor: 'default' }} onClick={(e) => e.stopPropagation()} />
          {editImages.length > 1 && (
            <button type="button"
              style={{ position: 'absolute', right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: 40, padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % editImages.length); }}
            >›</button>
          )}
          {editImages.length > 1 && (
            <span style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontSize: 13, background: 'rgba(0,0,0,0.4)', padding: '3px 10px', borderRadius: 12 }}>
              {lightboxIndex + 1} / {editImages.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
