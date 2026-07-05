import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ThemeProvider } from './lib/theme';

const queryClient = new QueryClient();
const MemoDetailPage = lazy(() => import('./pages/MemoDetailPage').then((module) => ({ default: module.MemoDetailPage })));
const MemoEditPage = lazy(() => import('./pages/MemoEditPage').then((module) => ({ default: module.MemoEditPage })));
const TagPage = lazy(() => import('./pages/TagPage').then((module) => ({ default: module.TagPage })));

export const App = () => {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<div style={styles.loading}>Loading...</div>}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/memos/:slug" element={<MemoDetailPage />} />
              <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
              <Route path="/tags/*" element={<TagPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

const styles: Record<string, CSSProperties> = {
  loading: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    fontSize: 16,
    color: '#999',
  },
};
