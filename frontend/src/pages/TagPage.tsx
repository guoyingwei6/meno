import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchPublicMemos } from '../lib/api';
import { MemoTimeline } from '../components/MemoTimeline';

export const TagPage = () => {
  const params = useParams();
  const tag = params['*'] || '';
  const { data, isLoading } = useQuery({
    queryKey: ['public-memos', tag],
    queryFn: () => fetchPublicMemos(tag),
    enabled: Boolean(tag),
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <section>
      <h1>Tag: {tag}</h1>
      <MemoTimeline memos={data?.memos ?? []} />
    </section>
  );
};
