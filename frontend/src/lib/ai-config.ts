import type { AiConfig } from '../types/shared';

export type { AiConfig };

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

/** 拼接 chat/completions 端点，兼容用户填完整 URL 的情况 */
export const chatCompletionsUrl = (baseUrl: string): string => {
  const u = baseUrl.replace(/#.*$/, '').replace(/\/+$/, '');
  if (u.endsWith('/chat/completions')) return u;
  return `${u}/chat/completions`;
};
