import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarShell } from '../components/SidebarShell';

describe('SidebarShell tag counts', () => {
  it('shows grouped tag labels and their children with counts in the sidebar', () => {
    render(
      <SidebarShell
        memoCount={10}
        tagCount={4}
        streakDays={12}
        tagTree={{
          groups: [
            { label: '平台', children: [{ name: '网络剪藏', count: 1 }, { name: 'twitter', count: 1 }, { name: '小红书', count: 7 }], count: 9 },
            { label: '类别', children: [{ name: '知识储备', count: 10 }, { name: '投资理财', count: 8 }], count: 644 },
          ],
          flat: [],
        }}
      />,
    );

    expect(screen.getByText('平台')).toBeInTheDocument();
    expect(screen.getByText('类别')).toBeInTheDocument();
    expect(screen.getByText('# 小红书')).toBeInTheDocument();
    expect(screen.getByText('# twitter')).toBeInTheDocument();
    expect(screen.getByText('# 知识储备')).toBeInTheDocument();
  });
});
