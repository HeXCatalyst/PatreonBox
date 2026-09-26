import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { Creator, Post, Asset, Comment, FavoriteAsset } from '../types/db';
import { mediaKindOf, ALL_MEDIA_KINDS, type MediaKind } from './media';
import { ensurePostsColumns } from './schemaHeal';
import { buildFtsMatch } from './ftsMatch';

// Re-exported so existing importers keep working; the definitions live in ./media.
export { mediaKindOf, type MediaKind };

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:patreonbox.db');
    await dbInstance.execute("PRAGMA foreign_keys = ON").catch(() => {});

    // Schema changes belong in the versioned migrations in src-tauri/src/lib.rs.
    // The single exception is ensurePostsColumns below: the posts.is_starred /
    // min_cents_pledged_to_view columns were dropped from the migrations by
    // 5fc3279 but never re-added, while code still references them, and SQLite
    // has no ADD COLUMN IF NOT EXISTS — so a migration can't add them without
    // breaking legacy databases. See ensurePostsColumns for the full reasoning.

    // Self-healing cleanup: merge creator rows that point at the same Patreon
    // creator. Patreon exposes one creator under several URL forms — /slug,
    // /cw/slug, /c/slug, plus case and trailing-slash variants — so a plain
    // lowercase-and-strip-slash key isn't enough (e.g. /cw/someartist and
    // /someartist would be treated as two creators). Dedup by the extracted slug,
    // keep the pinned/oldest row, reassign its posts, and canonicalize the
    // survivor's profile_url to the plain form so future syncs (which now emit
    // the plain form too) match it instead of inserting a fresh duplicate.
    const creatorSlug = (url: string): string | null => {
      try {
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        const slug = (['c', 'cw'].includes(parts[0]) ? parts[1] : parts[0]) || '';
        return slug ? slug.toLowerCase() : null;
      } catch {
        return null;
      }
    };

    const creatorRows = await dbInstance.select<{
      id: string; profile_url: string | null; is_pinned: number; created_at: string;
    }[]>("SELECT id, profile_url, is_pinned, created_at FROM creators WHERE profile_url IS NOT NULL");

    const bySlug = new Map<string, typeof creatorRows>();
    for (const c of creatorRows) {
      const slug = creatorSlug(c.profile_url!);
      if (!slug) continue;
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug)!.push(c);
    }
    for (const [slug, group] of bySlug) {
      group.sort((a, b) => b.is_pinned - a.is_pinned || a.created_at.localeCompare(b.created_at));
      const keep = group[0];
      for (const dup of group.slice(1)) {
        await dbInstance.execute("UPDATE posts SET creator_id = ? WHERE creator_id = ?", [keep.id, dup.id]);
        await dbInstance.execute("DELETE FROM creators WHERE id = ?", [dup.id]);
      }
      const canonical = `https://www.patreon.com/${slug}`;
      if (keep.profile_url !== canonical) {
        await dbInstance.execute("UPDATE creators SET profile_url = ? WHERE id = ?", [canonical, keep.id]);
      }
    }

    // Heal the posts.is_starred / min_cents_pledged_to_view drift. Runs after
    // Database.load, so migrations v1–v13 have already applied; idempotent on
    // legacy databases that already carry the columns. See ensurePostsColumns.
    await ensurePostsColumns(dbInstance);
  }
  return dbInstance;
}

// -----------------------------------------------------------------------------
// QUERIES
// -----------------------------------------------------------------------------

export async function getCreators(): Promise<(Creator & { post_count: number })[]> {
  const db = await getDb();
  return db.select(`
    SELECT ${CREATOR_LIST_COLUMNS}, COUNT(p.id) as post_count
    FROM creators c
    LEFT JOIN posts p ON p.creator_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
}

/**
 * Neutralise LIKE metacharacters in a user-supplied search term so it matches
 * literally. Pairs with an `ESCAPE '\'` clause on the LIKE itself. The
 * backslash must be escaped first, or it would double-escape the `%`/`_` this
 * function goes on to add.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

// Columns every list query selects. Deliberately omits `content_raw` and
// `content_rendered_html`: the scraper writes the *same* HTML into both
// (scraping.rs:652-653), so `SELECT p.*` shipped two duplicate full-text copies
// per row — ~20MB per keystroke at 1k posts, the IPC-payload bloat flagged as
// P0-2. The body is fetched on demand by `getPostBody` when a post is opened.
// `content_raw` is still available to the WHERE clause below (it's a column on
// the table; the projection only controls what comes back over IPC).
const POST_LIST_COLUMNS = `
  p.id, p.creator_id, p.source_key, p.external_id, p.title, p.excerpt,
  p.content_format, p.source_url, p.published_at, p.archived_at,
  p.has_assets, p.read_state, p.is_starred, p.created_at, p.updated_at,
  p.min_cents_pledged_to_view,
  c.name as creator_name, c.avatar_path as creator_avatar_path
`;

// Columns every asset list query selects (P2-6). Omits `source_url` and
// `checksum_sha256`: nothing in the UI reads them, and `source_url` is a long
// CDN URL repeated for every row of every media query. The media grid, the
// favourites grid and the reading view all render from `local_path`, so the
// projection only drops dead weight. `download_error`/`download_error_kind`
// stay — they drive the per-asset error badge.
const ASSET_LIST_COLUMNS = `
  a.id, a.post_id, a.local_path, a.file_name, a.mime_type, a.media_type,
  a.byte_size, a.created_at, a.updated_at, a.downloaded_at, a.download_error,
  a.download_error_kind, a.favorited_at
`;

/**
 * Creator columns for the sidebar list. Everything except `description` — a
 * full creator bio (often several KB) repeated for every creator on every
 * refresh, with zero readers in the UI (P3-2).
 */
const CREATOR_LIST_COLUMNS = `
  c.id, c.source_key, c.external_id, c.name, c.profile_url, c.avatar_path,
  c.last_synced_at, c.created_at, c.updated_at, c.subscription_type,
  c.is_subscribed, c.is_pinned, c.pin_order
`;

/** Newest first. Kept in one place so the page query, the index and the paging
 * count can't drift apart. */
const ORDER_POSTS = ` ORDER BY p.published_at DESC, p.created_at DESC`;

/** Everything that narrows a posts list query. Shared by the classic paged list,
 * the workbench index and the paging count, so one filter definition serves all
 * three (P1-5). */
export interface PostsFilterOptions {
  creatorId?: string;
  search?: string;
  starred?: boolean;
  tierFilter?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

/**
 * Whether the `posts_fts` index is safe to drive a list search. The criteria
 * mirror the backend's ensure_search_index fast path exactly (search.rs:
 * posts_fts_exists + fts_is_external_content + fts_triggers_current): the
 * posts_fts table exists in external-content mode (`content='posts'` in its
 * DDL) AND all three maintenance triggers (ai/ad/au) exist in their current
 * form — the delete/update triggers carrying the FTS5 'delete' command, the
 * update trigger guarded by a WHEN clause. Any other shape means MATCH can
 * silently miss freshly inserted posts or serve stale hits without raising
 * (the catch-fallback in resolvePostsFilter never fires), so the list must
 * walk LIKE.
 *
 * Three states, three behaviours:
 * - current → MATCH (inserts, deletes and updates all maintain the index);
 * - the index EXISTS but is not current — a trigger missing or old-form, or
 *   the table not in external-content mode (an upgrade that never finished,
 *   e.g. held by a write lock until busy_timeout gave up): LIKE here, plus
 *   one deduplicated background repair (`refresh_search_index`). false is
 *   not cached — the next list search re-probes and upgrades to FTS by
 *   itself once the repair lands;
 * - no posts_fts table at all: the index was never built. It stays lazily
 *   created by the first SearchView search (`ensure_search_index`) — a list
 *   keystroke must never pay for the full backfill, so nothing is invoked.
 *
 * The backend remains the authority for repairs (ensure/refresh_search_index
 * decide and apply them); this gate is only the read-side safety net that
 * picks MATCH vs LIKE for the list. Only the positive answer is cached —
 * while the gate reads closed we re-check (the combined sqlite_master lookup
 * below is one round trip, microseconds). Nothing here builds the index.
 */
let ftsIndexAvailable = false;

async function hasFtsIndex(db: Database): Promise<boolean> {
  if (ftsIndexAvailable) return true;
  // One round trip: the posts_fts table DDL plus all three trigger DDLs.
  const rows = await db.select<{ name: string; sql: string | null }[]>(
    "SELECT name, sql FROM sqlite_master WHERE (type = 'table' AND name = 'posts_fts') OR (type = 'trigger' AND name IN ('posts_fts_ai', 'posts_fts_ad', 'posts_fts_au'))",
  );
  // Judgement identical to the backend's: table exists with content='posts'
  // (fts_is_external_content) + all three triggers present + 'delete'
  // command in ad/au + WHEN guard in au (fts_triggers_current). Checking all
  // three triggers — not just the update one — is the point: a missing insert
  // or delete trigger leaves MATCH silently wrong in ways a single-trigger
  // probe cannot see.
  const table = rows.find(r => r.name === "posts_fts");
  const trigger = (name: string) => rows.find(r => r.name === name)?.sql ?? null;
  let current = false;
  if (table?.sql != null) {
    const externalContent = table.sql.toLowerCase().includes("content='posts'");
    const ai = trigger("posts_fts_ai");
    const ad = trigger("posts_fts_ad");
    const au = trigger("posts_fts_au");
    if (externalContent && ai != null && ad != null && au != null) {
      const adSql = ad.toLowerCase();
      const auSql = au.toLowerCase();
      current = adSql.includes("'delete'") && auSql.includes("'delete'") && auSql.includes("when");
    }
  }
  ftsIndexAvailable = current;
  if (!current && table != null) {
    // Index exists but is incomplete/stale (missing or old-form trigger, wrong
    // table mode): fire one background repair (idempotent, deduplicated,
    // best-effort). false is not cached, so the next list search re-probes
    // and picks the repaired state up.
    void refreshSearchIndex();
  }
  // table == null: the index was never built — keep lazy creation (the first
  // global search builds it); a list keystroke never triggers a backfill.
  return ftsIndexAvailable;
}

/**
 * Ask the backend to bring the FTS index and its triggers up to the current
 * shape (`refresh_search_index` is an idempotent ensure — already current
 * costs a cheap no-op). Deduplicated while one call is in flight; failures are
 * swallowed and simply retried by the next gate probe that still reads false.
 */
let refreshInFlight: Promise<void> | null = null;

async function refreshSearchIndex(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      await invoke("refresh_search_index");
    } catch {
      // best-effort: a failure retries naturally on the next false probe
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Builds the WHERE clause shared by every posts list query.
 *
 * Search runs through FTS5 when the index exists (P1-7): the old
 * `title LIKE %term% OR content_raw LIKE %term%` could not use an index and
 * full-scanned every post body on each keystroke-settled query. Note the column
 * difference — FTS indexes `content_rendered_html`, LIKE scanned `content_raw` —
 * is not a semantic change: the scraper writes the same HTML into both columns
 * (see the POST_LIST_COLUMNS note), and SearchView already searches the FTS one.
 *
 * `forceLike` is the degradation path: a `MATCH` that SQLite rejects (malformed
 * quoting, a build without FTS5) retries with the LIKE clause instead of
 * failing the list, mirroring the backend's `search_posts` fallback.
 */
async function buildPostsFilter(
  db: Database,
  opts: PostsFilterOptions,
  forceLike = false,
): Promise<{ whereSql: string; binds: unknown[]; usesFts: boolean }> {
  const { creatorId, search, starred, tierFilter, dateFrom, dateTo } = opts;
  let whereSql = '';
  const binds: unknown[] = [];
  let usesFts = false;

  if (creatorId) {
    whereSql += ` AND p.creator_id = ?`;
    binds.push(creatorId);
  }
  if (search) {
    const match = buildFtsMatch(search);
    // An empty MATCH string is a syntax error in FTS5, so a whitespace-only
    // query takes the LIKE branch and keeps its current meaning (`%   %`
    // matches posts containing that whitespace, rather than matching everything).
    if (!forceLike && match && await hasFtsIndex(db)) {
      whereSql += ` AND p.rowid IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ?)`;
      binds.push(match);
      usesFts = true;
    } else {
      // Escape LIKE's own wildcards before wrapping the term in %…%. Parameter
      // binding stops SQL injection but does nothing about `%` and `_` *inside*
      // the bound value, where they still act as wildcards — so searching for
      // "50%" matched anything starting "50", and a lone "_" matched every post.
      const term = `%${escapeLike(search)}%`;
      whereSql += ` AND (p.title LIKE ? ESCAPE '\\' OR p.content_raw LIKE ? ESCAPE '\\')`;
      binds.push(term);
      binds.push(term);
    }
  }
  if (starred) {
    whereSql += ` AND p.is_starred = 1`;
  }
  if (tierFilter !== null && tierFilter !== undefined) {
    if (tierFilter === 0) {
      whereSql += ` AND (p.min_cents_pledged_to_view = 0 OR p.min_cents_pledged_to_view IS NULL)`;
    } else {
      whereSql += ` AND p.min_cents_pledged_to_view = ?`;
      binds.push(tierFilter);
    }
  }
  if (dateFrom) {
    whereSql += ` AND p.published_at >= ?`;
    binds.push(dateFrom);
  }
  if (dateTo) {
    whereSql += ` AND p.published_at <= ?`;
    binds.push(dateTo + 'T23:59:59Z');
  }

  return { whereSql, binds, usesFts };
}

/**
 * Decides FTS-vs-LIKE once for a load. The page query and its COUNT must agree —
 * if one fell back and the other didn't, the pager would advertise pages the list
 * can't show — so the probe happens here and both queries then run through the
 * returned filter. The probe is a one-row FTS query; when there is no search term
 * (or the index doesn't exist yet) the filter is already fixed and no probe runs.
 */
async function resolvePostsFilter(
  db: Database,
  opts: PostsFilterOptions,
): Promise<{ whereSql: string; binds: unknown[] }> {
  const filter = await buildPostsFilter(db, opts);
  if (!filter.usesFts) return filter;
  try {
    await db.select(`SELECT 1 FROM posts p WHERE 1=1${filter.whereSql} LIMIT 1`, filter.binds);
    return filter;
  } catch {
    // Unreachable in practice (quoting neutralises every FTS5 operator), but a
    // list must never fail because of the search index — same contract as the
    // backend's run_like_query fallback.
    return buildPostsFilter(db, opts, true);
  }
}

/** Runs one posts query against a resolved filter. `extraBinds` follow the
 * filter's own binds (LIMIT/OFFSET sit last in the SQL). */
function runPosts<T>(
  db: Database,
  projection: string,
  filter: { whereSql: string; binds: unknown[] },
  suffix: string,
  extraBinds: unknown[] = [],
): Promise<T[]> {
  return db.select<T[]>(
    `SELECT ${projection}
     FROM posts p
     JOIN creators c ON p.creator_id = c.id
     WHERE 1=1${filter.whereSql}${suffix}`,
    [...filter.binds, ...extraBinds],
  );
}

/** One row of the Workbench filmstrip index: enough to render a cell and
 * navigate, without the list projection (P1-5). Roughly a tenth of a full post
 * row, which is what makes a 5k-post creator cheap to open. */
export interface PostIndexRow {
  id: string;
  title: string;
  creator_id: string;
}

const POST_INDEX_COLUMNS = `p.id, p.title, p.creator_id`;

/**
 * The classic list's page of posts plus the total matching the same filter.
 * Replaces the old unbounded `getPosts`: the list only ever rendered 20 rows and
 * paginated in JS, so every creator switch, filter change and settled search
 * shipped the creator's entire post history over IPC (P1-5) — 2.5–3.5MB at 5k
 * posts — to display one page of it.
 */
export async function getPostsPage(
  opts: PostsFilterOptions,
  offset: number,
  limit: number,
): Promise<{ posts: Post[]; total: number }> {
  const db = await getDb();
  const filter = await resolvePostsFilter(db, opts);
  const [posts, countRows] = await Promise.all([
    runPosts<Post>(db, POST_LIST_COLUMNS, filter, `${ORDER_POSTS} LIMIT ? OFFSET ?`, [limit, offset]),
    db.select<{ n: number }[]>(
      `SELECT COUNT(*) as n
       FROM posts p
       JOIN creators c ON p.creator_id = c.id
       WHERE 1=1${filter.whereSql}`,
      filter.binds,
    ),
  ]);
  return { posts, total: countRows[0]?.n ?? 0 };
}

/**
 * The Workbench filmstrip: every matching post, but only `{id, title,
 * creator_id}`. The strip renders a title and a thumbnail per post and flips
 * through them by id — it never read any other column, yet it used to hold the
 * whole post array (and the thumbnail source was already a separate query, see
 * getFirstImagePerPost).
 */
export async function getPostIndex(opts: PostsFilterOptions = {}): Promise<PostIndexRow[]> {
  const db = await getDb();
  const filter = await resolvePostsFilter(db, opts);
  return runPosts<PostIndexRow>(db, POST_INDEX_COLUMNS, filter, ORDER_POSTS);
}

/** A single post with the full list projection. Opening a post no longer waits
 * for a list to load and then searches it in JS: search results, the favourites
 * list, the timeline and the filmstrip all resolve their target through this. */
export async function getPostById(postId: string): Promise<Post | null> {
  const db = await getDb();
  const rows = await db.select<Post[]>(
    `SELECT ${POST_LIST_COLUMNS}
     FROM posts p
     JOIN creators c ON p.creator_id = c.id
     WHERE p.id = ?`,
    [postId],
  );
  return rows[0] ?? null;
}

/** A starred post as the Favourites page lists it: title, creator, date. The
 * page renders nothing else, and starred posts are user-curated (a small set),
 * so this stays a full list rather than a page — just a much narrower one. */
export interface StarredPostRow {
  id: string;
  creator_id: string;
  title: string;
  creator_name: string | null;
  published_at: string | null;
}

export async function getStarredPosts(): Promise<StarredPostRow[]> {
  const db = await getDb();
  const filter = await resolvePostsFilter(db, { starred: true });
  return runPosts<StarredPostRow>(
    db,
    `p.id, p.creator_id, p.title, c.name as creator_name, p.published_at`,
    filter,
    ORDER_POSTS,
  );
}

export async function getDistinctTiersForCreator(creatorId: string): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select<{ min_cents: number }[]>(
    `SELECT DISTINCT min_cents_pledged_to_view as min_cents
     FROM posts
     WHERE creator_id = ? AND min_cents_pledged_to_view IS NOT NULL
     ORDER BY min_cents_pledged_to_view ASC`,
    [creatorId]
  );
  return rows.map(r => r.min_cents);
}

export async function getPostAssets(postId: string): Promise<Asset[]> {
  const db = await getDb();
  return db.select(`SELECT ${ASSET_LIST_COLUMNS} FROM assets a WHERE a.post_id = ? ORDER BY a.created_at ASC`, [postId]);
}

/**
 * Recent posts across ALL subscribed creators, newest first — powers the
 * Timeline ("all activity") view. Capped by `limit` (most-recent window) to keep
 * the river light; pagination can extend it later.
 */
export async function getAllPostsChrono(limit = 300): Promise<Post[]> {
  const db = await getDb();
  return db.select(
    `SELECT ${POST_LIST_COLUMNS}
     FROM posts p
     JOIN creators c ON p.creator_id = c.id
     WHERE c.is_subscribed = 1
     ORDER BY p.published_at DESC, p.created_at DESC
     LIMIT ?`,
    [limit],
  );
}

/**
 * Fetch a single post's body (the two columns deliberately excluded from the
 * list projection). `content_rendered_html` is the rendered HTML the reading
 * view injects; `content_raw` is the same string the scraper also writes there
 * (kept as a fallback). Called on demand when a post is opened — see
 * ReadingView — so the body never rides along with the list query.
 */
export async function getPostBody(postId: string): Promise<{
  content_rendered_html: string | null;
  content_raw: string | null;
}> {
  const db = await getDb();
  const rows = await db.select<{
    content_rendered_html: string | null;
    content_raw: string | null;
  }[]>(
    "SELECT content_rendered_html, content_raw FROM posts WHERE id = ?",
    [postId],
  );
  return rows[0] ?? { content_rendered_html: null, content_raw: null };
}

/**
 * All downloaded media assets (images, videos, audio) for a creator, across
 * every post, ordered by the source post's date. Powers the per-creator Media
 * view. `kinds` narrows the result (default: everything renderable).
 */
export async function getCreatorMedia(
  creatorId: string,
  order: 'desc' | 'asc' = 'desc',
  kinds: MediaKind[] = ALL_MEDIA_KINDS,
): Promise<Asset[]> {
  if (kinds.length === 0) return []; // `IN ()` isn't valid SQL, and no kinds means no results anyway
  const db = await getDb();
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  // Pre-filter on the stored media_type so PDFs, archives and unselected kinds
  // never cross the IPC boundary — switching the kind filter used to pull every
  // downloaded asset the creator has and discard most of it in JS.
  //
  // `media_type IS NULL` has to pass through: rows written before that column
  // existed have no value, and dropping them would make old assets vanish from
  // the wall. The mediaKindOf pass below is what resolves those, and it also
  // keeps the filename extension as the final authority for everything else.
  const kindPlaceholders = kinds.map(() => '?').join(', ');
  const rows = await db.select<Asset[]>(
    `SELECT ${ASSET_LIST_COLUMNS}, p.published_at AS published_at
     FROM assets a
     JOIN posts p ON a.post_id = p.id
     WHERE p.creator_id = ? AND a.downloaded_at IS NOT NULL
       AND (a.media_type IN (${kindPlaceholders}) OR a.media_type IS NULL)
     ORDER BY COALESCE(p.published_at, p.created_at) ${dir}, a.created_at ASC`,
    [creatorId, ...kinds],
  );
  const want = new Set(kinds);
  return rows.filter(a => { const k = mediaKindOf(a.file_name); return k !== null && want.has(k); });
}

/**
 * Returns one downloaded image asset per post for a creator — the first image
 * of each post, ordered by asset creation time. Used by the Workbench
 * filmstrip to show a thumbnail per post without pulling every media row for
 * the creator (P1-2: previously fetched thousands of rows into JS just to keep
 * one per post). Uses ROW_NUMBER() OVER (PARTITION BY post_id) so the filtering
 * happens in SQL, not in JS.
 */
export async function getFirstImagePerPost(creatorId: string): Promise<Asset[]> {
  const db = await getDb();
  return db.select<Asset[]>(
    `WITH ranked AS (
       SELECT a.id, a.post_id, a.local_path, a.file_name, a.mime_type,
              a.media_type, a.byte_size, a.created_at, a.updated_at,
              a.downloaded_at, a.download_error, a.download_error_kind,
              a.favorited_at,
              ROW_NUMBER() OVER (PARTITION BY a.post_id ORDER BY a.created_at ASC) AS rn
       FROM assets a
       JOIN posts p ON a.post_id = p.id
       WHERE p.creator_id = ? AND a.downloaded_at IS NOT NULL
         AND a.media_type = 'image'
     )
     SELECT id, post_id, local_path, file_name, mime_type, media_type,
            byte_size, created_at, updated_at, downloaded_at, download_error,
            download_error_kind, favorited_at
     FROM ranked WHERE rn = 1`,
    [creatorId],
  );
}

/** Cached comments for a post, oldest first (replies resolved by parent_id). */
/**
 * Post ids for a creator, for the comment backfill. `onlyMissing` skips posts
 * that already have cached comments — the normal case after a sync, where only
 * the newly-imported posts need fetching. Newest first, so if a long backfill is
 * interrupted the posts most likely to be read are already done.
 */
export async function getPostIdsForComments(
  creatorId: string,
  onlyMissing = true,
): Promise<string[]> {
  const db = await getDb();
  const missingClause = onlyMissing
    ? 'AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id)'
    : '';
  const rows = await db.select<{ id: string }[]>(
    `SELECT p.id FROM posts p
     WHERE p.creator_id = ? ${missingClause}
     ORDER BY COALESCE(p.published_at, p.created_at) DESC`,
    [creatorId],
  );
  return rows.map(r => r.id);
}

/**
 * Post ids across every creator that still have no cached comments. Powers the
 * one-off "backfill everything" action; newest first so an interrupted run has
 * already covered the posts most likely to be opened.
 */
export async function getAllPostIdsMissingComments(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `SELECT p.id FROM posts p
     WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id)
     ORDER BY COALESCE(p.published_at, p.created_at) DESC`,
  );
  return rows.map(r => r.id);
}

export async function getPostComments(postId: string): Promise<Comment[]> {
  const db = await getDb();
  return db.select<Comment[]>(
    `SELECT * FROM comments WHERE post_id = ? ORDER BY published_at ASC, id ASC`,
    [postId],
  );
}

// -----------------------------------------------------------------------------
// UPSERTS
// -----------------------------------------------------------------------------

export async function upsertCreator(creator: Creator) {
  const db = await getDb();
  
  // Try to find existing creator by external_id
  const existing = await db.select<Creator[]>("SELECT id FROM creators WHERE external_id = ?", [creator.external_id]);
  
  if (existing.length > 0) {
    const existingId = existing[0].id;
    await db.execute(
      `UPDATE creators SET
         name=?,
         profile_url=?,
         avatar_path=?,
         last_synced_at=?,
         updated_at=?,
         is_subscribed=1
       WHERE id = ?`,
      [creator.name, creator.profile_url, creator.avatar_path, creator.last_synced_at, creator.updated_at, existingId]
    );
  } else {
    // Insert new
    await db.execute(
      `INSERT INTO creators (id, source_key, external_id, name, profile_url, avatar_path, description, last_synced_at, created_at, updated_at, is_pinned, pin_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [creator.id, creator.source_key, creator.external_id, creator.name, creator.profile_url, creator.avatar_path, creator.description, creator.last_synced_at, creator.created_at, creator.updated_at, 0, 0]
    );
  }
}

// -----------------------------------------------------------------------------
// STAR
// -----------------------------------------------------------------------------

export type FavoriteSort = 'favorited' | 'name' | 'size' | 'published' | 'added';

/**
 * Favourited images across every creator (or one, when `creatorId` is given).
 * Only downloaded files are listed, since the grid renders them from disk.
 */
export async function getFavoriteMedia(
  creatorId: string | null,
  sort: FavoriteSort = 'favorited',
  dir: 'asc' | 'desc' = 'desc',
): Promise<FavoriteAsset[]> {
  const db = await getDb();
  // Whitelisted so the sort key can never be injected into the SQL.
  const COLS: Record<FavoriteSort, string> = {
    favorited: 'a.favorited_at',
    name: 'a.file_name',
    size: 'a.byte_size',
    published: 'p.published_at',
    added: 'a.downloaded_at',
  };
  const col = COLS[sort] ?? COLS.favorited;
  const order = dir === 'asc' ? 'ASC' : 'DESC';
  const binds: unknown[] = [];
  let where = 'a.favorited_at IS NOT NULL AND a.downloaded_at IS NOT NULL';
  if (creatorId) { where += ' AND p.creator_id = ?'; binds.push(creatorId); }
  return db.select<FavoriteAsset[]>(
    `SELECT ${ASSET_LIST_COLUMNS}, p.published_at AS published_at, p.creator_id AS creator_id,
            p.title AS post_title, c.name AS creator_name
     FROM assets a
     JOIN posts p ON a.post_id = p.id
     JOIN creators c ON p.creator_id = c.id
     WHERE ${where}
     ORDER BY ${col} ${order}, a.id ASC`,
    binds,
  );
}

/** Mark/unmark a single image as a favourite (timestamp doubles as the flag). */
export async function toggleFavoriteAsset(assetId: string, favoritedAt: string | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE assets SET favorited_at = ? WHERE id = ?", [favoritedAt, assetId]);
}

export async function toggleStarPost(postId: string, star: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE posts SET is_starred = ? WHERE id = ?",
    [star ? 1 : 0, postId]
  );
}
