import Database from '@tauri-apps/plugin-sql';
import { Creator, Post, Asset, Comment, FavoriteAsset } from '../types/db';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:patreonbox.db');
    await dbInstance.execute("PRAGMA foreign_keys = ON").catch(() => {});

    // NOTE: schema changes belong in the versioned migrations in
    // src-tauri/src/lib.rs — never here. A duplicate set of ALTER TABLEs used to
    // live at this spot as a "belt and suspenders" guard, but it made the schema
    // have two sources of truth and, worse, swallowed real failures behind a
    // brittle `includes('duplicate column')` string check. If a column is
    // missing, the migration is what's broken, and it should fail loudly.

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
  }
  return dbInstance;
}

// -----------------------------------------------------------------------------
// QUERIES
// -----------------------------------------------------------------------------

export async function getCreators(): Promise<(Creator & { post_count: number })[]> {
  const db = await getDb();
  return db.select(`
    SELECT c.*, COUNT(p.id) as post_count
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

export async function getPosts(
  creatorId?: string,
  search?: string,
  starred?: boolean,
  tierFilter?: number | null,
  dateFrom?: string | null,
  dateTo?: string | null,
): Promise<Post[]> {
  const db = await getDb();
  let query = `
    SELECT p.*, c.name as creator_name, c.avatar_path as creator_avatar_path
    FROM posts p
    JOIN creators c ON p.creator_id = c.id
    WHERE 1=1
  `;
  const binds: unknown[] = [];

  if (creatorId) {
    query += ` AND p.creator_id = ?`;
    binds.push(creatorId);
  }
  if (search) {
    // Escape LIKE's own wildcards before wrapping the term in %…%. Parameter
    // binding stops SQL injection but does nothing about `%` and `_` *inside*
    // the bound value, where they still act as wildcards — so searching for
    // "50%" matched anything starting "50", and a lone "_" matched every post.
    const term = `%${escapeLike(search)}%`;
    query += ` AND (p.title LIKE ? ESCAPE '\\' OR p.content_raw LIKE ? ESCAPE '\\')`;
    binds.push(term);
    binds.push(term);
  }
  if (starred) {
    query += ` AND p.is_starred = 1`;
  }
  if (tierFilter !== null && tierFilter !== undefined) {
    if (tierFilter === 0) {
      query += ` AND (p.min_cents_pledged_to_view = 0 OR p.min_cents_pledged_to_view IS NULL)`;
    } else {
      query += ` AND p.min_cents_pledged_to_view = ?`;
      binds.push(tierFilter);
    }
  }
  if (dateFrom) {
    query += ` AND p.published_at >= ?`;
    binds.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND p.published_at <= ?`;
    binds.push(dateTo + 'T23:59:59Z');
  }

  query += ` ORDER BY p.published_at DESC, p.created_at DESC`;
  return db.select(query, binds);
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
  return db.select("SELECT * FROM assets WHERE post_id = ? ORDER BY created_at ASC", [postId]);
}

/**
 * Recent posts across ALL subscribed creators, newest first — powers the
 * Timeline ("all activity") view. Capped by `limit` (most-recent window) to keep
 * the river light; pagination can extend it later.
 */
export async function getAllPostsChrono(limit = 300): Promise<Post[]> {
  const db = await getDb();
  return db.select(
    `SELECT p.*, c.name as creator_name, c.avatar_path as creator_avatar_path
     FROM posts p
     JOIN creators c ON p.creator_id = c.id
     WHERE c.is_subscribed = 1
     ORDER BY p.published_at DESC, p.created_at DESC
     LIMIT ?`,
    [limit],
  );
}

// ⚠️ Keep these three lists in sync with `derive_media_type` in
// src-tauri/src/commands/scraping.rs. They are the same classification applied
// at two different times — Rust decides `assets.media_type` at scrape time, this
// decides what the media wall renders. When they disagree, assets go missing
// silently rather than erroring: `.avi` used to be listed only on the Rust side,
// so those files were stored as media_type='video' but classified null here and
// never appeared in the wall or the kind filter.
const MEDIA_IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;
const MEDIA_VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;
const MEDIA_AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac)$/i;

export type MediaKind = 'image' | 'video' | 'audio';

/** Classify an asset by filename extension (mimetypes are unreliable upstream). */
export function mediaKindOf(fileName: string): MediaKind | null {
  if (MEDIA_IMAGE_RE.test(fileName)) return 'image';
  if (MEDIA_VIDEO_RE.test(fileName)) return 'video';
  if (MEDIA_AUDIO_RE.test(fileName)) return 'audio';
  return null;
}

/**
 * All downloaded media assets (images, videos, audio) for a creator, across
 * every post, ordered by the source post's date. Powers the per-creator Media
 * view. `kinds` narrows the result (default: everything renderable).
 */
export async function getCreatorMedia(
  creatorId: string,
  order: 'desc' | 'asc' = 'desc',
  kinds: MediaKind[] = ['image', 'video', 'audio'],
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
    `SELECT a.*, p.published_at AS published_at
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

/** Cached comments for a post, oldest first (replies resolved by parent_id). */
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
    `SELECT a.*, p.published_at AS published_at, p.creator_id AS creator_id,
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
