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
