import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getAiConfig, setAiConfig, chatCompletionsUrl } from '../lib/ai-config';
import { designTokens, useTheme } from '../lib/theme';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface AiConfigModalProps {
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const getFocusableElements = (container: HTMLElement) => Array.from(
  container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
).filter((element) => {
  const computedStyle = window.getComputedStyle(element);
  return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
});

export const AiConfigModal = ({ onClose }: AiConfigModalProps) => {
  const { isDark } = useTheme();
  const { colors: c, spacing: s, radius: r, shadow, interaction: i } = designTokens(isDark);
  const dialogRef = useRef<HTMLElement>(null);
  const existing = getAiConfig();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [verifyMsg, setVerifyMsg] = useState('');

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement;
    const previouslyFocusedElement = previouslyFocused instanceof HTMLElement ? previouslyFocused : null;
    const dialog = dialogRef.current;
    const firstFocusable = dialog ? getFocusableElements(dialog)[0] : null;
    (firstFocusable ?? dialog)?.focus();

    return () => {
      if (previouslyFocusedElement?.isConnected) previouslyFocusedElement.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = () => {
    setAiConfig({ url: url.trim(), apiKey: apiKey.trim(), model: model.trim() });
    onClose();
  };

  const handleVerify = async () => {
    const u = url.trim();
    const k = apiKey.trim();
    const m = model.trim();
    if (!u || !k || !m) {
      setVerifyStatus('error');
      setVerifyMsg('请填写所有字段');
      return;
    }
    setVerifyStatus('loading');
    setVerifyMsg('');
    try {
      const resp = await fetch(chatCompletionsUrl(u), {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}${text ? ': ' + text.slice(0, 80) : ''}`);
      }
      setVerifyStatus('ok');
      setVerifyMsg('验证成功');
    } catch (e) {
      setVerifyStatus('error');
      setVerifyMsg(e instanceof Error ? e.message : '未知错误');
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(event.currentTarget);
    if (focusableElements.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }

    const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault();
      focusableElements[focusableElements.length - 1].focus();
    } else if (!event.shiftKey && (currentIndex === -1 || currentIndex === focusableElements.length - 1)) {
      event.preventDefault();
      focusableElements[0].focus();
    }
  };

  return (
    <div role="presentation" style={{ ...overlayStyle, background: c.overlay }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI 配置"
        aria-describedby="ai-config-description"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        style={{ ...modalStyle, background: c.cardBg, color: c.textPrimary, borderColor: c.borderMedium, borderRadius: r.lg, padding: s['3xl'], boxShadow: shadow.panel }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: s.xs }}>
          <h3 style={{ margin: 0, fontSize: 16, color: c.textPrimary }}>AI 配置</h3>
          <IconButton label="关闭 AI 配置" onClick={onClose} style={{ fontSize: 20, lineHeight: 1, color: c.textTertiary }}>×</IconButton>
        </div>
        <p id="ai-config-description" style={{ margin: `0 0 ${s['2xl']}px`, fontSize: 13, color: c.textMuted }}>用于「填充标签」功能，兼容 OpenAI 接口</p>

        <label htmlFor="ai-config-url" style={{ ...labelStyle, color: c.textSecondary, marginBottom: s.field }}>API 地址 (Base URL)</label>
        <input
          id="ai-config-url"
          style={{ ...inputStyle, borderColor: c.borderMedium, background: c.inputBg, color: c.textPrimary, borderRadius: r.md, padding: `${s.md}px ${s.inputX}px`, marginBottom: s.fieldBlock, boxShadow: focusedField === 'url' ? i.focusRing : 'none', transition: i.transition }}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setFocusedField('url')}
          onBlur={() => setFocusedField(null)}
          placeholder="https://api.openai.com/v1"
        />

        <label htmlFor="ai-config-key" style={{ ...labelStyle, color: c.textSecondary, marginBottom: s.field }}>API Key</label>
        <input
          id="ai-config-key"
          type="password"
          style={{ ...inputStyle, borderColor: c.borderMedium, background: c.inputBg, color: c.textPrimary, borderRadius: r.md, padding: `${s.md}px ${s.inputX}px`, marginBottom: s.fieldBlock, boxShadow: focusedField === 'apiKey' ? i.focusRing : 'none', transition: i.transition }}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onFocus={() => setFocusedField('apiKey')}
          onBlur={() => setFocusedField(null)}
          placeholder="sk-..."
        />

        <label htmlFor="ai-config-model" style={{ ...labelStyle, color: c.textSecondary, marginBottom: s.field }}>模型</label>
        <input
          id="ai-config-model"
          style={{ ...inputStyle, borderColor: c.borderMedium, background: c.inputBg, color: c.textPrimary, borderRadius: r.md, padding: `${s.md}px ${s.inputX}px`, marginBottom: s.fieldBlock, boxShadow: focusedField === 'model' ? i.focusRing : 'none', transition: i.transition }}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onFocus={() => setFocusedField('model')}
          onBlur={() => setFocusedField(null)}
          placeholder="gpt-4o-mini"
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: s.xs, gap: s.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: s.md, minWidth: 0 }}>
            <Button variant="secondary" onClick={handleVerify} disabled={verifyStatus === 'loading'}>
              {verifyStatus === 'loading' ? '验证中...' : '验证'}
            </Button>
            {verifyStatus === 'ok' && (
              <span style={{ fontSize: 13, color: c.tagColor, fontWeight: 500 }}>✓ {verifyMsg}</span>
            )}
            {verifyStatus === 'error' && (
              <span style={{ fontSize: 12, color: c.danger, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={verifyMsg}>✗ {verifyMsg}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: s.md, flexShrink: 0 }}>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button variant="primary" onClick={handleSave}>保存</Button>
          </div>
        </div>
        <p style={{ margin: `${s.lg}px 0 0`, fontSize: 11, color: c.textMuted }}>
          配置保存于本地 localStorage，不上传服务器
        </p>
      </section>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const modalStyle: React.CSSProperties = {
  width: 420, maxWidth: '95vw', border: '1px solid',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  border: '1px solid', fontSize: 13, outline: 'none',
};
