import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createMemo, getDashboardStats } from '../db/memo-repository';
import { createTestD1 } from './d1-test-helpers';

describe('dashboard stats streak days', () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestD1();
    applySchema(db);
  });

  it('calculates streak days from distinct display dates', async () => {
    await createMemo(db, {
      slug: 's1',
      content: 'day1',
      visibility: 'public',
      displayDate: '2026-03-25',
    });
    await createMemo(db, {
      slug: 's2',
      content: 'day2',
      visibility: 'private',
      displayDate: '2026-03-24',
    });
    await createMemo(db, {
      slug: 's3',
      content: 'day3',
      visibility: 'draft',
      displayDate: '2026-03-23',
    });

    const stats = await getDashboardStats(db);
    expect(stats.streakDays).toBe(3);
  });
});
