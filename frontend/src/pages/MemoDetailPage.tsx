import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAuthorMemo, fetchMe, fetchPublicMemo } from '../lib/api';
import { stripTagSyntax } from '../lib/content';

export const MemoDetailPage = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
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

  if (isLoading || meLoading) {
    return <div style={{ padding: 32, color: '#999' }}>Loading...</div>;
  }

  if (!data?.memo) {
    return <div style={{ padding: 32, color: '#999' }}>Memo not found</div>;
  }

  return (
    <article style={{ padding: '24px 28px', maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#999', fontSize: 14, padding: 0 }} onClick={() => navigate('/')}>← 返回</button>
        {isAuthor ? (
          <button type="button" style={{ marginLeft: 'auto', border: '1px solid #e0e0e0', background: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 13, color: '#666', cursor: 'pointer' }} onClick={() => navigate(`/memos/${slug}/edit`)}>编辑</button>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {data.memo.tags.map((tag) => (
          <span key={tag} style={{ color: '#3aa864', fontSize: 14, fontWeight: 500 }}>#{tag}</span>
        ))}
      </div>
      <div style={{ borderRadius: 12, background: '#fff', border: '1px solid #f0f0f0', padding: '16px 20px' }}>
        <ReactMarkdown
          components={{
            img: ({ src = '', alt = '' }) => <img src={src} alt={alt || 'memo image'} style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />,
            p: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{children}</p>,
            h1: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px' }}>{children}</p>,
            h2: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px' }}>{children}</p>,
            h3: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px' }}>{children}</p>,
            h4: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px' }}>{children}</p>,
            h5: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px' }}>{children}</p>,
            h6: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: '#333', margin: '0 0 8px' }}>{children}</p>,
          }}
        >
          {stripTagSyntax(data.memo.content)}
        </ReactMarkdown>
      </div>
    </article>
  );
};
