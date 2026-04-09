import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createTestD1 } from './d1-test-helpers';
import {
  createMemo,
  getDashboardStats,
  getPublicMemoBySlug,
  listAuthorMemos,
  listPublicDateCounts,
  listPublicMemos,
  listPublicTagCounts,
  restoreMemo,
  trashMemo,
} from '../db/memo-repository';

const createTestDb = () => {
  const database = createTestD1();
  applySchema(database);
  return database;
};

describe('memo repository', () => {
  let db: D1Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates and lists public memos from D1', async () => {
    await createMemo(db, {
      slug: 'memo-public-1',
      content: 'Hello #meno',
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    await createMemo(db, {
      slug: 'memo-private-1',
      content: 'Secret #private',
      visibility: 'private',
      displayDate: '2026-03-24',
    });

    const publicMemos = await listPublicMemos(db, {});
    expect(publicMemos).toHaveLength(1);
    expect(publicMemos[0].slug).toBe('memo-public-1');
    expect(publicMemos[0].tags).toEqual(['meno']);
  });

  it('returns public detail by slug and excludes trashed memos', async () => {
    const created = await createMemo(db, {
      slug: 'memo-public-2',
      content: 'Detail #cloudflare',
      visibility: 'public',
      displayDate: '2026-03-23',
    });

    expect((await getPublicMemoBySlug(db, 'memo-public-2'))?.slug).toBe('memo-public-2');

    await trashMemo(db, created.id);
    expect(await getPublicMemoBySlug(db, 'memo-public-2')).toBeNull();

    await restoreMemo(db, created.id);
    expect((await getPublicMemoBySlug(db, 'memo-public-2'))?.slug).toBe('memo-public-2');
  });

  it('aggregates tags, calendar counts and dashboard stats from D1', async () => {
    await createMemo(db, {
      slug: 'memo-public-3',
      content: 'One #meno #cloudflare',
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    await createMemo(db, {
      slug: 'memo-private-2',
      content: 'Three #private-note',
      visibility: 'private',
      displayDate: '2026-03-24',
    });

    expect(await listPublicTagCounts(db)).toEqual([
      { tag: 'cloudflare', count: 1 },
      { tag: 'meno', count: 1 },
    ]);

    expect(await listPublicDateCounts(db)).toEqual([{ date: '2026-03-25', count: 1 }]);

    expect(await getDashboardStats(db)).toEqual({
      total: 2,
      public: 1,
      private: 1,
      trash: 0,
      tags: 2,
      streakDays: expect.any(Number),
    });

    const privateMemos = await listAuthorMemos(db, { view: 'private' });
    expect(privateMemos).toHaveLength(1);
    expect(privateMemos[0].visibility).toBe('private');
  });
});
