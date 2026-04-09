import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAuthorMemo, fetchMe, fetchPublicMemo, pinMemo as pinMemoApi, unpinMemo as unpinMemoApi } from '../lib/api';
import { stripTagSyntax } from '../lib/content';
import { useTheme, colors } from '../lib/theme';

export const MemoDetailPage = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const c = colors(isDark);
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
  });
  const isAuthor = me?.authenticated && me.role === 'author';
  const { data, isLoading } = useQuery({
    queryKey: [isAuthor ? 'author-memo' : 'public-memo', slug],
    queryFn: () => (isAuthor ? fetchAuthorMemo(slug) : fetchPublicMemo(slug)),
    enabled: Boolean(slug) && !meLoading,
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => pinMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [isAuthor ? 'author-memo' : 'public-memo', slug] }); },
  });
  const unpinMutation = useMutation({
    mutationFn: (id: number) => unpinMemoApi(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [isAuthor ? 'author-memo' : 'public-memo', slug] }); },
  });

  if (isLoading || meLoading) {
    return <div style={{ padding: 32, color: c.textMuted }}>Loading...</div>;
  }

  if (!data?.memo) {
    return <div style={{ padding: 32, color: c.textMuted }}>Memo not found</div>;
  }

  return (
    <article style={{ padding: '24px 28px', maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        {isAuthor ? (
          <button type="button" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: c.textMuted, fontSize: 14, padding: 0 }} onClick={() => navigate('/')}>← 返回</button>
        ) : null}
        {isAuthor ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" style={{ border: `1px solid ${c.borderMedium}`, background: c.cardBg, borderRadius: 6, padding: '5px 12px', fontSize: 13, color: c.textTertiary, cursor: 'pointer' }} onClick={() => data.memo.pinnedAt ? unpinMutation.mutate(data.memo.id) : pinMutation.mutate(data.memo.id)}>
              {data.memo.pinnedAt ? '取消置顶' : '置顶'}
            </button>
            <button type="button" style={{ border: `1px solid ${c.borderMedium}`, background: c.cardBg, borderRadius: 6, padding: '5px 12px', fontSize: 13, color: c.textTertiary, cursor: 'pointer' }} onClick={() => navigate(`/memos/${slug}/edit`)}>编辑</button>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {data.memo.pinnedAt && <span style={{ color: c.textMuted, fontSize: 13 }}>📌 已置顶</span>}
        {isAuthor && data.memo.favoritedAt && <span style={{ color: '#f0c040', fontSize: 13 }}>⭐ 已收藏</span>}
        {data.memo.tags.map((tag) => (
          <span key={tag} style={{ color: c.tagColor, fontSize: 14, fontWeight: 500 }}>#{tag}</span>
        ))}
      </div>
      <div style={{ borderRadius: 12, background: c.cardBg, border: `1px solid ${c.border}`, padding: '16px 20px' }}>
        <ReactMarkdown
          components={{
            img: ({ src = '', alt = '' }) => <img src={src} alt={alt || 'memo image'} style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />,
            p: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{children}</p>,
            h1: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
            h2: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
            h3: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
            h4: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
            h5: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
            h6: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
            pre: ({ children }) => <pre style={{ margin: '0 0 8px', padding: 12, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre', fontSize: 13, lineHeight: 1.5 }}>{children}</pre>,
            code: ({ children, className }) => className
              ? <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', fontSize: 13 }}>{children}</code>
              : <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', fontSize: 13, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: '2px 5px', borderRadius: 3 }}>{children}</code>,
          }}
        >
          {stripTagSyntax(data.memo.content)}
        </ReactMarkdown>
      </div>
    </article>
  );
};
