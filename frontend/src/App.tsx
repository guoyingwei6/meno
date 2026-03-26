import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { MemoDetailPage } from './pages/MemoDetailPage';
import { MemoEditPage } from './pages/MemoEditPage';
import { TagPage } from './pages/TagPage';


const queryClient = new QueryClient();

export const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/memos/:slug" element={<MemoDetailPage />} />
          <Route path="/memos/:slug/edit" element={<MemoEditPage />} />
          <Route path="/tags/*" element={<TagPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};
