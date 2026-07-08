import Database from '@tauri-apps/plugin-sql';
import { Creator, Post, Asset } from '../types/db';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:patreonbox.db');
    await dbInstance.execute("PRAGMA foreign_keys = ON").catch(() => {});
    await dbInstance.execute(
      "ALTER TABLE posts ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0"
    ).catch((e: unknown) => {
      if (!String(e).includes('duplicate column')) throw e;
    });

    await dbInstance.execute(
      "ALTER TABLE posts ADD COLUMN min_cents_pledged_to_view INTEGER"
    ).catch((e: unknown) => {
      if (!String(e).includes('duplicate column')) throw e;
    });

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
    query += ` AND (p.title LIKE ? OR p.content_raw LIKE ?)`;
    binds.push(`%${search}%`);
    binds.push(`%${search}%`);
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

const MEDIA_IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

/**
 * All downloaded image assets for a creator, across every post, ordered by the
 * source post's date. Powers the per-creator Media view (X.com-style image wall).
 * Images are identified by filename extension to match the per-post gallery.
 */
export async function getCreatorMedia(
  creatorId: string,
  order: 'desc' | 'asc' = 'desc',
): Promise<Asset[]> {
  const db = await getDb();
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const rows = await db.select<Asset[]>(
    `SELECT a.*
     FROM assets a
     JOIN posts p ON a.post_id = p.id
     WHERE p.creator_id = ? AND a.downloaded_at IS NOT NULL
     ORDER BY COALESCE(p.published_at, p.created_at) ${dir}, a.created_at ASC`,
    [creatorId],
  );
  return rows.filter(a => MEDIA_IMAGE_RE.test(a.file_name));
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

export async function toggleStarPost(postId: string, star: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE posts SET is_starred = ? WHERE id = ?",
    [star ? 1 : 0, postId]
  );
}

// Additional upserts for posts and assets can be added similarly
