import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ThemeProvider } from './lib/theme';
import { PwaInstallProvider } from './components/PwaInstallProvider';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { PwaUpdateToast } from './components/PwaUpdateToast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep lazy pages from inheriting TanStack Query's three retries and
      // focus-triggered refetches. HomePage overrides staleTime by data type.
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});
const MemoDetailPage = lazy(() => import('./pages/MemoDetailPage').then((module) => ({ default: module.MemoDetailPage })));
const MemoEditPage = lazy(() => import('./pages/MemoEditPage').then((module) => ({ default: module.MemoEditPage })));
const TagPage = lazy(() => import('./pages/TagPage').then((module) => ({ default: module.TagPage })));
const SharePage = lazy(() => import('./pages/SharePage').then((module) => ({ default: module.SharePage })));

export const App = () => {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <PwaInstallProvider>
            <Suspense fallback={<div style={styles.loading}>Loading...</div>}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/memos/:slug" element={<MemoDetailPage />} />
                <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
                <Route path="/share/:token" element={<SharePage />} />
                <Route path="/tags/*" element={<TagPage />} />
              </Routes>
            </Suspense>
            <PwaInstallPrompt />
            <PwaUpdateToast />
          </PwaInstallProvider>
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
