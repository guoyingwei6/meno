import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAuthorMemo, fetchMe, updateMemo } from '../lib/api';

export const MemoEditPage = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const [content, setContent] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<string | null>(null);
  const [displayDate, setDisplayDate] = useState<string | null>(null);

  const memo = data?.memo;
  const editContent = content ?? memo?.content ?? '';
  const editVisibility = (visibility ?? memo?.visibility ?? 'public') as 'public' | 'private' | 'draft';
  const editDisplayDate = displayDate ?? memo?.displayDate ?? '';

  const mutation = useMutation({
    mutationFn: () =>
      updateMemo(memo!.id, {
        content: editContent,
        visibility: editVisibility,
        displayDate: editDisplayDate,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['author-memo', slug] });
      navigate(`/memos/${slug}`);
    },
  });

  if (isLoading || meLoading) {
    return <div style={{ padding: 32 }}>Loading...</div>;
  }

  if (!isAuthor) {
    return <div style={{ padding: 32 }}>无权限编辑</div>;
  }

  if (!memo) {
    return <div style={{ padding: 32 }}>Memo not found</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: 880, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 16 }}>编辑 Memo</h2>
      <textarea
        style={{ width: '100%', minHeight: 200, padding: 16, borderRadius: 12, border: '1px solid #e0e0e0', fontSize: 16, lineHeight: 1.6, boxSizing: 'border-box', resize: 'vertical' }}
        value={editContent}
        onChange={(e) => setContent(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#666' }}>可见性</span>
          <select value={editVisibility} onChange={(e) => setVisibility(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e0e0e0' }}>
            <option value="public">公开</option>
            <option value="private">私密</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#666' }}>归属日期</span>
          <input type="date" value={editDisplayDate} onChange={(e) => setDisplayDate(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e0e0e0' }} />
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
          style={{ padding: '10px 20px', borderRadius: 12, border: '1px solid #e0e0e0', background: '#fff', color: '#555', cursor: 'pointer' }}
          onClick={() => navigate(`/memos/${slug}`)}
        >
          取消
        </button>
      </div>
    </div>
  );
};
