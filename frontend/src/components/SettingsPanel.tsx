import { useEffect, useState } from 'react';
import { designTokens, useTheme } from '../lib/theme';
import type { AppSettings } from '../lib/api';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Dialog } from './ui/Dialog';

interface SettingsPanelProps {
  settings: AppSettings;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (input: Pick<AppSettings, 'siteTitle' | 'defaultVisibility'>) => Promise<void>;
}

export const SettingsPanel = ({ settings, saving = false, error = null, onClose, onSave }: SettingsPanelProps) => {
  const { isDark } = useTheme();
  const { colors: c, spacing: s, radius: r } = designTokens(isDark);
  const [siteTitle, setSiteTitle] = useState(settings.siteTitle);
  const [defaultVisibility, setDefaultVisibility] = useState<AppSettings['defaultVisibility']>(settings.defaultVisibility);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setSiteTitle(settings.siteTitle);
    setDefaultVisibility(settings.defaultVisibility);
  }, [settings]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextTitle = siteTitle.trim();
    if (!nextTitle) {
      setValidationError('站点标题不能为空');
      return;
    }
    setValidationError(null);
    try {
      await onSave({ siteTitle: nextTitle, defaultVisibility });
    } catch {
      // The parent exposes the mutation error; keep the panel open for retry.
    }
  };

  return (
    <Dialog ariaLabel="设置" onClose={onClose} overlayStyle={{ padding: s.xl }} panelStyle={{ ...styles.panel, padding: s['2xl'] }}>
        <div style={{ ...styles.header, marginBottom: s.xl }}>
          <h2 style={styles.title}>设置</h2>
          <IconButton label="关闭设置" onClick={onClose} style={{ ...styles.closeButton, color: c.textMuted }}>×</IconButton>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ ...styles.field, gap: s.field, marginBottom: s.fieldBlock }}>
            <span>站点标题</span>
            <input
              aria-label="站点标题"
              value={siteTitle}
              maxLength={80}
              onChange={(event) => setSiteTitle(event.target.value)}
              style={{ ...styles.input, background: c.inputBg, color: c.textPrimary, borderColor: c.borderMedium, borderRadius: r.md, padding: `${s.md}px ${s.inputX}px` }}
            />
          </label>
          <label style={{ ...styles.field, gap: s.field, marginBottom: s.fieldBlock }}>
            <span>新建 Memo 默认可见性</span>
            <select
              aria-label="新建 Memo 默认可见性"
              value={defaultVisibility}
              onChange={(event) => setDefaultVisibility(event.target.value as AppSettings['defaultVisibility'])}
              style={{ ...styles.input, background: c.inputBg, color: c.textPrimary, borderColor: c.borderMedium, borderRadius: r.md, padding: `${s.md}px ${s.inputX}px` }}
            >
              <option value="private">私密</option>
              <option value="public">公开</option>
            </select>
          </label>
          {validationError || error ? <div role="alert" style={styles.error}>{validationError || error}</div> : null}
          <div style={{ ...styles.actions, gap: s.md, marginTop: s['2xl'] }}>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saving ? '保存中...' : '保存设置'}</Button>
          </div>
        </form>
    </Dialog>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 'min(100%, 420px)',
    border: '1px solid',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { margin: 0, fontSize: 18 },
  closeButton: { fontSize: 24, lineHeight: 1 },
  field: { display: 'grid', fontSize: 14 },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid', fontSize: 14 },
  error: { marginBottom: 12, color: '#c24b4b', fontSize: 13 },
  actions: { display: 'flex', justifyContent: 'flex-end' },
};
