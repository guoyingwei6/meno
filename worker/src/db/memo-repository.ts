import type { MemoDetail, MemoSummary, MemoVisibility } from '../types';
import { parseTags } from '../lib/tag-parser';

interface CreateMemoInput {
  slug: string;
  content: string;
  visibility: MemoVisibility;
  displayDate: string;
}

interface AuthorViewQuery {
  view: 'all' | 'public' | 'private' | 'trash' | 'favorited';
  date?: string;
}

const mapMemoRow = (row: Record<string, unknown>): MemoSummary => ({
  id: Number(row.id),
  slug: String(row.slug),
  content: String(row.content),
  excerpt: String(row.excerpt),
  visibility: row.visibility as MemoVisibility,
  displayDate: String(row.display_date),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  publishedAt: row.published_at ? String(row.published_at) : null,
  deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  pinnedAt: row.pinned_at ? String(row.pinned_at) : null,
  favoritedAt: row.favorited_at ? String(row.favorited_at) : null,
  previousVisibility: row.previous_visibility ? (String(row.previous_visibility) as MemoVisibility) : null,
  hasImages: Boolean(row.has_images),
  imageCount: Number(row.image_count),
  tagCount: Number(row.tag_count),
  tags: [],
});

const attachTags = async (db: D1Database, memos: MemoSummary[]) => {
  if (memos.length === 0) {
    return memos;
  }

  const ids = memos.map((memo) => memo.id);
  const tagsByMemo = new Map<number, string[]>();

  // D1 limits bound parameters to 100 per query; batch in chunks of 99
  const CHUNK = 99;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db.prepare(`SELECT memo_id, tag FROM memo_tags WHERE memo_id IN (${placeholders}) ORDER BY tag ASC`).bind(...chunk).all();
    for (const row of results ?? []) {
      const memoId = Number((row as Record<string, unknown>).memo_id);
      const tag = String((row as Record<string, unknown>).tag);
      const current = tagsByMemo.get(memoId) ?? [];
      current.push(tag);
      tagsByMemo.set(memoId, current);
    }
  }

  return memos.map((memo) => ({ ...memo, tags: tagsByMemo.get(memo.id) ?? [] }));
};

export const createMemo = async (db: D1Database, input: CreateMemoInput): Promise<MemoDetail> => {
  const now = new Date().toISOString();
  const tags = parseTags(input.content);
  const excerpt = input.content;
  const publishedAt = input.visibility === 'public' ? now : null;
  const imageMatches = input.content.match(/!\[.*?\]\(.*?\)/g) || [];
  const imageCount = imageMatches.length;
  const hasImages = imageCount > 0 ? 1 : 0;

  const created = await db
    .prepare(
      `INSERT INTO memos (slug, content, visibility, display_date, created_at, updated_at, published_at, deleted_at, previous_visibility, excerpt, has_images, image_count, tag_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(input.slug, input.content, input.visibility, input.displayDate, now, now, publishedAt, excerpt, hasImages, imageCount, tags.length)
    .first<Record<string, unknown>>();

  if (!created) {
    throw new Error('Failed to create memo');
  }

  const memo = mapMemoRow(created);

  for (const tag of tags) {
    await db.prepare('INSERT INTO memo_tags (memo_id, tag) VALUES (?, ?)').bind(memo.id, tag).run();
  }

  return { ...memo, tags, assets: [] };
};

export const listPublicMemos = async (db: D1Database, query: { tag?: string; date?: string }): Promise<MemoSummary[]> => {
  const clauses = ['visibility = ?', 'deleted_at IS NULL'];
  const params: unknown[] = ['public'];

  if (query.date) {
    clauses.push('display_date = ?');
    params.push(query.date);
  }

  if (query.tag) {
    clauses.push('id IN (SELECT memo_id FROM memo_tags WHERE tag = ?)');
    params.push(query.tag);
  }

  const { results } = await db
    .prepare(`SELECT * FROM memos WHERE ${clauses.join(' AND ')} ORDER BY pinned_at IS NULL ASC, pinned_at DESC, display_date DESC, created_at DESC`)
    .bind(...params)
    .all();

  return attachTags(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const searchPublicMemos = async (db: D1Database, q: string): Promise<MemoSummary[]> => {
  const pattern = `%${q}%`;
  const { results } = await db
    .prepare('SELECT * FROM memos WHERE visibility = ? AND deleted_at IS NULL AND content LIKE ? ORDER BY display_date DESC, created_at DESC LIMIT 50')
    .bind('public', pattern)
    .all();
  return attachTags(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const searchAuthorMemos = async (db: D1Database, q: string): Promise<MemoSummary[]> => {
  const pattern = `%${q}%`;
  const { results } = await db
    .prepare('SELECT * FROM memos WHERE deleted_at IS NULL AND content LIKE ? ORDER BY display_date DESC, created_at DESC LIMIT 50')
    .bind(pattern)
    .all();
  return attachTags(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const getPublicMemoBySlug = async (db: D1Database, slug: string): Promise<MemoDetail | null> => {
  const row = await db
    .prepare('SELECT * FROM memos WHERE slug = ? AND visibility = ? AND deleted_at IS NULL LIMIT 1')
    .bind(slug, 'public')
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const getAuthorMemoBySlug = async (db: D1Database, slug: string): Promise<MemoDetail | null> => {
  const row = await db.prepare('SELECT * FROM memos WHERE slug = ? AND deleted_at IS NULL LIMIT 1').bind(slug).first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const getAuthorMemoById = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const updateMemo = async (
  db: D1Database,
  id: number,
  input: { content?: string; visibility?: MemoVisibility; displayDate?: string },
): Promise<MemoDetail | null> => {
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (input.content !== undefined) {
    const tags = parseTags(input.content);
    const imgMatches = input.content.match(/!\[.*?\]\(.*?\)/g) || [];
    sets.push('content = ?', 'excerpt = ?', 'tag_count = ?', 'has_images = ?', 'image_count = ?');
    params.push(input.content, input.content, tags.length, imgMatches.length > 0 ? 1 : 0, imgMatches.length);

    // Rebuild tags
    await db.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(id).run();
    for (const tag of tags) {
      await db.prepare('INSERT INTO memo_tags (memo_id, tag) VALUES (?, ?)').bind(id, tag).run();
    }
  }

  if (input.visibility !== undefined) {
    sets.push('visibility = ?');
    params.push(input.visibility);
    if (input.visibility === 'public') {
      sets.push('published_at = COALESCE(published_at, ?)');
      params.push(now);
    }
  }

  if (input.displayDate !== undefined) {
    sets.push('display_date = ?');
    params.push(input.displayDate);
  }

  params.push(id);
  await db.prepare(`UPDATE memos SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...params).run();

  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;

  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const pinMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const now = new Date().toISOString();
  await db.prepare('UPDATE memos SET pinned_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const unpinMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  await db.prepare('UPDATE memos SET pinned_at = NULL WHERE id = ? AND deleted_at IS NULL').bind(id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const favoriteMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const now = new Date().toISOString();
  await db.prepare('UPDATE memos SET favorited_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const unfavoriteMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  await db.prepare('UPDATE memos SET favorited_at = NULL WHERE id = ? AND deleted_at IS NULL').bind(id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const trashMemo = async (db: D1Database, id: number): Promise<boolean> => {
  const now = new Date().toISOString();
  const result = await db
    .prepare('UPDATE memos SET previous_visibility = visibility, deleted_at = ? WHERE id = ?')
    .bind(now, id)
    .run();

  return (result.meta?.changes ?? 0) > 0;
};

export const restoreMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  await db.prepare('UPDATE memos SET deleted_at = NULL, visibility = COALESCE(previous_visibility, visibility) WHERE id = ?').bind(id).run();

  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) {
    return null;
  }

  const [memo] = await attachTags(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const purgeOldTrash = async (db: D1Database, r2: R2Bucket): Promise<number> => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await db
    .prepare('SELECT id, content FROM memos WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .bind(cutoff)
    .all<{ id: number; content: string }>();

  if (!results || results.length === 0) return 0;

  for (const row of results) {
    // Extract image URLs and delete from R2
    const imgRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = imgRegex.exec(row.content)) !== null) {
      const url = match[1];
      // Extract object key from URL (after /assets/ or /api/assets/)
      const keyMatch = url.match(/\/(?:api\/)?assets\/(.+)/);
      if (keyMatch) {
        await r2.delete(keyMatch[1]);
      }
    }
    await db.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(row.id).run();
    await db.prepare('DELETE FROM memos WHERE id = ?').bind(row.id).run();
  }

  return results.length;
};

const countChars = (content: string): number => {
  return content
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/[#*_~`>\-\[\]()]/g, '')
    .trim()
    .length;
};

export const getRecordStats = async (db: D1Database, _authorMode: boolean) => {
  const vis = "visibility = 'public' AND deleted_at IS NULL";

  const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM memos WHERE ${vis}`).first<{ c: number }>();
  const activeDaysRow = await db.prepare(`SELECT COUNT(DISTINCT display_date) as c FROM memos WHERE ${vis}`).first<{ c: number }>();
  const maxDailyMemosRow = await db.prepare(
    `SELECT MAX(cnt) as c FROM (SELECT COUNT(*) as cnt FROM memos WHERE ${vis} GROUP BY display_date)`,
  ).first<{ c: number }>();

  const { results: contentRows } = await db.prepare(
    `SELECT content, display_date FROM memos WHERE ${vis}`,
  ).all();

  let totalWords = 0;
  const dailyWords = new Map<string, number>();
  for (const row of contentRows ?? []) {
    const wc = countChars(String((row as Record<string, unknown>).content));
    const date = String((row as Record<string, unknown>).display_date);
    totalWords += wc;
    dailyWords.set(date, (dailyWords.get(date) ?? 0) + wc);
  }
  const maxDailyWords = dailyWords.size > 0 ? Math.max(...dailyWords.values()) : 0;

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const heatmapStart = oneYearAgo.toISOString().slice(0, 10);

  const { results: heatmapRows } = await db.prepare(
    `SELECT display_date as date, COUNT(*) as count FROM memos WHERE ${vis} AND display_date >= ? GROUP BY display_date ORDER BY display_date`,
  ).bind(heatmapStart).all();

  const heatmap = (heatmapRows ?? []).map((row) => ({
    date: String((row as Record<string, unknown>).date),
    count: Number((row as Record<string, unknown>).count),
  }));

  const yearMemos = heatmap.reduce((sum, d) => sum + d.count, 0);

  return {
    totalMemos: totalRow?.c ?? 0,
    totalWords,
    maxDailyMemos: maxDailyMemosRow?.c ?? 0,
    maxDailyWords,
    activeDays: activeDaysRow?.c ?? 0,
    yearMemos,
    heatmap,
  };
};

export const listPublicTagCounts = async (db: D1Database): Promise<Array<{ tag: string; count: number }>> => {
  const { results } = await db
    .prepare(
      `SELECT memo_tags.tag as tag, COUNT(*) as count
       FROM memo_tags
       INNER JOIN memos ON memos.id = memo_tags.memo_id
       WHERE memos.visibility = 'public' AND memos.deleted_at IS NULL
       GROUP BY memo_tags.tag
       ORDER BY memo_tags.tag ASC`,
    )
    .all();

  return (results ?? []).map((row) => ({
    tag: String((row as Record<string, unknown>).tag),
    count: Number((row as Record<string, unknown>).count),
  }));
};

export const listPublicDateCounts = async (db: D1Database): Promise<Array<{ date: string; count: number }>> => {
  const { results } = await db
    .prepare(
      `SELECT display_date as date, COUNT(*) as count
       FROM memos
       WHERE visibility = 'public' AND deleted_at IS NULL
       GROUP BY display_date
       ORDER BY display_date ASC`,
    )
    .all();

  return (results ?? []).map((row) => ({
    date: String((row as Record<string, unknown>).date),
    count: Number((row as Record<string, unknown>).count),
  }));
};

export const listAuthorDateCounts = async (db: D1Database): Promise<Array<{ date: string; count: number }>> => {
  const { results } = await db
    .prepare(
      `SELECT display_date as date, COUNT(*) as count
       FROM memos
       WHERE deleted_at IS NULL AND visibility = 'public'
       GROUP BY display_date
       ORDER BY display_date ASC`,
    )
    .all();

  return (results ?? []).map((row) => ({
    date: String((row as Record<string, unknown>).date),
    count: Number((row as Record<string, unknown>).count),
  }));
};

export const getPublicStats = async (db: D1Database): Promise<{ total: number; tags: number; streakDays: number }> => {
  const total = await db.prepare("SELECT COUNT(*) as count FROM memos WHERE visibility = 'public' AND deleted_at IS NULL").first<{ count: number }>();
  const tags = await db
    .prepare(
      `SELECT COUNT(DISTINCT memo_tags.tag) as count
       FROM memo_tags
       INNER JOIN memos ON memos.id = memo_tags.memo_id
       WHERE memos.visibility = 'public' AND memos.deleted_at IS NULL`,
    )
    .first<{ count: number }>();
  const span = await db
    .prepare("SELECT CAST((julianday('now') - julianday(MIN(display_date))) AS INTEGER) + 1 as days FROM memos WHERE visibility = 'public' AND deleted_at IS NULL")
    .first<{ days: number }>();

  return {
    total: total?.count ?? 0,
    tags: tags?.count ?? 0,
    streakDays: span?.days ?? 0,
  };
};

export const listAuthorMemos = async (db: D1Database, query: AuthorViewQuery): Promise<MemoSummary[]> => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.view === 'trash') {
    clauses.push('deleted_at IS NOT NULL');
  } else if (query.view === 'favorited') {
    clauses.push('deleted_at IS NULL');
    clauses.push('favorited_at IS NOT NULL');
    clauses.push("visibility = 'public'");
  } else {
    clauses.push('deleted_at IS NULL');
    if (query.view !== 'all') {
      clauses.push('visibility = ?');
      params.push(query.view);
    }
  }

  if (query.date) {
    clauses.push('display_date = ?');
    params.push(query.date);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await db.prepare(`SELECT * FROM memos ${where} ORDER BY pinned_at IS NULL ASC, pinned_at DESC, display_date DESC, created_at DESC`).bind(...params).all();

  return attachTags(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const listKnowledgeBaseMemos = async (db: D1Database): Promise<MemoSummary[]> => {
  const { results } = await db
    .prepare(
      "SELECT * FROM memos WHERE deleted_at IS NULL AND visibility = 'public' ORDER BY id ASC",
    )
    .all();

  return attachTags(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const searchKnowledgeBaseMemosByTerms = async (db: D1Database, terms: string[]): Promise<MemoSummary[]> => {
  const normalizedTerms = terms.map((term) => term.trim()).filter(Boolean);
  if (normalizedTerms.length === 0) {
    return [];
  }

  const clauses = normalizedTerms.map(() => (
    `(content LIKE ? ESCAPE '\\'
      OR slug LIKE ? ESCAPE '\\'
      OR id IN (
        SELECT memo_id
        FROM memo_tags
        WHERE tag LIKE ? ESCAPE '\\'
      ))`
  ));

  const params: string[] = [];
  for (const term of normalizedTerms) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(pattern, pattern, pattern);
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM memos
       WHERE deleted_at IS NULL
         AND visibility = 'public'
         AND (${clauses.join(' OR ')})
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 60`,
    )
    .bind(...params)
    .all();

  return attachTags(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const listAuthorTagCounts = async (db: D1Database): Promise<Array<{ tag: string; count: number }>> => {
  const { results } = await db
    .prepare(
      `SELECT memo_tags.tag as tag, COUNT(*) as count
       FROM memo_tags
       INNER JOIN memos ON memos.id = memo_tags.memo_id
       WHERE memos.visibility = 'public' AND memos.deleted_at IS NULL
       GROUP BY memo_tags.tag
       ORDER BY memo_tags.tag ASC`,
    )
    .all();

  return (results ?? []).map((row) => ({
    tag: String((row as Record<string, unknown>).tag),
    count: Number((row as Record<string, unknown>).count),
  }));
};

export const getDashboardStats = async (db: D1Database): Promise<{
  total: number;
  public: number;
  private: number;
  trash: number;
  tags: number;
  streakDays: number;
}> => {
  const total = await db.prepare("SELECT COUNT(*) as count FROM memos WHERE deleted_at IS NULL").first<{ count: number }>();
  const publicCount = await db.prepare("SELECT COUNT(*) as count FROM memos WHERE visibility = 'public' AND deleted_at IS NULL").first<{ count: number }>();
  const privateCount = await db.prepare("SELECT COUNT(*) as count FROM memos WHERE visibility = 'private' AND deleted_at IS NULL").first<{ count: number }>();
  const trashCount = await db.prepare("SELECT COUNT(*) as count FROM memos WHERE deleted_at IS NOT NULL").first<{ count: number }>();
  const tagsCount = await db
    .prepare(
      `SELECT COUNT(DISTINCT memo_tags.tag) as count
       FROM memo_tags
       INNER JOIN memos ON memos.id = memo_tags.memo_id
       WHERE memos.visibility = 'public' AND memos.deleted_at IS NULL`,
    )
    .first<{ count: number }>();
  const spanRow = await db
    .prepare("SELECT CAST((julianday('now') - julianday(MIN(display_date))) AS INTEGER) + 1 as days FROM memos WHERE visibility = 'public' AND deleted_at IS NULL")
    .first<{ days: number }>();

  return {
    total: total?.count ?? 0,
    public: publicCount?.count ?? 0,
    private: privateCount?.count ?? 0,
    trash: trashCount?.count ?? 0,
    tags: tagsCount?.count ?? 0,
    streakDays: spanRow?.days ?? 0,
  };
};

export const backupMemosToR2 = async (db: D1Database, r2: R2Bucket, keepDays = 365): Promise<void> => {
  // Export all memos (including trashed) with their tags
  const { results: memoRows } = await db
    .prepare('SELECT id, slug, content, visibility, display_date, created_at, updated_at, deleted_at FROM memos ORDER BY id ASC')
    .all();

  const ids = (memoRows ?? []).map((r) => Number((r as Record<string, unknown>).id));
  const tagsByMemo = new Map<number, string[]>();

  const CHUNK = 99;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results: tagRows } = await db
      .prepare(`SELECT memo_id, tag FROM memo_tags WHERE memo_id IN (${placeholders}) ORDER BY tag ASC`)
      .bind(...chunk)
      .all();
    for (const row of tagRows ?? []) {
      const mid = Number((row as Record<string, unknown>).memo_id);
      const tag = String((row as Record<string, unknown>).tag);
      const arr = tagsByMemo.get(mid) ?? [];
      arr.push(tag);
      tagsByMemo.set(mid, arr);
    }
  }

  const memos = (memoRows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const id = Number(row.id);
    return {
      id,
      slug: String(row.slug),
      content: String(row.content),
      visibility: String(row.visibility),
      displayDate: String(row.display_date),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
      tags: tagsByMemo.get(id) ?? [],
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const key = `backups/${today}.json`;
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), count: memos.length, memos });
  await r2.put(key, body, { httpMetadata: { contentType: 'application/json' } });

  // Delete backups older than keepDays
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const list = await r2.list({ prefix: 'backups/' });
  for (const obj of list.objects) {
    const dateStr = obj.key.slice('backups/'.length, 'backups/'.length + 10);
    if (dateStr < cutoffStr) {
      await r2.delete(obj.key);
    }
  }
};

const PARAMETER_CHUNK_SIZE = 99;

const escapeTagRegex = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeLikeValue = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const getAffectedMemoIds = async (db: D1Database, tag: string): Promise<number[]> => {
  const tagPrefix = `${escapeLikeValue(tag)}/%`;
  const { results } = await db
    .prepare("SELECT DISTINCT memo_id FROM memo_tags WHERE tag = ? OR tag LIKE ? ESCAPE '\\' ORDER BY memo_id ASC")
    .bind(tag, tagPrefix)
    .all<{ memo_id: number }>();

  return (results ?? []).map((row) => Number(row.memo_id));
};

const updateMemoContentAndMetadata = async (
  db: D1Database,
  memoIds: number[],
  transform: (content: string) => string,
) => {
  for (let i = 0; i < memoIds.length; i += PARAMETER_CHUNK_SIZE) {
    const chunk = memoIds.slice(i, i + PARAMETER_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, content FROM memos WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: number; content: string }>();

    for (const row of results ?? []) {
      const nextContent = transform(String(row.content));
      const tags = parseTags(nextContent);
      await db
        .prepare('UPDATE memos SET content = ?, excerpt = ?, tag_count = ? WHERE id = ?')
        .bind(nextContent, nextContent, tags.length, Number(row.id))
        .run();
    }
  }
};

export const renameTag = async (db: D1Database, oldTag: string, newTag: string): Promise<number> => {
  const affectedMemoIds = await getAffectedMemoIds(db, oldTag);
  if (affectedMemoIds.length === 0) {
    return 0;
  }
  const oldTagPrefix = `${escapeLikeValue(oldTag)}/%`;

  await db
    .prepare(
      `DELETE FROM memo_tags
       WHERE tag = ?
         AND EXISTS (
           SELECT 1
           FROM memo_tags AS existing_tags
           WHERE existing_tags.memo_id = memo_tags.memo_id
             AND existing_tags.tag = ?
         )`,
    )
    .bind(oldTag, newTag)
    .run();

  await db.prepare('UPDATE memo_tags SET tag = ? WHERE tag = ?').bind(newTag, oldTag).run();

  await db
    .prepare(
      `DELETE FROM memo_tags
       WHERE tag LIKE ? ESCAPE '\\'
         AND EXISTS (
           SELECT 1
           FROM memo_tags AS existing_tags
           WHERE existing_tags.memo_id = memo_tags.memo_id
             AND existing_tags.tag = ? || substr(memo_tags.tag, ?)
         )`,
    )
    .bind(oldTagPrefix, newTag, oldTag.length + 1)
    .run();

  await db
    .prepare("UPDATE memo_tags SET tag = ? || substr(tag, ?) WHERE tag LIKE ? ESCAPE '\\'")
    .bind(newTag, oldTag.length + 1, oldTagPrefix)
    .run();

  const escapedOldTag = escapeTagRegex(oldTag);
  const childPattern = new RegExp(`(^|\\s)#${escapedOldTag}((?:\\/[\\p{L}\\p{N}_-]+)+)(?=\\s|$)`, 'gu');
  const exactPattern = new RegExp(`(^|\\s)#${escapedOldTag}(?=\\s|$)`, 'gu');

  await updateMemoContentAndMetadata(db, affectedMemoIds, (content) =>
    content.replace(childPattern, `$1#${newTag}$2`).replace(exactPattern, `$1#${newTag}`),
  );

  return affectedMemoIds.length;
};

export const deleteTag = async (db: D1Database, tag: string, deleteNotes: boolean): Promise<number> => {
  const tagPrefix = `${escapeLikeValue(tag)}/%`;

  if (deleteNotes) {
    const now = new Date().toISOString();
    const { results } = await db
      .prepare(
        `SELECT DISTINCT memos.id
         FROM memos
         INNER JOIN memo_tags ON memo_tags.memo_id = memos.id
         WHERE memos.deleted_at IS NULL
           AND (memo_tags.tag = ? OR memo_tags.tag LIKE ? ESCAPE '\\')`,
      )
      .bind(tag, tagPrefix)
      .all<{ id: number }>();

    const memoIds = (results ?? []).map((row) => Number(row.id));
    if (memoIds.length === 0) {
      return 0;
    }

    for (let i = 0; i < memoIds.length; i += PARAMETER_CHUNK_SIZE) {
      const chunk = memoIds.slice(i, i + PARAMETER_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      await db
        .prepare(`UPDATE memos SET previous_visibility = visibility, deleted_at = ? WHERE id IN (${placeholders})`)
        .bind(now, ...chunk)
        .run();
    }

    return memoIds.length;
  }

  const affectedMemoIds = await getAffectedMemoIds(db, tag);
  if (affectedMemoIds.length === 0) {
    return 0;
  }

  await db.prepare("DELETE FROM memo_tags WHERE tag = ? OR tag LIKE ? ESCAPE '\\'").bind(tag, tagPrefix).run();

  const escapedTag = escapeTagRegex(tag);
  const childPattern = new RegExp(`(^|\\s)#${escapedTag}(?:\\/[\\p{L}\\p{N}_-]+)+(?=\\s|$)`, 'gu');
  const exactPattern = new RegExp(`(^|\\s)#${escapedTag}(?=\\s|$)`, 'gu');

  await updateMemoContentAndMetadata(db, affectedMemoIds, (content) =>
    content.replace(childPattern, '$1').replace(exactPattern, '$1'),
  );

  return affectedMemoIds.length;
};
