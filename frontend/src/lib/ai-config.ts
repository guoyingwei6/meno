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
