import { describe, expect, it } from 'vitest';
import { buildTagTree } from '../lib/tag-tree';

describe('buildTagTree counts', () => {
  it('groups slash tags by parent while preserving child labels', () => {
    const result = buildTagTree(['平台/小红书', '平台/twitter', '类别/知识储备']);

    expect(result.groups).toEqual([
      { label: '平台', children: [{ name: '小红书', count: 1 }, { name: 'twitter', count: 1 }], count: 2 },
      { label: '类别', children: [{ name: '知识储备', count: 1 }], count: 1 },
    ]);
    expect(result.flat).toEqual([]);
  });

  it('separates flat tags from hierarchical ones', () => {
    const result = buildTagTree([
      { tag: '平台/小红书', count: 7 },
      { tag: 'misc', count: 3 },
    ]);

    expect(result.groups).toEqual([
      { label: '平台', children: [{ name: '小红书', count: 7 }], count: 7 },
    ]);
    expect(result.flat).toEqual([{ name: 'misc', count: 3 }]);
  });
});
