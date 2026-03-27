import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({ mode: 'auto', setMode: () => {}, isDark: false });

export const useTheme = () => useContext(ThemeContext);

const STORAGE_KEY = 'meno-theme';

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'auto';
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'auto';
  });
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const isDark = mode === 'dark' || (mode === 'auto' && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.colorScheme = 'dark';
    } else {
      root.setAttribute('data-theme', 'light');
      root.style.colorScheme = 'light';
    }
  }, [isDark]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  };

  return <ThemeContext.Provider value={{ mode, setMode, isDark }}>{children}</ThemeContext.Provider>;
};

/* ---------- color tokens ---------- */
export const colors = (dark: boolean) => ({
  // backgrounds
  pageBg: dark ? '#1a1a1a' : '#f7f7f7',
  cardBg: dark ? '#2a2a2a' : '#fff',
  sidebarBg: dark ? '#222' : '#fbfbfb',
  inputBg: dark ? '#333' : '#fff',

  // borders
  border: dark ? '#444' : '#f0f0f0',
  borderMedium: dark ? '#555' : '#e0e0e0',
  borderLight: dark ? '#393939' : '#f5f5f5',

  // text
  textPrimary: dark ? '#e8e8e8' : '#111',
  textSecondary: dark ? '#ccc' : '#444',
  textTertiary: dark ? '#999' : '#666',
  textMuted: dark ? '#777' : '#999',
  textInverse: dark ? '#111' : '#fff',

  // accent
  accent: '#31d266',
  accentLight: dark ? '#2a5e3a' : '#d4f5e0',
  tagColor: '#3aa864',
  goldText: '#d4a34d',

  // misc
  danger: '#e53e3e',
  overlay: dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',
  shadow: dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.08)',
  countColor: dark ? '#888' : '#bbb',
});
