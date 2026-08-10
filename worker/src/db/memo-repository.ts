import type { MemoDetail, MemoSummary, MemoVisibility } from '../../../shared/src/types';
import { parseTags } from '../lib/tag-parser';
import { attachMemoVoiceNotes } from './memo-voice-note-repository';
import { HTTPException } from 'hono/http-exception';

interface CreateMemoInput {
  slug: string;
  content: string;
  visibility: MemoVisibility;
  displayDate: string;
  /** Stable id supplied by offline clients. Null/undefined preserves one-shot semantics. */
  clientId?: string;
}

interface PaginationQuery {
  limit?: number;
  cursor?: string;
  sort?: MemoSort;
}

interface MemoListQuery extends PaginationQuery {
  date?: string;
  tag?: string;
  hasImages?: boolean;
  hasTags?: boolean;
}

interface AuthorViewQuery extends MemoListQuery {
  view: 'all' | 'public' | 'private' | 'trash' | 'favorited';
}

export type MemoSort = 'display-desc' | 'display-asc' | 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc';
export const DEFAULT_MEMO_SORT: MemoSort = 'display-desc';

export interface MemoCursor {
  sort: MemoSort;
  sortValue: string;
  secondaryValue: string;
  pinnedAt: string | null;
  displayDate: string;
  createdAt: string;
  updatedAt: string;
  id: number;
}

const EXCERPT_LENGTH = 240;
export const MAX_MEMO_IMAGES = 8;
const MEMO_IMAGE_PATTERN = /!\[.*?\]\(.*?\)/g;

const escapeLikeValue = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

const buildFtsQuery = (value: string): string => value
  .trim()
  .split(/\s+/)
  .map((token) => token.replace(/[\u0000-\u001f"'*^():{}\[\]]/g, '').trim())
  .filter(Boolean)
  .map((token) => `"${token.replace(/"/g, '""')}"*`)
  .join(' AND ');

const createExcerpt = (content: string): string => {
  const chars = Array.from(content);
  if (chars.length <= EXCERPT_LENGTH) {
    return content;
  }
  return `${chars.slice(0, EXCERPT_LENGTH).join('')}…`;
};

export const countMemoImages = (content: string): number => content.match(MEMO_IMAGE_PATTERN)?.length ?? 0;

/** Validate the content-level image limit before any memo or tag write. */
export const validateMemoImageCount = (content: string): number => {
  const imageCount = countMemoImages(content);
  if (imageCount > MAX_MEMO_IMAGES) {
    throw new HTTPException(400, { message: `A memo can contain at most ${MAX_MEMO_IMAGES} images` });
  }
  return imageCount;
};

export const normalizeClientId = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('client_id must be a string');
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 128) {
    throw new Error('client_id must contain 1 to 128 characters');
  }
  return normalized;
};

export const isMemoSort = (value: string | undefined): value is MemoSort => (
  value === 'display-desc'
  || value === 'display-asc'
  || value === 'created-desc'
  || value === 'created-asc'
  || value === 'updated-desc'
  || value === 'updated-asc'
);

const getSortDefinition = (sort: MemoSort): {
  field: 'display_date' | 'created_at' | 'updated_at';
  direction: 'ASC' | 'DESC';
  secondaryField: 'created_at' | 'id';
} => {
  switch (sort) {
    case 'display-asc':
      return { field: 'display_date', direction: 'ASC' as const, secondaryField: 'created_at' };
    case 'created-desc':
      return { field: 'created_at', direction: 'DESC' as const, secondaryField: 'id' };
    case 'created-asc':
      return { field: 'created_at', direction: 'ASC' as const, secondaryField: 'id' };
    case 'updated-desc':
      return { field: 'updated_at', direction: 'DESC' as const, secondaryField: 'created_at' };
    case 'updated-asc':
      return { field: 'updated_at', direction: 'ASC' as const, secondaryField: 'created_at' };
    case 'display-desc':
    default:
      return { field: 'display_date', direction: 'DESC' as const, secondaryField: 'created_at' };
  }
};

/** Opaque, URL-safe cursor for the feed's complete sort tuple. */
export const encodeMemoCursor = (
  memo: Pick<MemoSummary, 'pinnedAt' | 'displayDate' | 'createdAt' | 'updatedAt' | 'id'>,
  sort: MemoSort = DEFAULT_MEMO_SORT,
): string => {
  const definition = getSortDefinition(sort);
  const sortValue = sort.startsWith('display') ? memo.displayDate : sort.startsWith('created') ? memo.createdAt : memo.updatedAt;
  const secondaryValue = definition.secondaryField === 'id'
    ? String(memo.id)
    : definition.secondaryField === 'created_at'
      ? memo.createdAt
      : memo.updatedAt;
  const payload: MemoCursor = {
    sort,
    sortValue,
    secondaryValue,
    pinnedAt: memo.pinnedAt,
    displayDate: memo.displayDate,
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
    id: memo.id,
  };
  return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const decodeMemoCursor = (value: string | undefined): MemoCursor | null => {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded)) as Partial<MemoCursor> & { sort?: string };
    const sort = parsed.sort === undefined ? DEFAULT_MEMO_SORT : parsed.sort;
    if (
      isMemoSort(sort)
      &&
      (parsed.pinnedAt === undefined || parsed.pinnedAt === null || typeof parsed.pinnedAt === 'string')
      && typeof parsed.displayDate === 'string'
      && typeof parsed.createdAt === 'string'
      && (parsed.updatedAt === undefined || typeof parsed.updatedAt === 'string')
      && Number.isInteger(parsed.id)
      && Number(parsed.id) > 0
    ) {
      const sortValue = typeof parsed.sortValue === 'string'
        ? parsed.sortValue
        : sort.startsWith('display')
          ? parsed.displayDate
          : sort.startsWith('created')
            ? parsed.createdAt
            : parsed.updatedAt;
      const secondaryValue = typeof parsed.secondaryValue === 'string'
        ? parsed.secondaryValue
        : getSortDefinition(sort).secondaryField === 'id'
          ? String(parsed.id)
          : parsed.createdAt;
      if (typeof sortValue !== 'string' || typeof secondaryValue !== 'string') return null;
      return {
        sort,
        sortValue,
        secondaryValue,
        pinnedAt: parsed.pinnedAt ?? null,
        displayDate: parsed.displayDate,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt ?? parsed.createdAt,
        id: Number(parsed.id),
      };
    }
  } catch {
    // Invalid cursors are treated as the first page. They never become an OFFSET.
  }
  return null;
};

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

const attachRelations = async (db: D1Database, memos: MemoSummary[]) => {
  // Both relation lookups are set-based. Run the two independent reads together
  // so a 20-item feed still needs two D1 rounds instead of serial rounds.
  const [taggedMemos, voiceMemos] = await Promise.all([
    attachTags(db, memos),
    attachMemoVoiceNotes(db, memos),
  ]);
  const voicesById = new Map(voiceMemos.map((memo) => [memo.id, memo.voiceNote]));
  return taggedMemos.map((memo) => {
    const voiceNote = voicesById.get(memo.id);
    return voiceNote ? { ...memo, voiceNote } : memo;
  });
};

const getMemoRowByClientId = async (db: D1Database, clientId: string): Promise<Record<string, unknown> | null> => {
  return db
    .prepare('SELECT * FROM memos WHERE client_id = ? LIMIT 1')
    .bind(clientId)
    .first<Record<string, unknown>>();
};

export const getMemoByClientId = async (db: D1Database, clientId: string): Promise<MemoDetail | null> => {
  const row = await getMemoRowByClientId(db, clientId);
  if (!row) return null;
  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

const runBatchOrSequential = async (db: D1Database, statements: D1PreparedStatement[]): Promise<void> => {
  if (statements.length === 0) return;
  if (typeof db.batch === 'function') {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    await statement.run();
  }
};

/** Keep the FTS table usable in local adapters and during rolling migrations. */
const syncMemoSearchIndex = async (db: D1Database, memo: { id: number; content: string; slug: string }): Promise<void> => {
  try {
    await db.prepare('DELETE FROM memos_fts WHERE rowid = ?').bind(memo.id).run();
    await db
      .prepare('INSERT INTO memos_fts (rowid, content, slug, memo_id) VALUES (?, ?, ?, ?)')
      .bind(memo.id, memo.content, memo.slug, memo.id)
      .run();
  } catch {
    // Search has a LIKE fallback while an older database is being migrated.
  }
};

interface MemoWriteSnapshot {
  id: number;
  slug: string;
  content: string;
  excerpt: string;
  visibility: MemoVisibility;
  displayDate: string;
  updatedAt: string;
  publishedAt: string | null;
  hasImages: number;
  imageCount: number;
  tagCount: number;
  tags: string[];
}

const readMemoWriteSnapshot = async (db: D1Database, id: number): Promise<MemoWriteSnapshot | null> => {
  const row = await db
    .prepare(
      `SELECT id, slug, content, excerpt, visibility, display_date, updated_at, published_at,
              has_images, image_count, tag_count
       FROM memos
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const { results } = await db
    .prepare('SELECT tag FROM memo_tags WHERE memo_id = ? ORDER BY tag ASC')
    .bind(id)
    .all<{ tag: string }>();

  return {
    id: Number(row.id),
    slug: String(row.slug),
    content: String(row.content),
    excerpt: String(row.excerpt),
    visibility: String(row.visibility) as MemoVisibility,
    displayDate: String(row.display_date),
    updatedAt: String(row.updated_at),
    publishedAt: row.published_at ? String(row.published_at) : null,
    hasImages: Number(row.has_images),
    imageCount: Number(row.image_count),
    tagCount: Number(row.tag_count),
    tags: (results ?? []).map((tag) => String(tag.tag)),
  };
};

const restoreMemoWriteSnapshot = async (db: D1Database, snapshot: MemoWriteSnapshot): Promise<void> => {
  await db
    .prepare(
      `UPDATE memos
       SET content = ?, excerpt = ?, visibility = ?, display_date = ?, updated_at = ?, published_at = ?,
           has_images = ?, image_count = ?, tag_count = ?
       WHERE id = ?`,
    )
    .bind(
      snapshot.content,
      snapshot.excerpt,
      snapshot.visibility,
      snapshot.displayDate,
      snapshot.updatedAt,
      snapshot.publishedAt,
      snapshot.hasImages,
      snapshot.imageCount,
      snapshot.tagCount,
      snapshot.id,
    )
    .run();

  await db.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(snapshot.id).run();
  for (const tag of snapshot.tags) {
    await db.prepare('INSERT INTO memo_tags (memo_id, tag) VALUES (?, ?)').bind(snapshot.id, tag).run();
  }
  await syncMemoSearchIndex(db, { id: snapshot.id, content: snapshot.content, slug: snapshot.slug });
};

export const createMemoWithOutcome = async (
  db: D1Database,
  input: CreateMemoInput,
): Promise<{ memo: MemoDetail; created: boolean }> => {
  const clientId = normalizeClientId(input.clientId);
  if (clientId) {
    const existing = await getMemoByClientId(db, clientId);
    if (existing) {
      return { memo: existing, created: false };
    }
  }

  const now = new Date().toISOString();
  const tags = parseTags(input.content);
  const excerpt = createExcerpt(input.content);
  const publishedAt = input.visibility === 'public' ? now : null;
  const imageCount = validateMemoImageCount(input.content);
  const hasImages = imageCount > 0 ? 1 : 0;

  let created: Record<string, unknown> | null = null;
  let inserted = false;
  try {
    const insertMemo = db
      .prepare(
        `INSERT INTO memos (slug, client_id, content, visibility, display_date, created_at, updated_at, published_at, deleted_at, previous_visibility, excerpt, has_images, image_count, tag_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .bind(input.slug, clientId ?? null, input.content, input.visibility, input.displayDate, now, now, publishedAt, excerpt, hasImages, imageCount, tags.length);
    const tagStatements = tags.map((tag) => db
      .prepare('INSERT INTO memo_tags (memo_id, tag) SELECT id, ? FROM memos WHERE slug = ?')
      .bind(tag, input.slug));

    if (typeof db.batch === 'function') {
      // D1 batches are transactional. Looking up the memo by its unique slug
      // lets tag writes depend on the first statement without a second round.
      await db.batch([insertMemo, ...tagStatements]);
    } else {
      // The local SQLite adapter has no batch method; compensate on a failed
      // tag write so tests retain the same all-or-nothing invariant.
      await insertMemo.run();
      inserted = true;
      await runBatchOrSequential(db, tagStatements);
    }

    created = await db
      .prepare('SELECT * FROM memos WHERE slug = ? LIMIT 1')
      .bind(input.slug)
      .first<Record<string, unknown>>();
  } catch (error) {
    if (inserted) {
      try {
        await db.prepare('DELETE FROM memo_tags WHERE memo_id = (SELECT id FROM memos WHERE slug = ?)').bind(input.slug).run();
        await db.prepare('DELETE FROM memos WHERE slug = ?').bind(input.slug).run();
      } catch {
        // Preserve the original write error; the D1 batch path is atomic.
      }
    }
    // A concurrent retry may win the partial unique index between our initial
    // lookup and INSERT. Resolve that race to the already-created memo.
    if (clientId) {
      const existing = await getMemoByClientId(db, clientId);
      if (existing) {
        return { memo: existing, created: false };
      }
    }
    throw error;
  }

  if (!created) {
    throw new Error('Failed to create memo');
  }

  const memo = mapMemoRow(created);

  await syncMemoSearchIndex(db, memo);

  return { memo: { ...memo, tags, assets: [] }, created: true };
};

export const createMemo = async (db: D1Database, input: CreateMemoInput): Promise<MemoDetail> => {
  return (await createMemoWithOutcome(db, input)).memo;
};

const memoOrderBy = (sort: MemoSort): string => {
  const definition = getSortDefinition(sort);
  return `pinned_at IS NULL ASC, pinned_at DESC, ${definition.field} ${definition.direction}, ${definition.secondaryField} ${definition.direction}, id ${definition.direction}`;
};

const paginationSql = (query: PaginationQuery, clauses: string[], params: unknown[]) => {
  const sort = query.sort ?? DEFAULT_MEMO_SORT;
  const definition = getSortDefinition(sort);
  const cursor = decodeMemoCursor(query.cursor);
  if (cursor && cursor.sort === sort) {
    // Pinned memos always remain before unpinned memos. Within each pinned
    // bucket, advance strictly through the selected sort tuple and id tie
    // breaker so inserts before the current page cannot cause duplicates.
    const comparison = definition.direction === 'ASC' ? '>' : '<';
    const sortTuple = definition.secondaryField === 'id'
      ? `
          ${definition.field} ${comparison} ?
          OR (${definition.field} = ? AND id ${comparison} ?)`
      : `
          ${definition.field} ${comparison} ?
          OR (${definition.field} = ? AND (
            ${definition.secondaryField} ${comparison} ?
            OR (${definition.secondaryField} = ? AND id ${comparison} ?)
          ))`;
    clauses.push(`(
      (pinned_at IS NULL) > ?
      OR ((pinned_at IS NULL) = ? AND (
        ((pinned_at IS NOT NULL) AND pinned_at < ?)
        OR (((pinned_at IS NULL) OR pinned_at = ?) AND (${sortTuple}))
      ))
    )`);
    const pinnedRank = cursor.pinnedAt === null ? 1 : 0;
    params.push(
      pinnedRank,
      pinnedRank,
      cursor.pinnedAt,
      cursor.pinnedAt,
    );
    if (definition.secondaryField === 'id') {
      params.push(cursor.sortValue, cursor.sortValue, cursor.id);
    } else {
      params.push(cursor.sortValue, cursor.sortValue, cursor.secondaryValue, cursor.secondaryValue, cursor.id);
    }
  }
  if (query.limit) {
    params.push(query.limit);
    return ' LIMIT ?';
  }
  return '';
};

const appendMemoListFilters = (query: MemoListQuery, clauses: string[], params: unknown[]) => {
  if (query.date) {
    clauses.push('display_date = ?');
    params.push(query.date);
  }

  if (query.tag) {
    // Parent tags include their slash-delimited descendants. Use substr rather
    // than LIKE so a literal '%' or '_' inside a tag stays literal.
    clauses.push(`id IN (
      SELECT memo_id FROM memo_tags
      WHERE tag = ? OR substr(tag, 1, length(?) + 1) = ? || '/'
    )`);
    params.push(query.tag, query.tag, query.tag);
  }

  if (query.hasImages !== undefined) {
    clauses.push('has_images = ?');
    params.push(query.hasImages ? 1 : 0);
  }

  if (query.hasTags !== undefined) {
    clauses.push(query.hasTags ? 'tag_count > 0' : 'tag_count = 0');
  }
};

export const listPublicMemos = async (db: D1Database, query: MemoListQuery): Promise<MemoSummary[]> => {
  const clauses = ['visibility = ?', 'deleted_at IS NULL'];
  const params: unknown[] = ['public'];
  appendMemoListFilters(query, clauses, params);

  const pageSql = paginationSql(query, clauses, params);
  const { results } = await db
    .prepare(`SELECT * FROM memos WHERE ${clauses.join(' AND ')} ORDER BY ${memoOrderBy(query.sort ?? DEFAULT_MEMO_SORT)}${pageSql}`)
    .bind(...params)
    .all();

  return attachRelations(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

const searchMemos = async (db: D1Database, q: string, visibilityClause: string): Promise<MemoSummary[]> => {
  const ftsQuery = buildFtsQuery(q);
  let results: Record<string, unknown>[] = [];

  if (ftsQuery) {
    try {
      const response = await db
        .prepare(
          `SELECT memos.*
           FROM memos
           INNER JOIN memos_fts ON memos_fts.rowid = memos.id
           WHERE ${visibilityClause}
             AND memos.deleted_at IS NULL
             AND memos_fts.content = memos.content
             AND memos_fts.slug = memos.slug
             AND memos_fts MATCH ?
           ORDER BY memos.display_date DESC, memos.created_at DESC, memos.id DESC
           LIMIT 50`,
        )
        .bind(ftsQuery)
        .all<Record<string, unknown>>();
      results = response.results ?? [];
    } catch {
      // Fall back to LIKE for databases that have not applied the FTS migration.
    }
  }

  // FTS tokenization is intentionally conservative for mixed CJK/punctuation
  // input. Preserve the old substring behavior when FTS has no usable hit.
  if (results.length === 0) {
    const pattern = `%${escapeLikeValue(q)}%`;
    const response = await db
      .prepare(
        `SELECT memos.*
         FROM memos
         WHERE ${visibilityClause}
           AND memos.deleted_at IS NULL
           AND (memos.content LIKE ? ESCAPE '\\' OR memos.slug LIKE ? ESCAPE '\\')
         ORDER BY memos.display_date DESC, memos.created_at DESC, memos.id DESC
         LIMIT 50`,
      )
      .bind(pattern, pattern)
      .all<Record<string, unknown>>();
    results = response.results ?? [];
  }

  return attachRelations(db, results.map((row) => mapMemoRow(row)));
};

export const searchPublicMemos = async (db: D1Database, q: string): Promise<MemoSummary[]> => {
  return searchMemos(db, q, "memos.visibility = 'public'");
};

export const searchAuthorMemos = async (db: D1Database, q: string): Promise<MemoSummary[]> => {
  return searchMemos(db, q, '1 = 1');
};

export const getPublicMemoBySlug = async (db: D1Database, slug: string): Promise<MemoDetail | null> => {
  const row = await db
    .prepare('SELECT * FROM memos WHERE slug = ? AND visibility = ? AND deleted_at IS NULL LIMIT 1')
    .bind(slug, 'public')
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const getAuthorMemoBySlug = async (db: D1Database, slug: string): Promise<MemoDetail | null> => {
  const row = await db.prepare('SELECT * FROM memos WHERE slug = ? AND deleted_at IS NULL LIMIT 1').bind(slug).first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const getAuthorMemoById = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const updateMemo = async (
  db: D1Database,
  id: number,
  input: { content?: string; visibility?: MemoVisibility; displayDate?: string },
): Promise<MemoDetail | null> => {
  const existingMemo = await db.prepare('SELECT * FROM memos WHERE id = ? AND deleted_at IS NULL LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!existingMemo) return null;

  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];
  const tagStatements: D1PreparedStatement[] = [];
  const hasBatch = typeof db.batch === 'function';
  const previousSnapshot = !hasBatch && input.content !== undefined ? await readMemoWriteSnapshot(db, id) : null;

  if (input.content !== undefined) {
    const tags = parseTags(input.content);
    const imageCount = validateMemoImageCount(input.content);
    sets.push('content = ?', 'excerpt = ?', 'tag_count = ?', 'has_images = ?', 'image_count = ?');
    params.push(input.content, createExcerpt(input.content), tags.length, imageCount > 0 ? 1 : 0, imageCount);

    // Rebuild tags in the same D1 batch as the memo update. The sequential
    // fallback is used only by the local better-sqlite test adapter.
    tagStatements.push(db.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(id));
    for (const tag of tags) {
      tagStatements.push(db.prepare('INSERT INTO memo_tags (memo_id, tag) VALUES (?, ?)').bind(id, tag));
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
  const statements = [
    db.prepare(`UPDATE memos SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...params),
    ...tagStatements,
  ];

  if (hasBatch) {
    await db.batch(statements);
  } else {
    try {
      await runBatchOrSequential(db, statements);
    } catch (error) {
      // The local better-sqlite adapter intentionally has no D1 batch().
      // Restore both sides of the content/tag write if a later statement fails;
      // D1 uses its transactional batch path above.
      if (previousSnapshot) {
        try {
          await restoreMemoWriteSnapshot(db, previousSnapshot);
        } catch {
          // Preserve the original write error if the best-effort compensation fails.
        }
      }
      throw error;
    }
  }

  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;

  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  await syncMemoSearchIndex(db, memo);
  return { ...memo, assets: [] };
};

export const pinMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const now = new Date().toISOString();
  await db.prepare('UPDATE memos SET pinned_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const unpinMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  await db.prepare('UPDATE memos SET pinned_at = NULL WHERE id = ? AND deleted_at IS NULL').bind(id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const favoriteMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  const now = new Date().toISOString();
  await db.prepare('UPDATE memos SET favorited_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

export const unfavoriteMemo = async (db: D1Database, id: number): Promise<MemoDetail | null> => {
  await db.prepare('UPDATE memos SET favorited_at = NULL WHERE id = ? AND deleted_at IS NULL').bind(id).run();
  const row = await db.prepare('SELECT * FROM memos WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
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

  const [memo] = await attachRelations(db, [mapMemoRow(row)]);
  return { ...memo, assets: [] };
};

const extractMemoObjectKeys = (content: string): Set<string> => {
  const keys = new Set<string>();
  const imageRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(content)) !== null) {
    const keyMatch = match[1].match(/\/(?:api\/)?assets\/(.+)/);
    if (keyMatch?.[1]) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
};

const hasOtherMemoObjectReference = async (db: D1Database, memoId: number, objectKey: string): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT CASE WHEN
         EXISTS (
           SELECT 1 FROM memos
           WHERE id <> ? AND instr(content, ?) > 0
         )
         OR EXISTS (
           SELECT 1 FROM assets
           WHERE object_key = ? AND memo_id NOT IN (?, 0)
         )
         OR EXISTS (
           SELECT 1 FROM memo_voice_notes
           WHERE object_key = ? AND memo_id <> ?
         )
       THEN 1 ELSE 0 END AS referenced`,
    )
    .bind(memoId, objectKey, objectKey, memoId, objectKey, memoId)
    .first<{ referenced: number }>();

  return Number(row?.referenced ?? 0) === 1;
};

export const purgeOldTrash = async (db: D1Database, r2: R2Bucket): Promise<number> => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await db
    .prepare('SELECT id, content FROM memos WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .bind(cutoff)
    .all<{ id: number; content: string }>();

  if (!results || results.length === 0) return 0;

  let purged = 0;
  for (const row of results) {
    const [assetRows, voiceRows] = await Promise.all([
      db.prepare('SELECT object_key FROM assets WHERE memo_id = ?').bind(row.id).all<{ object_key: string }>(),
      db.prepare('SELECT object_key FROM memo_voice_notes WHERE memo_id = ?').bind(row.id).all<{ object_key: string }>(),
    ]);
    const objectKeys = extractMemoObjectKeys(String(row.content));
    for (const asset of assetRows.results ?? []) {
      if (asset.object_key) objectKeys.add(String(asset.object_key));
    }
    for (const voice of voiceRows.results ?? []) {
      if (voice.object_key) objectKeys.add(String(voice.object_key));
    }

    const sharedKeys = new Set<string>();
    let storageCleanupSucceeded = true;
    for (const objectKey of objectKeys) {
      if (await hasOtherMemoObjectReference(db, row.id, objectKey)) {
        sharedKeys.add(objectKey);
        continue;
      }

      try {
        await r2.delete(objectKey);
      } catch (error) {
        storageCleanupSucceeded = false;
        console.error('Trash purge could not delete object', { memoId: row.id, objectKey, error });
      }
    }

    // Keep the memo and its relations if storage cleanup failed. The next
    // scheduled run can retry the same trash row without losing its keys.
    if (!storageCleanupSucceeded) {
      continue;
    }

    try {
      await db.prepare('DELETE FROM memo_voice_notes WHERE memo_id = ?').bind(row.id).run();
      await db.prepare('DELETE FROM assets WHERE memo_id = ?').bind(row.id).run();
      for (const objectKey of objectKeys) {
        // memo_id=0 is the legacy unassociated-upload row. Remove it only
        // when no retained memo/voice relation still uses the object.
        if (!sharedKeys.has(objectKey)) {
          await db.prepare('DELETE FROM assets WHERE object_key = ? AND memo_id = 0').bind(objectKey).run();
        }
      }
      await db.prepare('DELETE FROM memo_tags WHERE memo_id = ?').bind(row.id).run();
      try {
        await db.prepare('DELETE FROM memos_fts WHERE rowid = ?').bind(row.id).run();
      } catch {
        // The FTS table may not exist on a pre-migration database.
      }
      await db.prepare('DELETE FROM memos WHERE id = ?').bind(row.id).run();
      purged += 1;
    } catch (error) {
      // R2 and D1 cannot share a transaction. Keep this visible and let the
      // next scheduled run finish any partial database cleanup.
      console.error('Trash purge database cleanup failed', { memoId: row.id, error });
    }
  }

  return purged;
};

const countChars = (content: string): number => {
  return content
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/[#*_~`>\-\[\]()]/g, '')
    .trim()
    .length;
};

export const getRecordStats = async (db: D1Database, authorMode: boolean) => {
  const vis = authorMode ? 'deleted_at IS NULL' : "visibility = 'public' AND deleted_at IS NULL";

  const { results: contentRows } = await db.prepare(`SELECT content, display_date FROM memos WHERE ${vis}`).all();

  let totalWords = 0;
  const dailyWords = new Map<string, number>();
  const dailyMemos = new Map<string, number>();
  const heatmapStart = (() => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return oneYearAgo.toISOString().slice(0, 10);
  })();
  const heatmapCounts = new Map<string, number>();

  for (const row of contentRows ?? []) {
    const wc = countChars(String((row as Record<string, unknown>).content));
    const date = String((row as Record<string, unknown>).display_date);
    totalWords += wc;
    dailyWords.set(date, (dailyWords.get(date) ?? 0) + wc);
    dailyMemos.set(date, (dailyMemos.get(date) ?? 0) + 1);
    if (date >= heatmapStart) {
      heatmapCounts.set(date, (heatmapCounts.get(date) ?? 0) + 1);
    }
  }
  const maxDailyWords = dailyWords.size > 0 ? Math.max(...dailyWords.values()) : 0;
  const maxDailyMemos = dailyMemos.size > 0 ? Math.max(...dailyMemos.values()) : 0;
  const heatmap = [...heatmapCounts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([date, count]) => ({ date, count }));

  const yearMemos = heatmap.reduce((sum, d) => sum + d.count, 0);

  return {
    totalMemos: contentRows?.length ?? 0,
    totalWords,
    maxDailyMemos,
    maxDailyWords,
    activeDays: dailyMemos.size,
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
       WHERE deleted_at IS NULL
       GROUP BY display_date
       ORDER BY display_date ASC`,
    )
    .all();

  return (results ?? []).map((row) => ({
    date: String((row as Record<string, unknown>).date),
    count: Number((row as Record<string, unknown>).count),
  }));
};

const PUBLIC_STREAK_CTE = `
  WITH public_dates AS (
    SELECT DISTINCT display_date AS public_date
    FROM memos
    WHERE visibility = 'public' AND deleted_at IS NULL
  ),
  ordered_public_dates AS (
    SELECT
      public_date,
      ROW_NUMBER() OVER (ORDER BY public_date DESC) AS day_index,
      ROUND(julianday(MAX(public_date) OVER ()) - julianday(public_date)) AS day_offset
    FROM public_dates
  ),
  public_streak AS (
    SELECT COUNT(*) AS streak_days
    FROM ordered_public_dates
    WHERE day_offset = day_index - 1
  )`;

export const getPublicStats = async (db: D1Database): Promise<{ total: number; tags: number; streakDays: number }> => {
  const aggregate = await db
    .prepare(
      `${PUBLIC_STREAK_CTE}
       SELECT
         COUNT(CASE WHEN stats_memos.visibility = 'public' AND stats_memos.deleted_at IS NULL THEN 1 END) AS total,
         (
           SELECT COUNT(DISTINCT memo_tags.tag)
           FROM memo_tags
           INNER JOIN memos AS tagged_memos ON tagged_memos.id = memo_tags.memo_id
           WHERE tagged_memos.visibility = 'public' AND tagged_memos.deleted_at IS NULL
         ) AS tags,
         COALESCE((SELECT streak_days FROM public_streak), 0) AS streak_days
       FROM memos AS stats_memos`,
    )
    .first<{ total: number; tags: number; streak_days: number }>();

  return {
    total: aggregate?.total ?? 0,
    tags: aggregate?.tags ?? 0,
    streakDays: aggregate?.streak_days ?? 0,
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
  } else {
    clauses.push('deleted_at IS NULL');
    if (query.view !== 'all') {
      clauses.push('visibility = ?');
      params.push(query.view);
    }
  }

  appendMemoListFilters(query, clauses, params);

  const pageSql = paginationSql(query, clauses, params);
  const nextWhere = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await db.prepare(`SELECT * FROM memos ${nextWhere} ORDER BY ${memoOrderBy(query.sort ?? DEFAULT_MEMO_SORT)}${pageSql}`).bind(...params).all();

  return attachRelations(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const listKnowledgeBaseMemos = async (db: D1Database): Promise<MemoSummary[]> => {
  const { results } = await db
    .prepare(
      "SELECT * FROM memos WHERE deleted_at IS NULL AND visibility = 'public' ORDER BY id ASC",
    )
    .all();

  return attachRelations(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
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

  return attachRelations(db, (results ?? []).map((row) => mapMemoRow(row as Record<string, unknown>)));
};

export const listAuthorTagCounts = async (db: D1Database): Promise<Array<{ tag: string; count: number }>> => {
  const { results } = await db
    .prepare(
      `SELECT memo_tags.tag as tag, COUNT(*) as count
       FROM memo_tags
       INNER JOIN memos ON memos.id = memo_tags.memo_id
       WHERE memos.deleted_at IS NULL
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
  const aggregate = await db
    .prepare(
      `${PUBLIC_STREAK_CTE}
       SELECT
         COUNT(CASE WHEN stats_memos.deleted_at IS NULL THEN 1 END) AS total,
         COUNT(CASE WHEN stats_memos.visibility = 'public' AND stats_memos.deleted_at IS NULL THEN 1 END) AS public_count,
         COUNT(CASE WHEN stats_memos.visibility = 'private' AND stats_memos.deleted_at IS NULL THEN 1 END) AS private_count,
         COUNT(CASE WHEN stats_memos.deleted_at IS NOT NULL THEN 1 END) AS trash_count,
         (
           SELECT COUNT(DISTINCT memo_tags.tag)
           FROM memo_tags
           INNER JOIN memos AS tagged_memos ON tagged_memos.id = memo_tags.memo_id
           WHERE tagged_memos.deleted_at IS NULL
         ) AS tags,
         COALESCE((SELECT streak_days FROM public_streak), 0) AS streak_days
       FROM memos AS stats_memos`,
    )
    .first<{ total: number; public_count: number; private_count: number; trash_count: number; tags: number; streak_days: number }>();

  return {
    total: aggregate?.total ?? 0,
    public: aggregate?.public_count ?? 0,
    private: aggregate?.private_count ?? 0,
    trash: aggregate?.trash_count ?? 0,
    tags: aggregate?.tags ?? 0,
    // Dashboard stats historically expose the public streak. Private memos
    // remain part of counts/tags, but must not extend this sidebar metric.
    streakDays: aggregate?.streak_days ?? 0,
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
      .prepare(`SELECT id, content, slug FROM memos WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: number; content: string; slug: string }>();

    for (const row of results ?? []) {
      const nextContent = transform(String(row.content));
      const tags = parseTags(nextContent);
      const imageCount = countMemoImages(nextContent);
      await db
        .prepare('UPDATE memos SET content = ?, excerpt = ?, tag_count = ?, has_images = ?, image_count = ?, updated_at = ? WHERE id = ?')
        .bind(nextContent, createExcerpt(nextContent), tags.length, imageCount > 0 ? 1 : 0, imageCount, new Date().toISOString(), Number(row.id))
        .run();
      await syncMemoSearchIndex(db, { id: Number(row.id), content: nextContent, slug: String(row.slug) });
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
