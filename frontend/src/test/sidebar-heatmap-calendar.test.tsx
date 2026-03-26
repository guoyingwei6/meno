import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarShell } from '../components/SidebarShell';

describe('SidebarShell calendar with heatmap', () => {
  it('highlights the selected day and fires onSelectDate', () => {
    const onSelectDate = vi.fn();

    render(
      <SidebarShell
        memoCount={10}
        tagCount={4}
        streakDays={12}
        activeDate="2026-03-16"
        calendarDays={[
          { date: '2026-03-16', count: 3 },
          { date: '2026-03-20', count: 1 },
        ]}
        onSelectDate={onSelectDate}
      />,
    );

    expect(screen.getByRole('button', { name: '16日' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '20日' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-03-20');
  });
});
