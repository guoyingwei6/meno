# AI 填充标签 + API 配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-powered tag suggestion feature in MemoCard's ··· menu, backed by a configurable OpenAI-compatible API set via a wand button in TopBar.

**Architecture:** MemoCard handles the full AI call lifecycle (config check → fetch → confirm modal) using new `allTags` and `onFillTags` props passed down through MemoTimeline from HomePage. AI config is stored in localStorage via a shared utility. A new AiConfigModal component handles config UI, opened from TopBar's new wand button.

**Tech Stack:** React + TypeScript, Vitest + React Testing Library, localStorage, OpenAI-compatible Chat Completions API

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/lib/ai-config.ts` | Create | Read/write AI config from localStorage |
| `frontend/src/components/AiConfigModal.tsx` | Create | AI config form modal (URL, key, model) |
| `frontend/src/components/TopBar.tsx` | Modify | Add `onAiConfig` prop + wand icon button |
| `frontend/src/components/MemoCard.tsx` | Modify | Fill-tags menu item, AI call, toast, confirm modal |
| `frontend/src/components/MemoTimeline.tsx` | Modify | Pass through `allTags` + `onFillTags` props |
| `frontend/src/pages/HomePage.tsx` | Modify | Wire allTags, onFillTags, AiConfigModal, TopBar wand |
| `frontend/src/test/ai-config.test.ts` | Create | Tests for ai-config utility |
| `frontend/src/test/ai-config-modal.test.tsx` | Create | Tests for AiConfigModal |
| `frontend/src/test/top-bar-ai-config.test.tsx` | Create | Tests for TopBar wand button |
| `frontend/src/test/memo-card-fill-tags.test.tsx` | Create | Tests for fill-tags feature in MemoCard |

---

## Task 1: ai-config.ts utility

**Files:**
- Create: `frontend/src/lib/ai-config.ts`
- Create: `frontend/src/test/ai-config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// frontend/src/test/ai-config.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getAiConfig, setAiConfig } from '../lib/ai-config';

beforeEach(() => {
  localStorage.clear();
});

describe('ai-config', () => {
  it('returns null when config not set', () => {
    expect(getAiConfig()).toBeNull();
  });

  it('returns parsed config after setAiConfig', () => {
    const config = { url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' };
    setAiConfig(config);
    expect(getAiConfig()).toEqual(config);
  });

  it('returns null when localStorage contains invalid JSON', () => {
    localStorage.setItem('meno_ai_config', 'not-json');
    expect(getAiConfig()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/test/ai-config.test.ts
```
Expected: FAIL — `Cannot find module '../lib/ai-config'`

- [ ] **Step 3: Implement ai-config.ts**

```typescript
// frontend/src/lib/ai-config.ts
export interface AiConfig {
  url: string;
  apiKey: string;
  model: string;
}

const KEY = 'meno_ai_config';

export const getAiConfig = (): AiConfig | null => {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AiConfig;
  } catch {
    return null;
  }
};

export const setAiConfig = (config: AiConfig): void => {
  localStorage.setItem(KEY, JSON.stringify(config));
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/test/ai-config.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai-config.ts frontend/src/test/ai-config.test.ts
git commit -m "feat: add ai-config localStorage utility"
```

---

## Task 2: AiConfigModal component

**Files:**
- Create: `frontend/src/components/AiConfigModal.tsx`
- Create: `frontend/src/test/ai-config-modal.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/test/ai-config-modal.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiConfigModal } from '../components/AiConfigModal';

beforeEach(() => {
  localStorage.clear();
});

describe('AiConfigModal', () => {
  it('renders empty fields when no config saved', () => {
    render(<AiConfigModal onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('https://api.openai.com/v1')).toHaveValue('');
    expect(screen.getByPlaceholderText('gpt-4o-mini')).toHaveValue('');
  });

  it('pre-fills fields from saved config', () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    }));
    render(<AiConfigModal onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('https://api.openai.com/v1')).toHaveValue('https://api.example.com/v1');
    expect(screen.getByPlaceholderText('gpt-4o-mini')).toHaveValue('gpt-4o');
  });

  it('saves config and calls onClose when 保存 clicked', () => {
    const onClose = vi.fn();
    render(<AiConfigModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText('gpt-4o-mini'), {
      target: { value: 'gpt-4o-mini' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClose).toHaveBeenCalled();
    const saved = JSON.parse(localStorage.getItem('meno_ai_config') ?? '{}');
    expect(saved.url).toBe('https://api.openai.com/v1');
    expect(saved.model).toBe('gpt-4o-mini');
  });

  it('calls onClose when 取消 clicked', () => {
    const onClose = vi.fn();
    render(<AiConfigModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/test/ai-config-modal.test.tsx
```
Expected: FAIL — `Cannot find module '../components/AiConfigModal'`

- [ ] **Step 3: Implement AiConfigModal.tsx**

```tsx
// frontend/src/components/AiConfigModal.tsx
import { useState } from 'react';
import { getAiConfig, setAiConfig } from '../lib/ai-config';
import { useTheme, colors } from '../lib/theme';

interface AiConfigModalProps {
  onClose: () => void;
}

export const AiConfigModal = ({ onClose }: AiConfigModalProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const existing = getAiConfig();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [model, setModel] = useState(existing?.model ?? '');

  const handleSave = () => {
    setAiConfig({ url: url.trim(), apiKey: apiKey.trim(), model: model.trim() });
    onClose();
  };

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...modalStyle, background: c.cardBg }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: c.textPrimary }}>AI 配置</h3>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: c.textTertiary }}>×</button>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: c.textMuted }}>用于「填充标签」功能，兼容 OpenAI 接口</p>

        <label style={labelStyle}>API 地址 (Base URL)</label>
        <input
          style={{ ...inputStyle, borderColor: c.borderMedium, background: c.pageBg, color: c.textPrimary }}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
        />

        <label style={labelStyle}>API Key</label>
        <input
          type="password"
          style={{ ...inputStyle, borderColor: c.borderMedium, background: c.pageBg, color: c.textPrimary }}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />

        <label style={labelStyle}>模型</label>
        <input
          style={{ ...inputStyle, borderColor: c.borderMedium, background: c.pageBg, color: c.textPrimary }}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="gpt-4o-mini"
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" onClick={onClose}
            style={{ border: `1px solid ${c.borderMedium}`, background: c.cardBg, color: c.textPrimary, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
            取消
          </button>
          <button type="button" onClick={handleSave}
            style={{ border: 'none', background: c.accent, color: '#fff', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            保存
          </button>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 11, color: c.textMuted }}>
          配置保存于本地 localStorage，不上传服务器
        </p>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const modalStyle: React.CSSProperties = {
  borderRadius: 12, padding: 24, width: 420, maxWidth: '95vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 5,
};
const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  border: '1px solid #e0e0e0', borderRadius: 8, padding: '9px 12px',
  fontSize: 13, marginBottom: 14, outline: 'none',
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/test/ai-config-modal.test.tsx
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AiConfigModal.tsx frontend/src/test/ai-config-modal.test.tsx
git commit -m "feat: add AiConfigModal component"
```

---

## Task 3: TopBar wand button

**Files:**
- Modify: `frontend/src/components/TopBar.tsx`
- Create: `frontend/src/test/top-bar-ai-config.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/test/top-bar-ai-config.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../components/TopBar';

beforeEach(() => {
  (globalThis as typeof globalThis & { __MENO_API_BASE_URL__?: string }).__MENO_API_BASE_URL__ = 'https://api.meno.test';
});

describe('TopBar AI config button', () => {
  it('shows AI config wand button when authenticated', () => {
    const onAiConfig = vi.fn();
    render(<TopBar authenticated={true} githubLogin="user" onLogout={vi.fn()} onAiConfig={onAiConfig} />);
    const btn = screen.getByRole('button', { name: 'AI 配置' });
    fireEvent.click(btn);
    expect(onAiConfig).toHaveBeenCalled();
  });

  it('does not show AI config button when not authenticated', () => {
    render(<TopBar authenticated={false} githubLogin={null} onLogout={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'AI 配置' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/test/top-bar-ai-config.test.tsx
```
Expected: FAIL — `Unable to find role="button" name="AI 配置"`

- [ ] **Step 3: Modify TopBar.tsx**

Add `onAiConfig?: () => void` to the `TopBarProps` interface and add the wand button after the import/export button. Replace the entire `TopBar.tsx` with:

```tsx
// frontend/src/components/TopBar.tsx
import { useState } from 'react';
import { loginUrl } from '../lib/runtime-config';
import { useTheme, colors, type ThemeMode } from '../lib/theme';

interface TopBarProps {
  authenticated: boolean;
  githubLogin: string | null;
  onLogout: () => void;
  onToggleSidebar?: () => void;
  onRefresh?: () => Promise<void> | void;
  onImportExport?: () => void;
  onAiConfig?: () => void;
}

const ThemeToggle = () => {
  const { mode, setMode } = useTheme();
  const next: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'auto', auto: 'light' };
  const icons: Record<ThemeMode, string> = { light: '☀️', dark: '🌙', auto: '🖥' };
  return (
    <button type="button" style={styles.iconButton} onClick={() => setMode(next[mode])} aria-label={`主题: ${mode}`} title={`当前: ${mode === 'auto' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}`}>
      <span style={{ fontSize: 16 }}>{icons[mode]}</span>
    </button>
  );
};

export const TopBar = ({ authenticated, githubLogin, onLogout, onToggleSidebar, onRefresh, onImportExport, onAiConfig }: TopBarProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = async () => {
    setSpinning(true);
    try {
      await onRefresh?.();
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  };

  return (
    <header style={styles.header}>
      <div style={styles.leftActions}>
        <button type="button" style={styles.iconButton} onClick={onToggleSidebar} aria-label="切换侧边栏" title="折叠 / 展开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button type="button" style={styles.iconButton} onClick={handleRefresh} aria-label="刷新" title="刷新">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={spinning ? c.accent : c.textTertiary} strokeWidth="2" style={{ transition: 'transform 0.6s ease', transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)' }}>
            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        <ThemeToggle />
        {authenticated && (
          <button type="button" style={styles.iconButton} onClick={onImportExport} aria-label="导入/导出" title="导入 / 导出">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        )}
        {authenticated && (
          <button type="button" style={styles.iconButton} onClick={onAiConfig} aria-label="AI 配置" title="AI 配置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c.textTertiary} strokeWidth="2">
              <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
              <path d="m14 7 3 3" />
              <path d="M5 6v4" /><path d="M19 14v4" />
              <path d="M10 2v2" /><path d="M7 8H3" />
              <path d="M21 16h-4" /><path d="M11 3H9" />
            </svg>
          </button>
        )}
      </div>
      <div style={styles.actions}>
        {authenticated ? (
          <>
            <span style={{ ...styles.identity, color: c.textTertiary }}>@{githubLogin}</span>
            <button type="button" style={{ ...styles.authButtonSecondary, borderColor: c.borderMedium, color: c.textTertiary, background: c.cardBg }} onClick={onLogout}>退出</button>
          </>
        ) : (
          <button type="button" style={styles.authButtonPrimary} onClick={() => window.location.assign(loginUrl())}>GitHub 登录</button>
        )}
      </div>
    </header>
  );
};

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 },
  leftActions: { display: 'flex', alignItems: 'center', gap: 4 },
  iconButton: { border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  actions: { display: 'flex', alignItems: 'center', gap: 10 },
  identity: { fontWeight: 600, fontSize: 14 },
  authButtonPrimary: { border: 'none', borderRadius: 8, padding: '8px 14px', background: '#111', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  authButtonSecondary: { border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 12px', background: '#fff', cursor: 'pointer', fontSize: 13 },
};
```

- [ ] **Step 4: Run all TopBar tests to verify they pass**

```bash
cd frontend && npx vitest run src/test/top-bar-auth.test.tsx src/test/top-bar-ai-config.test.tsx
```
Expected: PASS — 4 tests total

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TopBar.tsx frontend/src/test/top-bar-ai-config.test.tsx
git commit -m "feat: add AI config wand button to TopBar"
```

---

## Task 4: MemoCard — fill-tags menu item, toast, loading, AI call, confirm modal

**Files:**
- Modify: `frontend/src/components/MemoCard.tsx`
- Create: `frontend/src/test/memo-card-fill-tags.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/test/memo-card-fill-tags.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoCard } from '../components/MemoCard';

const baseMemo = {
  id: 1,
  slug: 'test-memo',
  content: '今天学习了 React 的一些用法',
  excerpt: '今天学习了 React',
  displayDate: '2026-03-31',
  createdAt: '2026-03-31T00:00:00.000Z',
  updatedAt: '2026-03-31T00:00:00.000Z',
  publishedAt: null,
  deletedAt: null,
  previousVisibility: null,
  hasImages: false,
  imageCount: 0,
  tagCount: 0,
  tags: [],
  visibility: 'public' as const,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('MemoCard fill-tags menu item', () => {
  it('shows 填充标签（AI）in menu when isAuthor', () => {
    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '填充标签（AI）' })).toBeInTheDocument();
  });

  it('does not show 填充标签（AI）when not author', () => {
    render(<MemoCard memo={baseMemo} allTags={['技术']} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.queryByRole('button', { name: '填充标签（AI）' })).toBeNull();
  });
});

describe('MemoCard fill-tags: no config', () => {
  it('shows toast 请先配置 AI when no config set', async () => {
    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));
    await waitFor(() => {
      expect(screen.getByText('请先配置 AI')).toBeInTheDocument();
    });
  });

  it('shows toast when allTags is empty', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    render(<MemoCard memo={baseMemo} isAuthor allTags={[]} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));
    await waitFor(() => {
      expect(screen.getByText('暂无可用标签，请先创建标签')).toBeInTheDocument();
    });
  });
});

describe('MemoCard fill-tags: loading state', () => {
  it('shows 分析中... and disables button during AI call', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '分析中...' })).toBeDisabled();
    });
  });
});

describe('MemoCard fill-tags: AI call success', () => {
  it('shows confirm modal with suggested tags after AI responds', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["技术", "学习"]' } }],
      }),
    } as Response);

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习', '工作']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('AI 建议添加以下标签')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('#技术')).toBeInTheDocument();
    expect(screen.getByLabelText('#学习')).toBeInTheDocument();
  });

  it('calls onFillTags with tags prepended to content when 应用 clicked', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["技术"]' } }],
      }),
    } as Response);

    const onFillTags = vi.fn();
    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术', '学习']} onFillTags={onFillTags} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => screen.getByText('AI 建议添加以下标签'));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    expect(onFillTags).toHaveBeenCalledWith(1, '#技术\n今天学习了 React 的一些用法');
  });

  it('filters out tags already on the memo', async () => {
    const memoWithTag = { ...baseMemo, tags: ['技术'] };
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '["技术"]' } }],
      }),
    } as Response);

    render(<MemoCard memo={memoWithTag} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('未找到新的匹配标签')).toBeInTheDocument();
    });
  });

  it('shows toast when AI returns empty array', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '[]' } }],
      }),
    } as Response);

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('未找到新的匹配标签')).toBeInTheDocument();
    });
  });
});

describe('MemoCard fill-tags: AI call failure', () => {
  it('shows error toast when fetch fails', async () => {
    localStorage.setItem('meno_ai_config', JSON.stringify({
      url: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini',
    }));
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    render(<MemoCard memo={baseMemo} isAuthor allTags={['技术']} onFillTags={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '填充标签（AI）' }));

    await waitFor(() => {
      expect(screen.getByText('AI 调用失败: Network error')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/test/memo-card-fill-tags.test.tsx
```
Expected: FAIL — several tests fail due to missing props and UI elements

- [ ] **Step 3: Implement MemoCard.tsx changes**

Replace the entire `frontend/src/components/MemoCard.tsx` with the following. Key changes: add `allTags`/`onFillTags` props; replace `copied` state with `toastMsg`; add `fillLoading`, `suggestedTags`, `checkedTags` states; add fill-tags menu item; add AI call handler; add confirm modal.

```tsx
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { extractMarkdownImageUrls, stripMarkdownImageSyntax, stripTagSyntax } from '../lib/content';
import { useEffect, useState } from 'react';
import type { MemoSummary } from '../types/shared';
import { useTheme, colors } from '../lib/theme';
import { getAiConfig } from '../lib/ai-config';

interface MemoCardProps {
  memo: MemoSummary;
  isAuthor?: boolean;
  isTrash?: boolean;
  allTags?: string[];
  onOpen?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onEdit?: (memo: MemoSummary) => void;
  onRestore?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDelete?: (memo: MemoSummary) => void;
  onFillTags?: (id: number, newContent: string) => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const countWords = (text: string) => {
  const cleaned = text.replace(/!\[.*?\]\(.*?\)/g, '').replace(/[#*_~`>\-\[\]()]/g, '').trim();
  return cleaned.length;
};

export const MemoCard = ({ memo, isAuthor, isTrash, allTags, onOpen, onOpenTag, onEdit, onRestore, onChangeVisibility, onDelete, onFillTags }: MemoCardProps) => {
  const { isDark } = useTheme();
  const c = colors(isDark);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [fillLoading, setFillLoading] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[] | null>(null);
  const [checkedTags, setCheckedTags] = useState<string[]>([]);
  const imageUrls = extractMarkdownImageUrls(memo.content);
  const contentText = stripTagSyntax(stripMarkdownImageSyntax(memo.content));
  const isLong = contentText.length > 200;
  const wordCount = countWords(memo.content);

  useEffect(() => {
    if (lightboxIndex === null || imageUrls.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => i === null ? null : (i - 1 + imageUrls.length) % imageUrls.length);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => i === null ? null : (i + 1) % imageUrls.length);
      if (e.key === 'Escape') setLightboxIndex(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIndex, imageUrls.length]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2000);
  };

  const handleShare = () => {
    const url = `${window.location.origin}/memos/${memo.slug}`;
    navigator.clipboard.writeText(url);
    showToast('链接已复制');
    setMenuOpen(false);
  };

  const handleFillTags = async () => {
    const config = getAiConfig();
    if (!config) {
      setMenuOpen(false);
      showToast('请先配置 AI');
      return;
    }
    if (!allTags?.length) {
      setMenuOpen(false);
      showToast('暂无可用标签，请先创建标签');
      return;
    }
    setFillLoading(true);
    try {
      const resp = await fetch(`${config.url}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content: '你是标签推荐助手。只能从用户提供的标签列表中选择，不得新造标签。返回格式为 JSON 数组，如 ["tag1","tag2"]，不要包含其他内容。',
            },
            {
              role: 'user',
              content: `笔记内容：\n${memo.content}\n\n可用标签列表：${allTags.join(', ')}\n\n请从可用标签中选出适合此笔记的标签。`,
            },
          ],
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? '';
      let tags: string[] = [];
      try {
        tags = JSON.parse(raw);
      } catch {
        const match = raw.match(/\[[\s\S]*?\]/);
        if (match) tags = JSON.parse(match[0]);
        else throw new Error('AI 返回格式无法解析');
      }
      if (!Array.isArray(tags)) throw new Error('AI 返回格式无法解析');
      const newTags = tags.filter((t: string) => !memo.tags.includes(t));
      if (newTags.length === 0) {
        setMenuOpen(false);
        showToast('未找到新的匹配标签');
      } else {
        setMenuOpen(false);
        setSuggestedTags(newTags);
        setCheckedTags(newTags);
      }
    } catch (e) {
      showToast(`AI 调用失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setFillLoading(false);
    }
  };

  const handleApplyTags = () => {
    if (checkedTags.length === 0) { setSuggestedTags(null); return; }
    const newContent = checkedTags.map((t) => `#${t}`).join(' ') + '\n' + memo.content;
    onFillTags?.(memo.id, newContent);
    setSuggestedTags(null);
  };

  return (
    <article style={{ ...styles.card, background: c.cardBg, borderColor: c.border }}>
      <div style={styles.header}>
        <span style={{ ...styles.date, color: c.textMuted }}>{memo.displayDate}</span>
        <div style={styles.headerRight}>
          {toastMsg ? <span style={styles.copiedHint}>{toastMsg}</span> : null}
          <div style={styles.menuWrap}>
            <button
              type="button"
              aria-label="更多操作"
              style={styles.menuTrigger}
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              ···
            </button>
            {menuOpen ? (
              <div style={{ ...styles.menuDropdown, background: c.cardBg, borderColor: c.border }}>
                <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="查看详情" onClick={() => { setMenuOpen(false); onOpen?.(memo); }}>查看详情</button>
                <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="分享" onClick={handleShare}>分享链接</button>
                {isAuthor && isTrash ? (
                  <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="恢复" onClick={() => { setMenuOpen(false); onRestore?.(memo); }}>恢复</button>
                ) : isAuthor ? (
                  <>
                    <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="编辑" onClick={() => { setMenuOpen(false); onEdit?.(memo); }}>编辑</button>
                    <button
                      type="button"
                      style={{ ...styles.menuItem, color: fillLoading ? c.textMuted : '#3aa864' }}
                      aria-label={fillLoading ? '分析中...' : '填充标签（AI）'}
                      disabled={fillLoading}
                      onClick={handleFillTags}
                    >
                      {fillLoading ? '分析中...' : '填充标签（AI）'}
                    </button>
                    {memo.visibility === 'public' ? (
                      <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="设为私密" onClick={() => { setMenuOpen(false); onChangeVisibility?.(memo, 'private'); }}>设为私密</button>
                    ) : (
                      <button type="button" style={{ ...styles.menuItem, color: c.textPrimary }} aria-label="设为公开" onClick={() => { setMenuOpen(false); onChangeVisibility?.(memo, 'public'); }}>设为公开</button>
                    )}
                    <button type="button" style={styles.menuItemDanger} aria-label="删除" onClick={() => { setMenuOpen(false); onDelete?.(memo); }}>删除</button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div style={styles.tags}>
        {memo.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            style={styles.tag}
            onClick={() => onOpenTag?.(tag)}
            aria-label={`#${tag}`}
          >
            #{tag}
          </button>
        ))}
      </div>
      <div style={isLong && !expanded ? { ...styles.content, color: c.textSecondary, maxHeight: 160, overflow: 'hidden' } : { ...styles.content, color: c.textSecondary }}>
        <ReactMarkdown
          rehypePlugins={[rehypeRaw]}
          components={{
            p: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            ul: ({ children }) => <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>,
            ol: ({ children }) => <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>,
            li: ({ children }) => <li style={{ lineHeight: 1.7 }}>{children}</li>,
            h1: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h2: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h3: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h4: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h5: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
            h6: ({ children }) => <p style={{ margin: '0 0 8px', lineHeight: 1.7 }}>{children}</p>,
          }}
        >
          {contentText}
        </ReactMarkdown>
      </div>
      {isLong ? (
        <button
          type="button"
          style={styles.expandButton}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      ) : null}
      {imageUrls.length > 0 ? (
        <div style={styles.previewGrid}>
          {imageUrls.map((url, i) => (
            <img key={url} src={url} alt="memo preview" loading="lazy" decoding="async" style={styles.previewImage} onClick={() => setLightboxIndex(i)} />
          ))}
        </div>
      ) : null}
      <div style={{ ...styles.footer, borderTopColor: c.border }}>
        <span style={styles.footerText}>字数: {wordCount}</span>
        <span style={styles.footerText}>创建于 {formatTime(memo.createdAt)}</span>
        {memo.updatedAt !== memo.createdAt ? <span style={styles.footerText}>编辑于 {formatTime(memo.updatedAt)}</span> : null}
      </div>
      {lightboxIndex !== null ? (
        <div
          style={styles.lightbox}
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => { (e.currentTarget as HTMLElement).dataset.touchX = String(e.touches[0].clientX); }}
          onTouchEnd={(e) => {
            const startX = Number((e.currentTarget as HTMLElement).dataset.touchX ?? 0);
            const diff = e.changedTouches[0].clientX - startX;
            if (Math.abs(diff) < 40) return;
            e.stopPropagation();
            setLightboxIndex((i) => i === null ? null : diff < 0
              ? (i + 1) % imageUrls.length
              : (i - 1 + imageUrls.length) % imageUrls.length);
          }}
        >
          {imageUrls.length > 1 && (
            <button
              type="button"
              style={styles.lightboxArrowLeft}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex - 1 + imageUrls.length) % imageUrls.length); }}
            >‹</button>
          )}
          <img src={imageUrls[lightboxIndex]} alt="full size" style={styles.lightboxImage} onClick={(e) => e.stopPropagation()} />
          {imageUrls.length > 1 && (
            <button
              type="button"
              style={styles.lightboxArrowRight}
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((lightboxIndex + 1) % imageUrls.length); }}
            >›</button>
          )}
          {imageUrls.length > 1 && (
            <span style={styles.lightboxCounter}>{lightboxIndex + 1} / {imageUrls.length}</span>
          )}
        </div>
      ) : null}
      {suggestedTags !== null ? (
        <div style={styles.lightbox} onClick={() => setSuggestedTags(null)}>
          <div
            style={{ ...styles.confirmModal, background: c.cardBg }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: c.textPrimary }}>AI 建议添加以下标签</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {suggestedTags.map((tag) => (
                <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: c.textPrimary }}>
                  <input
                    type="checkbox"
                    aria-label={`#${tag}`}
                    checked={checkedTags.includes(tag)}
                    onChange={(e) => {
                      setCheckedTags((prev) =>
                        e.target.checked ? [...prev, tag] : prev.filter((t) => t !== tag),
                      );
                    }}
                  />
                  <span style={{ color: '#3aa864', fontWeight: 500 }}>#{tag}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSuggestedTags(null)}
                style={{ border: `1px solid ${c.borderMedium}`, background: c.cardBg, color: c.textPrimary, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>
                取消
              </button>
              <button type="button" aria-label="应用" onClick={handleApplyTags}
                style={{ border: 'none', background: '#3aa864', color: '#fff', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                应用
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '16px 20px',
    border: '1px solid #f0f0f0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  copiedHint: {
    fontSize: 12,
    color: '#3aa864',
    fontWeight: 500,
  },
  date: {
    color: '#999',
    fontSize: 13,
  },
  menuWrap: {
    position: 'relative',
  },
  menuTrigger: {
    border: 'none',
    background: 'transparent',
    color: '#999',
    cursor: 'pointer',
    fontSize: 16,
    padding: '2px 6px',
    lineHeight: 1,
    letterSpacing: 1,
  },
  menuDropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    zIndex: 10,
    minWidth: 100,
    padding: '4px 0',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '8px 14px',
    fontSize: 13,
    color: '#444',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  menuItemDanger: {
    display: 'block',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '8px 14px',
    fontSize: 13,
    color: '#e53e3e',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  content: {
    color: '#333',
    fontSize: 14,
    wordBreak: 'break-word',
  },
  expandButton: {
    border: 'none',
    background: 'transparent',
    color: '#3aa864',
    cursor: 'pointer',
    padding: '4px 0 8px',
    fontSize: 13,
  },
  previewGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  previewImage: {
    width: 64,
    height: 64,
    objectFit: 'cover',
    borderRadius: 6,
    background: '#f5f5f5',
    cursor: 'pointer',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    color: '#3aa864',
    background: 'transparent',
    borderRadius: 0,
    padding: 0,
    fontSize: 14,
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
  },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #f0f0f0',
  },
  footerText: {
    fontSize: 11,
    color: '#bbb',
  },
  lightbox: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    cursor: 'zoom-out',
  },
  lightboxImage: {
    maxWidth: '80vw',
    maxHeight: '85vh',
    borderRadius: 8,
    objectFit: 'contain',
    cursor: 'default',
  },
  lightboxArrowLeft: {
    position: 'absolute',
    left: 16,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    fontSize: 40,
    lineHeight: 1,
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
  },
  lightboxArrowRight: {
    position: 'absolute',
    right: 16,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    fontSize: 40,
    lineHeight: 1,
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
  },
  lightboxCounter: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    background: 'rgba(0,0,0,0.4)',
    padding: '3px 10px',
    borderRadius: 12,
  },
  confirmModal: {
    borderRadius: 12,
    padding: 24,
    minWidth: 260,
    maxWidth: 340,
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    cursor: 'default',
  },
};
```

- [ ] **Step 4: Run fill-tags tests and all existing MemoCard tests**

```bash
cd frontend && npx vitest run src/test/memo-card-fill-tags.test.tsx src/test/memo-card-edit-actions.test.tsx src/test/memo-card-expand.test.tsx
```
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MemoCard.tsx frontend/src/test/memo-card-fill-tags.test.tsx
git commit -m "feat: add fill-tags AI feature to MemoCard"
```

---

## Task 5: MemoTimeline prop passthrough

**Files:**
- Modify: `frontend/src/components/MemoTimeline.tsx`

- [ ] **Step 1: Add `allTags` and `onFillTags` to MemoTimeline**

Replace `frontend/src/components/MemoTimeline.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { MemoSummary } from '../types/shared';
import { MemoCard } from './MemoCard';

const PAGE_SIZE = 20;

interface MemoTimelineProps {
  memos: MemoSummary[];
  isAuthor?: boolean;
  isTrash?: boolean;
  allTags?: string[];
  onOpenMemo?: (memo: MemoSummary) => void;
  onOpenTag?: (tag: string) => void;
  onEditMemo?: (memo: MemoSummary) => void;
  onRestoreMemo?: (memo: MemoSummary) => void;
  onChangeVisibility?: (memo: MemoSummary, visibility: 'public' | 'private') => void;
  onDeleteMemo?: (memo: MemoSummary) => void;
  onFillTagsMemo?: (id: number, newContent: string) => void;
}

export const MemoTimeline = ({ memos, isAuthor, isTrash, allTags, onOpenMemo, onOpenTag, onEditMemo, onRestoreMemo, onChangeVisibility, onDeleteMemo, onFillTagsMemo }: MemoTimelineProps) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [memos]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, memos.length));
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [memos.length]);

  const visible = memos.slice(0, visibleCount);

  return (
    <section style={styles.timeline}>
      {visible.map((memo) => (
        <MemoCard
          key={memo.id}
          memo={memo}
          isAuthor={isAuthor}
          isTrash={isTrash}
          allTags={allTags}
          onOpen={onOpenMemo}
          onOpenTag={onOpenTag}
          onEdit={onEditMemo}
          onRestore={onRestoreMemo}
          onChangeVisibility={onChangeVisibility}
          onDelete={onDeleteMemo}
          onFillTags={onFillTagsMemo}
        />
      ))}
      {visibleCount < memos.length && <div ref={sentinelRef} style={styles.sentinel} />}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sentinel: {
    height: 1,
  },
};
```

- [ ] **Step 2: Run existing tests to verify nothing broke**

```bash
cd frontend && npx vitest run
```
Expected: PASS — all existing tests

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MemoTimeline.tsx
git commit -m "feat: pass allTags and onFillTags through MemoTimeline"
```

---

## Task 6: HomePage integration

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`

- [ ] **Step 1: Wire up AiConfigModal, TopBar wand, and MemoTimeline fill-tags**

In `HomePage.tsx`, make these changes:

1. Add import for `AiConfigModal`
2. Add `showAiConfig` state
3. Pass `onAiConfig` to `TopBar`
4. Render `<AiConfigModal>` when `showAiConfig` is true
5. Pass `allTags` and `onFillTagsMemo` to `MemoTimeline`

The diff is:

```tsx
// Add to imports at top:
import { AiConfigModal } from '../components/AiConfigModal';

// Add state (near showImportExport):
const [showAiConfig, setShowAiConfig] = useState(false);

// Add inside return, next to ImportExportModal:
{showAiConfig && (
  <AiConfigModal onClose={() => setShowAiConfig(false)} />
)}

// Update TopBar call — add onAiConfig prop:
<TopBar
  authenticated={Boolean(isAuthor)}
  githubLogin={me?.githubLogin ?? null}
  onLogout={async () => {
    await logout();
    window.location.assign('/');
  }}
  onToggleSidebar={() => setSidebarOpen((v) => !v)}
  onRefresh={async () => { await queryClient.refetchQueries(); }}
  onImportExport={() => setShowImportExport(true)}
  onAiConfig={() => setShowAiConfig(true)}
/>

// Update MemoTimeline call — add allTags and onFillTagsMemo:
<MemoTimeline
  memos={memos}
  isAuthor={Boolean(isAuthor)}
  isTrash={activeView === 'trash'}
  allTags={allTags.map((t) => t.tag)}
  onOpenMemo={(memo) => window.location.assign(`/memos/${memo.slug}`)}
  onOpenTag={(tag) => window.location.assign(`/tags/${tag}`)}
  onEditMemo={(memo) => window.location.assign(`/memos/${memo.slug}/edit`)}
  onRestoreMemo={(memo) => {
    restoreMemoMutation.mutate(memo.id);
  }}
  onDeleteMemo={(memo) => {
    deleteMemoMutation.mutate(memo.id);
  }}
  onChangeVisibility={(memo, visibility) => {
    updateMemoMutation.mutate({ id: memo.id, input: { visibility } });
  }}
  onFillTagsMemo={(id, newContent) => {
    updateMemoMutation.mutate({ id, input: { content: newContent } });
  }}
/>
```

- [ ] **Step 2: Run all tests**

```bash
cd frontend && npx vitest run
```
Expected: PASS — all tests

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/HomePage.tsx
git commit -m "feat: wire AI config modal and fill-tags into HomePage"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
cd frontend && npx vitest run
```
Expected: all tests PASS, zero failures

- [ ] **TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors
