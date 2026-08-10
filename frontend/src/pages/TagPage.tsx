import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchDashboardMemos, fetchMe, fetchPublicMemos } from '../lib/api';
import { MemoTimeline } from '../components/MemoTimeline';

export const TagPage = () => {
  const params = useParams();
  const tag = params['*'] || '';
  const { data: me, isLoading: isLoadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
    staleTime: 30_000,
  });
  const isAuthor = me?.authenticated === true && me.role === 'author';
  const { data, isLoading } = useQuery({
    queryKey: [isAuthor ? 'dashboard-memos' : 'public-memos', 'tag', tag],
    queryFn: () => isAuthor
      ? fetchDashboardMemos('all', undefined, { limit: 100 }, tag)
      : fetchPublicMemos(tag, undefined, { limit: 100 }),
    enabled: Boolean(tag) && !isLoadingMe,
    staleTime: 15_000,
  });

  if (isLoadingMe || isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <section>
      <h1>Tag: {tag}</h1>
      <MemoTimeline memos={data?.memos ?? []} />
    </section>
  );
};
