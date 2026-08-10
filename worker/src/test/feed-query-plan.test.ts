import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestD1 } from './d1-test-helpers';

const migrationNames = [
  '001_init.sql',
  '002_add_pinned.sql',
  '003_add_favorited.sql',
  '004_add_memo_image_ocr.sql',
  '005_add_memo_voice_notes.sql',
  '006_add_shares_settings.sql',
  '007_add_client_id_and_feed_indexes.sql',
];

const getPlan = async (db: D1Database, sql: string) => {
  const { results } = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<Record<string, unknown>>();
  return (results ?? []).map((row) => String(row.detail ?? '')).join('\n');
};

describe('feed composite-index migrations', () => {
  it('uses the real 007 public and author feed indexes without a temporary sort', async () => {
    const db = createTestD1();
    for (const name of migrationNames) {
      db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url).pathname, 'utf8'));
    }

    const publicPlan = await getPlan(
      db,
      `SELECT id
       FROM memos
       WHERE visibility = 'public' AND deleted_at IS NULL
       ORDER BY pinned_at IS NULL ASC, pinned_at DESC, display_date DESC, created_at DESC, id DESC
       LIMIT 20`,
    );
    expect(publicPlan).toContain('idx_memos_public_feed');
    expect(publicPlan).not.toContain('USE TEMP B-TREE FOR ORDER BY');

    const authorPlan = await getPlan(
      db,
      `SELECT id
       FROM memos
       WHERE deleted_at IS NULL
       ORDER BY pinned_at IS NULL ASC, pinned_at DESC, display_date DESC, created_at DESC, id DESC
       LIMIT 20`,
    );
    expect(authorPlan).toContain('idx_memos_author_feed');
    expect(authorPlan).not.toContain('USE TEMP B-TREE FOR ORDER BY');
  });
});
