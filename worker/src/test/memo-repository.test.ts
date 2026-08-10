import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { applySchema } from '../db/schema';
import { createTestD1 } from './d1-test-helpers';
import {
  createMemoWithOutcome,
  createMemo,
  encodeMemoCursor,
  favoriteMemo,
  getDashboardStats,
  getPublicMemoBySlug,
  listAuthorMemos,
  listPublicDateCounts,
  listPublicMemos,
  listPublicTagCounts,
  pinMemo,
  restoreMemo,
  searchAuthorMemos,
  searchPublicMemos,
  trashMemo,
  updateMemo,
} from '../db/memo-repository';

const createTestDb = () => {
  const database = createTestD1();
  applySchema(database);
  return database;
};

const readMigration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url).pathname, 'utf8');

const applyMigrations = (database: D1Database, names: string[]) => {
  for (const name of names) {
    database.exec(readMigration(name));
  }
};

const failOnceOnMemoTagInsert = (database: D1Database): D1Database => {
  let shouldFail = true;
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target, property, receiver) {
      if (property === 'bind') {
        return (...values: unknown[]) => wrapStatement(target.bind(...values));
      }
      if (property === 'run') {
        return () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error('simulated memo tag write failure');
          }
          return target.run();
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          const statement = target.prepare(sql);
          return sql.startsWith('INSERT INTO memo_tags') ? wrapStatement(statement) : statement;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
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
      tags: 3,
      streakDays: expect.any(Number),
    });

    const privateMemos = await listAuthorMemos(db, { view: 'private' });
    expect(privateMemos).toHaveLength(1);
    expect(privateMemos[0].visibility).toBe('private');
  });

  it('returns the existing memo for a repeated client_id', async () => {
    const first = await createMemoWithOutcome(db, {
      slug: 'idempotent-first',
      clientId: 'offline-tab-1',
      content: 'Offline memo #sync',
      visibility: 'private',
      displayDate: '2026-03-25',
    });
    const retry = await createMemoWithOutcome(db, {
      slug: 'idempotent-retry-must-not-win',
      clientId: 'offline-tab-1',
      content: 'Different body must not create a second memo',
      visibility: 'public',
      displayDate: '2026-03-26',
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.memo.id).toBe(first.memo.id);
    expect((await db.prepare('SELECT COUNT(*) as count FROM memos WHERE client_id = ?').bind('offline-tab-1').first<{ count: number }>())?.count).toBe(1);
  });

  it('resolves concurrent client_id retries to one memo', async () => {
    const [left, right] = await Promise.all([
      createMemoWithOutcome(db, {
        slug: 'concurrent-left',
        clientId: 'concurrent-client-id',
        content: 'Left attempt',
        visibility: 'private',
        displayDate: '2026-03-25',
      }),
      createMemoWithOutcome(db, {
        slug: 'concurrent-right',
        clientId: 'concurrent-client-id',
        content: 'Right attempt',
        visibility: 'private',
        displayDate: '2026-03-25',
      }),
    ]);

    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    expect(left.memo.id).toBe(right.memo.id);
    expect((await db.prepare('SELECT COUNT(*) as count FROM memos WHERE client_id = ?').bind('concurrent-client-id').first<{ count: number }>())?.count).toBe(1);
  });

  it('stores a bounded excerpt instead of duplicating long list content', async () => {
    const content = '长'.repeat(300);
    const memo = await createMemo(db, {
      slug: 'bounded-excerpt',
      content,
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    expect(memo.content).toHaveLength(300);
    expect(memo.excerpt).toHaveLength(241);
    expect(memo.excerpt).toBe(`${'长'.repeat(240)}…`);
  });

  it('keeps FTS search synchronized across create, update and trash', async () => {
    const memo = await createMemo(db, {
      slug: 'fts-memo',
      content: '原始搜索词 #fts',
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    expect((await searchPublicMemos(db, '搜索词')).map((item) => item.id)).toContain(memo.id);

    await updateMemo(db, memo.id, { content: '更新后的索引词 #fts' });
    expect((await searchPublicMemos(db, '索引词')).map((item) => item.id)).toContain(memo.id);
    expect((await searchAuthorMemos(db, '原始搜索词')).map((item) => item.id)).not.toContain(memo.id);

    await trashMemo(db, memo.id);
    expect((await searchPublicMemos(db, '索引词')).map((item) => item.id)).not.toContain(memo.id);
  });

  it('keeps memo, tags and search content unchanged if local tag replacement fails', async () => {
    const memo = await createMemo(db, {
      slug: 'atomic-update',
      content: 'Original content #old-tag',
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    await expect(updateMemo(failOnceOnMemoTagInsert(db), memo.id, {
      content: 'Updated content #new-tag',
    })).rejects.toThrow('simulated memo tag write failure');

    const restored = await db.prepare('SELECT content, tag_count FROM memos WHERE id = ?').bind(memo.id).first<{ content: string; tag_count: number }>();
    const tags = await db.prepare('SELECT tag FROM memo_tags WHERE memo_id = ? ORDER BY tag').bind(memo.id).all<{ tag: string }>();
    expect(restored).toEqual({ content: 'Original content #old-tag', tag_count: 1 });
    expect(tags.results).toEqual([{ tag: 'old-tag' }]);
    expect((await searchPublicMemos(db, 'Original content')).map((item) => item.id)).toContain(memo.id);
    expect((await searchPublicMemos(db, 'Updated content')).map((item) => item.id)).not.toContain(memo.id);
  });

  it('keeps FTS triggers compatible with raw local SQLite writes', async () => {
    db.exec(readMigration('008_sync_memo_fts.sql'));
    const now = '2026-03-25T00:00:00.000Z';
    await db.prepare(
      `INSERT INTO memos
       (slug, content, visibility, display_date, created_at, updated_at, published_at, deleted_at,
        previous_visibility, excerpt, has_images, image_count, tag_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, 0, 0)`,
    ).bind('raw-fts', 'raw insert text', 'public', '2026-03-25', now, now, now, 'raw insert text').run();

    expect((await db.prepare('SELECT content, slug, memo_id FROM memos_fts').all()).results).toEqual([
      { content: 'raw insert text', slug: 'raw-fts', memo_id: 1 },
    ]);

    await db.prepare('UPDATE memos SET content = ?, slug = ? WHERE id = 1').bind('raw update text', 'raw-fts-updated').run();
    expect((await db.prepare('SELECT content, slug, memo_id FROM memos_fts').all()).results).toEqual([
      { content: 'raw update text', slug: 'raw-fts-updated', memo_id: 1 },
    ]);

    await db.prepare('DELETE FROM memos WHERE id = 1').run();
    expect((await db.prepare('SELECT rowid FROM memos_fts').all()).results).toEqual([]);
  });

  it('applies client_id and FTS migrations in order on the local adapter', async () => {
    const migratedDb = createTestD1();
    applyMigrations(migratedDb, [
      '001_init.sql',
      '002_add_pinned.sql',
      '003_add_favorited.sql',
      '004_add_memo_image_ocr.sql',
      '005_add_memo_voice_notes.sql',
      '006_add_shares_settings.sql',
      '007_add_client_id_and_feed_indexes.sql',
      '008_sync_memo_fts.sql',
    ]);

    const first = await createMemoWithOutcome(migratedDb, {
      slug: 'migrated-memo',
      clientId: 'migrated-client-id',
      content: 'Migrated memo #migration',
      visibility: 'public',
      displayDate: '2026-03-25',
    });
    const retry = await createMemoWithOutcome(migratedDb, {
      slug: 'migrated-retry',
      clientId: 'migrated-client-id',
      content: 'Must not duplicate',
      visibility: 'public',
      displayDate: '2026-03-25',
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.memo.id).toBe(first.memo.id);
    expect((await migratedDb.prepare('SELECT COUNT(*) as count FROM memos_fts').first<{ count: number }>())?.count).toBe(1);
  });

  it('keeps private favorites in the author favorites view', async () => {
    const memo = await createMemo(db, {
      slug: 'private-favorite',
      content: 'Private favorite',
      visibility: 'private',
      displayDate: '2026-03-25',
    });
    await favoriteMemo(db, memo.id);

    const favorites = await listAuthorMemos(db, { view: 'favorited' });
    expect(favorites.map((item) => item.id)).toContain(memo.id);
  });

  it('applies tag, date, visibility and favorite filters in SQL', async () => {
    const publicMemo = await createMemo(db, {
      slug: 'filtered-public',
      content: 'Public filtered #server-side',
      visibility: 'public',
      displayDate: '2026-03-25',
    });
    const privateMemo = await createMemo(db, {
      slug: 'filtered-private',
      content: 'Private filtered #server-side',
      visibility: 'private',
      displayDate: '2026-03-25',
    });
    await pinMemo(db, publicMemo.id);
    await favoriteMemo(db, privateMemo.id);

    expect((await listPublicMemos(db, { tag: 'server-side', date: '2026-03-25' })).map((item) => item.slug)).toEqual(['filtered-public']);
    expect((await listAuthorMemos(db, { view: 'private', tag: 'server-side', date: '2026-03-25' })).map((item) => item.slug)).toEqual(['filtered-private']);
    expect((await listAuthorMemos(db, { view: 'favorited', tag: 'server-side', date: '2026-03-25' })).map((item) => item.slug)).toEqual(['filtered-private']);
    expect((await listAuthorMemos(db, { view: 'public', tag: 'server-side', date: '2026-03-25' })).map((item) => item.slug)).toEqual(['filtered-public']);
  });

  it('uses a stable keyset cursor when a new memo is inserted before the current page', async () => {
    const first = await createMemo(db, {
      slug: 'cursor-first',
      content: 'First',
      visibility: 'public',
      displayDate: '2026-03-25',
    });
    await createMemo(db, {
      slug: 'cursor-second',
      content: 'Second',
      visibility: 'public',
      displayDate: '2026-03-24',
    });
    await createMemo(db, {
      slug: 'cursor-third',
      content: 'Third',
      visibility: 'public',
      displayDate: '2026-03-23',
    });

    const page = await listPublicMemos(db, { limit: 2 });
    const cursor = encodeMemoCursor(page[1]);
    await createMemo(db, {
      slug: 'cursor-new-top',
      content: 'Inserted later',
      visibility: 'public',
      displayDate: '2026-03-26',
    });
    const nextPage = await listPublicMemos(db, { limit: 2, cursor });

    expect(page.map((memo) => memo.slug)).toEqual(['cursor-first', 'cursor-second']);
    expect(nextPage.map((memo) => memo.slug)).toEqual(['cursor-third']);
  });
});
