import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const bridge = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: bridge.load } }));

describe('comment backfill selection with real SQLite', () => {
  let sqlite: DatabaseSync;
  let db: typeof import('./db');

  beforeEach(async () => {
    vi.resetModules();
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync('src-tauri/migrations/00001_init.sql', 'utf8'));
    sqlite.exec(readFileSync('src-tauri/migrations/00016_comment_fetch_state.sql', 'utf8'));
    sqlite.exec(`
      ALTER TABLE creators ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL);
      INSERT INTO creators (id, source_key, name, created_at, updated_at)
        VALUES ('c1', 'patreon', 'Example Creator', 'test', 'test'),
               ('c2', 'patreon', 'Another Creator', 'test', 'test');
    `);
    // Only the Tauri transport is replaced. Production getDb and both query
    // functions execute their actual SQL on SQLite, including schema healing.
    bridge.load.mockResolvedValue({
      select: async (sql: string, params: SQLInputValue[] = []) => sqlite.prepare(sql).all(...params),
      execute: async (sql: string, params: SQLInputValue[] = []) => sqlite.prepare(sql).run(...params),
    });
    db = await import('./db');
  });

  afterEach(() => sqlite.close());

  function post(id: string, creator = 'c1', fetchedAt: string | null = null) {
    sqlite.prepare(`INSERT INTO posts
      (id, creator_id, source_key, title, created_at, updated_at, comments_fetched_at)
      VALUES (?, ?, 'patreon', 'Example post', 'test', 'test', ?)`)
      .run(id, creator, fetchedAt);
  }

  it('does not requeue hundreds of successfully checked zero-comment posts', async () => {
    for (let i = 0; i < 300; i++) post(String(1000 + i), 'c1', 'test-success');
    post('2001'); // New or failed: no success marker, no cache.
    post('2002', 'c2');
    post('2003'); // Legacy non-empty caches are retained without refetching.
    sqlite.exec("INSERT INTO comments VALUES ('1', '2003')");
    expect(await db.getPostIdsForComments('c1')).toEqual(['2001']);
    expect((await db.getAllPostIdsMissingComments()).sort()).toEqual(['2001', '2002']);

    sqlite.exec("UPDATE posts SET title='Updated example' WHERE creator_id='c1'");
    expect(await db.getPostIdsForComments('c1')).toEqual(['2001']);
    // Explicit forced refresh can still select posts with a cached empty result.
    expect(await db.getPostIdsForComments('c1', false)).toHaveLength(302);
  });

  it('selects historical unmarked empty posts once, then skips their recorded success', async () => {
    post('101');
    expect(await db.getPostIdsForComments('c1')).toEqual(['101']);
    sqlite.exec("UPDATE posts SET comments_fetched_at='test-success' WHERE id='101'");
    expect(await db.getPostIdsForComments('c1')).toEqual([]);
    expect(await db.getAllPostIdsMissingComments()).toEqual([]);
  });
});
