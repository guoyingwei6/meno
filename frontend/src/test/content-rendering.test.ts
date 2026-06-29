import { describe, expect, it } from 'vitest';
import { shouldRenderMarkdown } from '../lib/content';

describe('content rendering helpers', () => {
  it('skips markdown rendering for plain text memos', () => {
    expect(shouldRenderMarkdown('今天只是普通文字\n第二行普通文字')).toBe(false);
  });

  it('uses markdown rendering when content contains markdown syntax', () => {
    expect(shouldRenderMarkdown('这里有 **重点** 和 [链接](https://example.com)')).toBe(true);
  });
});
