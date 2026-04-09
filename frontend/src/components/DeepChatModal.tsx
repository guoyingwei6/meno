import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { chatWithKnowledgeBase, fetchAuthorMemo, fetchOcrQueueStatus, rebuildKnowledgeIndex, runOcrQueue } from '../lib/api';
import { getAiConfig } from '../lib/ai-config';
import { stripTagSyntax } from '../lib/content';
import { useTheme, colors } from '../lib/theme';
import type { AiChatMessage, KnowledgeSource } from '../types/shared';

interface DeepChatModalProps {
  onClose?: () => void;
  onOpenAiConfig: () => void;
  embedded?: boolean;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  sources?: KnowledgeSource[];
}

export const DeepChatModal = ({ onClose, onOpenAiConfig, embedded = false }: DeepChatModalProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [runningOcr, setRunningOcr] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeSource, setActiveSource] = useState<KnowledgeSource | null>(null);

  const config = getAiConfig();
  const ocrStatusQuery = useQuery({
    queryKey: ['ocr-queue-status'],
    queryFn: fetchOcrQueueStatus,
  });

  const handleRebuild = async () => {
    setIndexing(true);
    setError('');
    setNotice('');
    try {
      const result = await rebuildKnowledgeIndex();
      setNotice(`索引完成，已同步 ${result.indexed} 条笔记`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '索引失败');
    } finally {
      setIndexing(false);
    }
  };

  const handleRunOcr = async () => {
    setRunningOcr(true);
    setError('');
    setNotice('');
    try {
      const result = await runOcrQueue();
      setNotice(`本轮 OCR 完成：处理 ${result.processed} 张，跳过 ${result.skipped} 张，当前待处理 ${result.status.pending + result.status.failed} 张`);
      await ocrStatusQuery.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : '运行 OCR 队列失败');
    } finally {
      setRunningOcr(false);
    }
  };

  const handleSend = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) {
      return;
    }
    if (!config) {
      setError('请先配置 AI');
      return;
    }

    const nextHistory: AiChatMessage[] = messages.map((message) => ({ role: message.role, content: message.content }));
    setLoading(true);
    setError('');
    setNotice('');
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setQuestion('');

    try {
      const result = await chatWithKnowledgeBase(trimmed, config, nextHistory);
      setMessages((prev) => [...prev, { role: 'assistant', content: result.answer, sources: result.sources }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '对话失败');
    } finally {
      setLoading(false);
    }
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') {
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      return;
    }

    event.preventDefault();
    void handleSend();
  };

  const content = (
    <div style={{ ...(embedded ? styles.embedded : styles.modal), background: c.cardBg, borderColor: c.border }}>
        <div style={styles.header}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, color: c.textPrimary }}>深度对话</h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: c.textMuted }}>仅基于你的公开笔记检索回答，支持追问。</p>
          </div>
          {!embedded && onClose && <button type="button" onClick={onClose} style={{ ...styles.closeButton, color: c.textTertiary }}>×</button>}
        </div>

        <div style={styles.toolbar}>
          <button type="button" style={{ ...styles.secondaryButton, borderColor: c.borderMedium, color: c.textPrimary, background: c.pageBg }} onClick={onOpenAiConfig}>
            AI 配置
          </button>
          <button type="button" style={{ ...styles.primaryButton, opacity: indexing ? 0.7 : 1 }} disabled={indexing} onClick={handleRebuild}>
            {indexing ? '索引中...' : '重建知识库索引'}
          </button>
          <button type="button" style={{ ...styles.secondaryButton, borderColor: c.borderMedium, color: c.textPrimary, background: c.pageBg, opacity: runningOcr ? 0.7 : 1 }} disabled={runningOcr} onClick={handleRunOcr}>
            {runningOcr ? 'OCR 运行中...' : '手动跑一轮 OCR'}
          </button>
        </div>

        <div style={{ ...styles.banner, background: c.pageBg, borderColor: c.borderMedium, color: c.textMuted }}>
          {ocrStatusQuery.isLoading ? (
            'OCR 队列状态加载中...'
          ) : ocrStatusQuery.error ? (
            'OCR 队列状态获取失败'
          ) : ocrStatusQuery.data ? (
            <>
              <div style={{ color: c.textPrimary, fontWeight: 600, marginBottom: 6 }}>OCR 队列</div>
              <div>待处理 {ocrStatusQuery.data.pending}，失败待重试 {ocrStatusQuery.data.failed}，处理中 {ocrStatusQuery.data.processing}，已完成 {ocrStatusQuery.data.done}</div>
              <div>今日已处理 {ocrStatusQuery.data.processedToday} / {ocrStatusQuery.data.dailyLimit}，每轮最多 {ocrStatusQuery.data.batchSize} 张</div>
            </>
          ) : null}
        </div>

        {!config && (
          <div style={{ ...styles.banner, background: c.pageBg, borderColor: c.borderMedium, color: c.textMuted }}>
            还没配置回答模型，先去设置 GitHub Models 或其他 OpenAI 兼容接口。
          </div>
        )}
        {notice && <div style={{ ...styles.success, background: c.accentLight, color: c.textPrimary }}>{notice}</div>}
        {error && <div style={styles.error}>{error}</div>}

        <div style={{ ...styles.messages, background: c.pageBg, borderColor: c.border }}>
          {messages.length === 0 ? (
            <div style={{ color: c.textMuted, fontSize: 14, lineHeight: 1.7 }}>
              可以直接问：
              <br />
              “我最近反复在想什么？”
              <br />
              “过去写过哪些和 tag 管理相关的想法？”
              <br />
              “帮我总结公开笔记里关于产品方向的线索”
            </div>
          ) : messages.map((message, index) => (
            <div key={`${message.role}-${index}`} style={{ ...styles.messageCard, background: message.role === 'assistant' ? c.cardBg : c.accentLight }}>
              <div style={{ ...styles.messageRole, color: c.textMuted }}>{message.role === 'assistant' ? '知识库' : '我'}</div>
              <div style={{ color: c.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{message.content}</div>
              {message.sources && message.sources.length > 0 && (
                <div style={styles.sourcesWrap}>
                  {message.sources.map((source, sourceIndex) => (
                    <button
                      key={`${source.memoId}-${source.slug}`}
                      type="button"
                      style={{ ...styles.sourceCard, borderColor: c.borderMedium, background: c.pageBg, color: c.textPrimary }}
                      onClick={() => setActiveSource(source)}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, color: c.textSecondary }}>
                        资料{sourceIndex + 1} · {source.displayDate} · {source.slug}
                      </div>
                      <div style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>{source.snippet}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={styles.inputWrap}>
          <textarea
            placeholder="基于我的笔记库，问点更深的问题..."
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            style={{ ...styles.textarea, background: c.pageBg, borderColor: c.borderMedium, color: c.textPrimary }}
            rows={4}
          />
          <button type="button" style={{ ...styles.primaryButton, minWidth: 88, opacity: loading ? 0.7 : 1 }} onClick={handleSend} disabled={loading}>
            {loading ? '思考中...' : '发送'}
          </button>
        </div>
      </div>
  );

  if (embedded) {
    return (
      <>
        {content}
        {activeSource && <SourceMemoPreview source={activeSource} onClose={() => setActiveSource(null)} />}
      </>
    );
  }

  return (
    <div style={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      {content}
      {activeSource && <SourceMemoPreview source={activeSource} onClose={() => setActiveSource(null)} />}
    </div>
  );
};

const SourceMemoPreview = ({ source, onClose }: { source: KnowledgeSource; onClose: () => void }) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const { data, isLoading } = useQuery({
    queryKey: ['deep-chat-source-memo', source.slug],
    queryFn: () => fetchAuthorMemo(source.slug),
  });

  return (
    <div style={styles.previewOverlay} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div style={{ ...styles.previewCard, background: c.cardBg, borderColor: c.border }}>
        <div style={styles.header}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, color: c.textPrimary }}>{source.displayDate}</h3>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: c.textMuted }}>{source.slug}</p>
          </div>
          <button type="button" onClick={onClose} style={{ ...styles.closeButton, color: c.textTertiary }}>×</button>
        </div>
        {isLoading ? (
          <div style={{ color: c.textMuted, fontSize: 14 }}>加载中...</div>
        ) : !data?.memo ? (
          <div style={{ color: c.textMuted, fontSize: 14 }}>笔记不存在</div>
        ) : (
          <>
            <div style={styles.previewTags}>
              {data.memo.tags.map((tag) => (
                <span key={tag} style={{ color: c.tagColor, fontSize: 13, fontWeight: 500 }}>#{tag}</span>
              ))}
            </div>
            <div style={{ ...styles.previewBody, background: c.pageBg, borderColor: c.borderMedium }}>
              <ReactMarkdown
                components={{
                  img: ({ src = '', alt = '' }) => <img src={src} alt={alt || 'memo image'} style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0' }} />,
                  p: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{children}</p>,
                  h1: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
                  h2: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
                  h3: ({ children }) => <p style={{ lineHeight: 1.7, fontSize: 14, color: c.textSecondary, margin: '0 0 8px' }}>{children}</p>,
                  pre: ({ children }) => <pre style={{ margin: '0 0 8px', padding: 12, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre', fontSize: 13, lineHeight: 1.5 }}>{children}</pre>,
                  code: ({ children, className }) => className
                    ? <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', fontSize: 13 }}>{children}</code>
                    : <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', fontSize: 13, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: '2px 5px', borderRadius: 3 }}>{children}</code>,
                }}
              >
                {stripTagSyntax(data.memo.content)}
              </ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modal: {
    width: 760,
    maxWidth: '100%',
    maxHeight: '90vh',
    borderRadius: 18,
    border: '1px solid',
    boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: 18,
  },
  embedded: {
    width: '100%',
    borderRadius: 18,
    border: '1px solid',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: 18,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  closeButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 24,
    lineHeight: 1,
    padding: 0,
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryButton: {
    border: 'none',
    borderRadius: 10,
    background: '#31d266',
    color: '#fff',
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  banner: {
    border: '1px solid',
    borderRadius: 12,
    padding: '12px 14px',
    fontSize: 13,
    lineHeight: 1.6,
  },
  success: {
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 13,
  },
  error: {
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 13,
    background: 'rgba(229, 62, 62, 0.12)',
    color: '#c53030',
  },
  messages: {
    border: '1px solid',
    borderRadius: 14,
    padding: 14,
    minHeight: 280,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  messageCard: {
    borderRadius: 14,
    padding: 14,
  },
  messageRole: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: 0.4,
  },
  sourcesWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 12,
  },
  sourceCard: {
    border: '1px solid',
    borderRadius: 10,
    padding: '8px 10px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  inputWrap: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    resize: 'vertical',
    border: '1px solid',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 1.6,
    outline: 'none',
  },
  previewOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1001,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  previewCard: {
    width: 760,
    maxWidth: '100%',
    maxHeight: '88vh',
    border: '1px solid',
    borderRadius: 18,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  previewTags: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  previewBody: {
    border: '1px solid',
    borderRadius: 12,
    padding: '16px 18px',
    overflowY: 'auto',
  },
};
