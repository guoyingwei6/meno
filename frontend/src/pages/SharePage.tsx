import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSharedMemo } from '../lib/api';
import { shouldRenderMarkdown, stripHtmlTags, stripTagSyntax } from '../lib/content';
import { useTheme, colors } from '../lib/theme';

const LazySafeMarkdown = lazy(() => import('../components/SafeMarkdown').then((module) => ({ default: module.SafeMarkdown })));

export const SharePage = () => {
  const { token = '' } = useParams();
  const { isDark } = useTheme();
  const c = colors(isDark);
  const query = useQuery({
    queryKey: ['shared-memo', token],
    queryFn: () => fetchSharedMemo(token),
    enabled: Boolean(token),
    retry: false,
  });

  if (query.isPending) return <div style={{ padding: 32, color: c.textMuted }}>加载分享笔记...</div>;
  if (query.isError || !query.data?.memo) return <div style={{ padding: 32, color: c.textMuted }}>{query.error instanceof Error ? query.error.message : '分享链接不存在或已失效'}</div>;

  const memo = query.data.memo;
  const content = stripTagSyntax(memo.content);
  const components = {
    img: ({ src = '', alt = '' }: { src?: string; alt?: string }) => <img src={src} alt={alt || 'memo image'} style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />,
    p: ({ children }: { children?: React.ReactNode }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{children}</p>,
    h1: ({ children }: { children?: React.ReactNode }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
    h2: ({ children }: { children?: React.ReactNode }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
    h3: ({ children }: { children?: React.ReactNode }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
  };

  return (
    <article style={{ padding: '24px 28px', maxWidth: 680, margin: '0 auto', color: c.textPrimary }}>
      <header style={{ marginBottom: 12 }}>
        <div style={{ color: c.textMuted, fontSize: 13 }}>{memo.displayDate}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {memo.tags.map((tag) => <span key={tag} style={{ color: c.tagColor, fontSize: 13 }}>#{tag}</span>)}
        </div>
      </header>
      <div style={{ borderRadius: 12, background: c.cardBg, border: `1px solid ${c.border}`, padding: '16px 20px' }}>
        {shouldRenderMarkdown(content) ? (
          <Suspense fallback={<p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, whiteSpace: 'pre-wrap' }}>{stripHtmlTags(content)}</p>}>
            <LazySafeMarkdown content={content} components={components} />
          </Suspense>
        ) : (
          <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, whiteSpace: 'pre-wrap' }}>{content}</p>
        )}
      </div>
    </article>
  );
};
