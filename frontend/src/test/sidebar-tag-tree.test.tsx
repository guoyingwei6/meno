import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarShell } from '../components/SidebarShell';

const onSelectTag = vi.fn();

describe('SidebarShell tag tree', () => {
  it('renders nested tags separately and keeps trash at the bottom', () => {
    render(
      <SidebarShell
        memoCount={10}
        tagCount={4}
        tagTree={{
          groups: [
            { label: '平台', children: [{ name: '网络剪藏', count: 1 }, { name: 'twitter', count: 1 }, { name: '小红书', count: 7 }], count: 9 },
            { label: '类别', children: [{ name: '知识储备', count: 10 }, { name: '投资理财', count: 8 }], count: 18 },
          ],
          flat: [],
        }}
        onSelectTag={onSelectTag}
      />,
    );

    expect(screen.getByText('全部标签')).toBeInTheDocument();
    expect(screen.getByText('平台')).toBeInTheDocument();
    expect(screen.getByText('# 网络剪藏')).toBeInTheDocument();
    expect(screen.getByText('# twitter')).toBeInTheDocument();
    expect(screen.getByText('# 小红书')).toBeInTheDocument();
    expect(screen.getByText('类别')).toBeInTheDocument();

    const trashButton = screen.getByRole('button', { name: '回收站' });
    const allTagHeading = screen.getByText('全部标签');
    expect(allTagHeading.compareDocumentPosition(trashButton)).not.toBe(0);

    fireEvent.click(screen.getByText('# 小红书'));
    expect(onSelectTag).toHaveBeenCalledWith('平台/小红书');
  });
});
