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
