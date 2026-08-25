/** Minimal slice of the SQL plugin surface, so the heal logic is testable. */
export interface SqlExec {
  select<T = unknown>(query: string, params?: unknown[]): Promise<T>;
  execute(query: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Heal the `posts.is_starred` / `posts.min_cents_pledged_to_view` drift.
 *
 * `5fc3279` removed the "belt-and-suspenders" ALTERs that created these two
 * columns, intending them to move into the versioned migrations in
 * src-tauri/src/lib.rs — but those migrations were never added, while the Rust
 * INSERT (`report_scraped_post_page`) and the frontend star/tier queries kept
 * referencing them. Databases built only by migrations v1–v13 are missing both,
 * so every real sync and every star toggle crashes on a fresh install.
 *
 * The honest fix is a v14 migration with `ALTER TABLE posts ADD COLUMN …`, but
 * SQLite has no `ADD COLUMN IF NOT EXISTS`: such a migration fails with
 * "duplicate column name" on every pre-5fc3279 database that already carries
 * the columns (the developer's included), and sqlx rolls it back and aborts
 * startup. Detect-then-add is idempotent — fresh databases get the columns,
 * legacy ones skip — the same self-healing pattern the creator-dedup block in
 * db.ts uses. When SQLite gains `ADD COLUMN IF NOT EXISTS`, this can retire
 * into a real migration.
 */
export async function ensurePostsColumns(db: SqlExec): Promise<void> {
  const present = new Set(
    (await db.select<{ name: string }[]>(
      "SELECT name FROM pragma_table_info('posts') WHERE name IN ('is_starred','min_cents_pledged_to_view')",
    )).map(r => r.name),
  );
  if (!present.has('is_starred')) {
    await db.execute("ALTER TABLE posts ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0");
  }
  if (!present.has('min_cents_pledged_to_view')) {
    await db.execute("ALTER TABLE posts ADD COLUMN min_cents_pledged_to_view INTEGER");
  }
}
