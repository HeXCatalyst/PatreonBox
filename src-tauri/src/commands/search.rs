use rusqlite::Connection;
use tauri::AppHandle;
use super::util::open_db;

/// One search hit, serialized to the frontend.
#[derive(serde::Serialize)]
pub struct SearchResult {
    pub post_id: String,
    pub creator_id: String,
    pub creator_name: Option<String>,
    pub title: String,
    pub excerpt: String,
    pub published_at: String,
}

fn posts_fts_exists(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='posts_fts'",
        [],
        |_| Ok(()),
    ).is_ok()
}

/// True when the FTS table is in external-content mode (content='posts'),
/// meaning it stores only the inverted index, not a third copy of the body text.
///
/// Detected from the stored DDL text: SQLite keeps the exact CREATE VIRTUAL
/// TABLE statement in sqlite_master, and this project's two historical modes
/// — self-contained (no content= option, body text duplicated inside the FTS
/// table) and external content (content='posts') — are precisely
/// distinguished by that clause. A contentless table (content=''), which this
/// app never creates, also returns false and takes the recreate path, the
/// safe outcome; the previous shadow-table-presence heuristic misdetected
/// contentless tables as external content (independent review §三).
fn fts_is_external_content(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='posts_fts'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|sql| sql.contains("content='posts'"))
    .unwrap_or(false)
}

/// The external-content FTS5 table definition (body text stays in `posts`,
/// only the inverted index is stored here). Content-rowid mapping keys the
/// index to `posts.rowid`.
const POSTS_FTS_CREATE: &str = r#"
CREATE VIRTUAL TABLE posts_fts USING fts5(
    title, content_rendered_html,
    content='posts',
    content_rowid='rowid'
);
"#;

/// Current trigger bodies for the external-content posts_fts, shared by every
/// path that (re)creates or upgrades the index.
///
/// The delete/update triggers use the FTS5 'delete' command with the OLD
/// column values — the SQLite-sanctioned pattern for external-content tables,
/// where a plain `DELETE FROM posts_fts WHERE rowid=old.rowid` cannot un-index
/// tokens once the source text has already changed (it needs the old text to
/// tokenize). The `WHEN` guard (NULL-safe via `IS NOT`) keeps updates that
/// touch neither title nor content — e.g. starring a post — from rewriting
/// index rows. Trigger names must stay posts_fts_ai/ad/au:
/// rebuild_search_index drops them by name.
const POSTS_FTS_TRIGGERS: &str = r#"
CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, content_rendered_html)
    VALUES (new.rowid, new.title, new.content_rendered_html);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, content_rendered_html)
    VALUES('delete', old.rowid, old.title, old.content_rendered_html);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts
WHEN new.title IS NOT old.title OR new.content_rendered_html IS NOT old.content_rendered_html
BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, content_rendered_html)
    VALUES('delete', old.rowid, old.title, old.content_rendered_html);
    INSERT INTO posts_fts(rowid, title, content_rendered_html)
    VALUES (new.rowid, new.title, new.content_rendered_html);
END;
"#;

/// True when the posts_fts_ai/ad/au triggers are in the current form: all
/// three exist, the delete/update triggers carry the FTS5 'delete' command,
/// and the update trigger is guarded by a WHEN clause. This is the
/// "already upgraded" test — any missing or older-form trigger means the
/// index still needs the one-time upgrade (trigger swap + rebuild).
fn fts_triggers_current(conn: &Connection) -> bool {
    for name in ["posts_fts_ai", "posts_fts_ad", "posts_fts_au"] {
        let sql: String = match conn.query_row(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?1",
            rusqlite::params![name],
            |r| r.get(0),
        ) {
            Ok(sql) => sql,
            Err(_) => return false,
        };
        let sql = sql.to_lowercase();
        if (name == "posts_fts_ad" || name == "posts_fts_au") && !sql.contains("'delete'") {
            return false;
        }
        if name == "posts_fts_au" && !sql.contains("when") {
            return false;
        }
    }
    true
}

/// Idempotently create the FTS5 index in **external content mode**: the FTS
/// table stores only the inverted index (terms → rowids), while the body text
/// stays in `posts.content_rendered_html`. This avoids the third full-text copy
/// that self-contained mode duplicates per post (P1-9).
///
/// Concurrency (independent review R2): the decision "what work is needed" is
/// made twice — once lock-free on the fast path, and again after taking the
/// write lock via `BEGIN IMMEDIATE`. Two connections that both observe the
/// legacy state serialize on the write lock; the second one re-checks under
/// the lock, finds the first one's work already committed, and commits an
/// empty transaction instead of blindly re-running the trigger swap + full
/// rebuild (which the pre-fix code did — a measured schema_version +12 for
/// one upgrade). `BEGIN IMMEDIATE` is essential: a DEFERRED begin (rusqlite's
/// `unchecked_transaction`) defers lock acquisition to the first DDL, so the
/// upgrade decision stays stale while the statement queues on the write lock.
///
/// Three paths, each inside one write transaction so a crash can never leave
/// a half-applied schema (e.g. new triggers but a stale index, which the next
/// call would then mistake for already-upgraded):
/// - table exists in external-content mode with current-form triggers →
///   no-op: a few sqlite_master reads, no lock, no DDL, no index rewrite;
/// - table exists in external-content mode with old-form triggers → swap in
///   the current triggers and run one FTS5 'rebuild', which rewrites the
///   inverted index from `posts` and repairs any drift the old triggers left;
/// - self-contained table (older mode) or no table at all → (re)create the
///   external-content table with the current triggers, then 'rebuild' to
///   populate it.
///
/// An index that is current-but-corrupt is not this function's job: a MATCH
/// error in `search_posts` falls back to LIKE, and the `rebuild_search_index`
/// command can rebuild on demand.
///
/// Returns Err if the bundled SQLite lacks FTS5 — callers then fall back to a
/// LIKE scan.
pub fn ensure_search_index(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Fast path: zero locks, zero writes — pure sqlite_master reads when the
    // index is already current. Guarded as a genuinely write-free no-op by
    // second_ensure_attempts_no_writes (read-only connection oracle).
    if posts_fts_exists(conn) && fts_is_external_content(conn) && fts_triggers_current(conn) {
        // Already current: no DDL, no index rewrite.
        return Ok(());
    }

    // Work seems needed. Take the write lock FIRST and re-decide under it:
    // a concurrent upgrader that commits while we wait is then observed by
    // the re-check inside ensure_search_index_locked instead of being
    // re-done. (BEGIN IMMEDIATE, not a DEFERRED begin, so the lock is held
    // from the start.)
    conn.execute_batch("BEGIN IMMEDIATE")?;
    match ensure_search_index_locked(conn) {
        Ok(()) => conn.execute_batch("COMMIT"),
        Err(e) => {
            // Best effort: roll back whatever part of the DDL batch ran so no
            // half-applied schema survives; the error itself is the return
            // value. Result ignored — if the transaction is already gone the
            // connection is back in autocommit either way.
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// The under-lock half of [`ensure_search_index`]: re-run the full state
/// check with the write transaction already open, then apply exactly one of
/// the three work paths. Every exit commits (or, on Err, rolls back) via the
/// caller — this function only decides and executes the DDL.
fn ensure_search_index_locked(conn: &Connection) -> Result<(), rusqlite::Error> {
    if posts_fts_exists(conn) {
        if fts_is_external_content(conn) {
            if fts_triggers_current(conn) {
                // Another connection completed the upgrade or the initial
                // creation while we were waiting for the write lock:
                // nothing left to do (commit the empty transaction).
                return Ok(());
            }
            // External content table with old-form triggers: swap the
            // triggers and rebuild the index once, atomically.
            return conn.execute_batch(&format!(
                "DROP TRIGGER IF EXISTS posts_fts_ai;
                 DROP TRIGGER IF EXISTS posts_fts_ad;
                 DROP TRIGGER IF EXISTS posts_fts_au;
                 {POSTS_FTS_TRIGGERS}
                 INSERT INTO posts_fts(posts_fts) VALUES('rebuild');"
            ));
        }
        // Old self-contained mode (or an unreadable schema): drop and
        // recreate as external content.
        return conn.execute_batch(&format!(
            "DROP TRIGGER IF EXISTS posts_fts_ai;
             DROP TRIGGER IF EXISTS posts_fts_ad;
             DROP TRIGGER IF EXISTS posts_fts_au;
             DROP TABLE IF EXISTS posts_fts;
             {POSTS_FTS_CREATE}
             {POSTS_FTS_TRIGGERS}
             INSERT INTO posts_fts(posts_fts) VALUES('rebuild');"
        ));
    }
    // Fresh index: create the external-content table + triggers, then
    // populate via the 'rebuild' command (reads straight from posts).
    conn.execute_batch(&format!(
        "{POSTS_FTS_CREATE}
         {POSTS_FTS_TRIGGERS}
         INSERT INTO posts_fts(posts_fts) VALUES('rebuild');"
    ))
}

/// One-shot startup upgrade for existing databases: if an FTS index already
/// exists, bring its triggers up to the current form and rebuild the index
/// once. Fresh databases are left alone — the index is still created lazily
/// on the first search (the sqlx migrations may not have run yet at startup).
/// After the one-time upgrade this costs six sqlite_master reads (wrapper
/// existence check 1 + ensure's fast path: existence 1, content-mode 1,
/// trigger form 3).
pub fn upgrade_search_index_if_present(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    if !posts_fts_exists(&conn) {
        return Ok(());
    }
    ensure_search_index(&conn).map_err(|e| e.to_string())
}

/// Re-run `ensure_search_index` off the search path. The frontend list search
/// invokes this when it observes old-form FTS triggers (the startup upgrade
/// failed or is still pending), so the index is repaired without the user
/// running a global search. Cheap no-op when already current.
#[tauri::command]
pub async fn refresh_search_index(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&app)?;
        ensure_search_index(&conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("refresh search index task failed: {}", e))?
}

/// Turn a user query into a safe FTS5 MATCH string: each whitespace-separated
/// token becomes a double-quoted term (quotes doubled to escape), AND-ed together.
/// Quoting neutralizes FTS5 operator characters so arbitrary input can't error.
fn build_fts_match(query: &str) -> String {
    query
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn run_fts_query(conn: &Connection, match_str: &str, limit: i64) -> Result<Vec<SearchResult>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.creator_id, cr.name, p.title, p.excerpt, p.published_at
         FROM posts_fts f
         JOIN posts p ON p.rowid = f.rowid
         LEFT JOIN creators cr ON cr.id = p.creator_id
         WHERE posts_fts MATCH ?1
         ORDER BY bm25(posts_fts)
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![match_str, limit], map_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn run_like_query(conn: &Connection, query: &str, limit: i64) -> Result<Vec<SearchResult>, rusqlite::Error> {
    // Backslash first: it's the ESCAPE character below, so escaping it after the
    // wildcards would also mangle the `\` this very expression just inserted.
    // SQLite treats `\` followed by anything other than `%`, `_` or `\` as an
    // error, so an unescaped literal backslash in the query (e.g. a Windows
    // path) would make the whole search fail rather than just miss.
    let like = format!(
        "%{}%",
        query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"),
    );
    let mut stmt = conn.prepare(
        "SELECT p.id, p.creator_id, cr.name, p.title, p.excerpt, p.published_at
         FROM posts p
         LEFT JOIN creators cr ON cr.id = p.creator_id
         WHERE p.title LIKE ?1 ESCAPE '\\' OR p.content_rendered_html LIKE ?1 ESCAPE '\\'
         ORDER BY p.published_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![like, limit], map_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<SearchResult> {
    Ok(SearchResult {
        post_id: row.get(0)?,
        // Strict read: posts.creator_id is NOT NULL in the production schema
        // and the test fixtures now populate it, so no NULL tolerance here
        // (excerpt/published_at below stay tolerant — those columns really
        // are nullable in production).
        creator_id: row.get(1)?,
        creator_name: row.get(2)?,
        title: row.get(3)?,
        excerpt: row.get(4).unwrap_or_default(),
        published_at: row.get(5).unwrap_or_default(),
    })
}

/// Cross-creator full-text search over post titles + content. Uses FTS5 when
/// available (ranked by bm25), falling back to a LIKE scan otherwise.
#[tauri::command]
pub async fn search_posts(app: AppHandle, query: String, limit: Option<i64>) -> Result<Vec<SearchResult>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let limit = limit.unwrap_or(100).clamp(1, 500);
    // FTS index build (on first search) and the LIKE fallback scan the posts
    // table; on a large library both can take long enough to visibly stall the
    // UI if run on the main thread. The empty-query short-circuit above stays
    // here so an empty search costs no dispatch.
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&app)?;

        if ensure_search_index(&conn).is_ok() {
            // A malformed MATCH (shouldn't happen after quoting) falls back to LIKE.
            if let Ok(results) = run_fts_query(&conn, &build_fts_match(&q), limit) {
                return Ok(results);
            }
        }
        run_like_query(&conn, &q, limit).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("search posts task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::{
        build_fts_match, ensure_search_index, fts_is_external_content, fts_triggers_current,
        run_fts_query, run_like_query, POSTS_FTS_TRIGGERS,
    };

    // Confirms the bundled SQLite (libsqlite3-sys `bundled`) is compiled with
    // FTS5 — the primary search path. If this ever fails, search silently falls
    // back to LIKE, so keep it as a guard.
    #[test]
    fn fts5_is_available() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE t USING fts5(a); INSERT INTO t(a) VALUES('hello world');",
        ).expect("FTS5 not compiled into bundled SQLite");
        let n: i64 = conn
            .query_row("SELECT count(*) FROM t WHERE t MATCH 'hello'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    // External-content mode (P1-9): the FTS table stores only the inverted
    // index; body text lives in `posts.content_rendered_html`. Verifies that
    // search still works and the table doesn't carry a content shadow table.
    #[test]
    fn external_content_fts_searches_and_avoids_content_duplication() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"CREATE TABLE posts (
                   id TEXT PRIMARY KEY,
                   title TEXT,
                   content_rendered_html TEXT
               );
               CREATE VIRTUAL TABLE posts_fts USING fts5(
                   title, content_rendered_html,
                   content='posts',
                   content_rowid='rowid'
               );
               INSERT INTO posts (id, title, content_rendered_html)
                   VALUES ('1', 'Hello World', '<p>body text here</p>');
               INSERT INTO posts_fts (rowid, title, content_rendered_html)
                   VALUES (1, 'Hello World', '<p>body text here</p>');"#,
        ).expect("external-content FTS creation failed");

        // Search finds the post by title term.
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM posts_fts WHERE posts_fts MATCH 'hello'",
                [], |r| r.get(0),
            ).unwrap();
        assert_eq!(n, 1);

        // Search finds by content term.
        let n2: i64 = conn
            .query_row(
                "SELECT count(*) FROM posts_fts WHERE posts_fts MATCH 'body'",
                [], |r| r.get(0),
            ).unwrap();
        assert_eq!(n2, 1);

        // External-content mode: no _content shadow table (body text not
        // duplicated — the whole point of P1-9).
        let has_shadow: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='posts_fts_content'",
                [], |r| r.get(0),
            ).unwrap();
        assert_eq!(has_shadow, 0, "external-content FTS should not have a _content shadow table");
    }

    // ---- Fixtures and helpers for the search-index regression tests below ----

    /// Minimal posts/creators schema shaped by what run_fts_query /
    /// run_like_query actually SELECT: posts needs id, title,
    /// content_rendered_html, excerpt, creator_id and published_at (plus
    /// is_starred for the non-content-update test); creators is the LEFT JOIN
    /// target. `id TEXT PRIMARY KEY` keeps the implicit rowid the external
    /// content FTS index is keyed on. posts.creator_id is NOT NULL exactly as
    /// in production, and the fictional creator 'c1' is inserted here so
    /// every fixture post can be attributed to it. All data is fictional.
    fn create_fixture_schema(conn: &rusqlite::Connection) {
        conn.execute_batch(
            r#"CREATE TABLE posts (
                   id TEXT PRIMARY KEY,
                   title TEXT,
                   content_rendered_html TEXT,
                   excerpt TEXT,
                   creator_id TEXT NOT NULL,
                   published_at TEXT,
                   is_starred INTEGER DEFAULT 0
               );
               CREATE TABLE creators (
                   id TEXT PRIMARY KEY,
                   name TEXT
               );
               INSERT INTO creators (id, name) VALUES ('c1', 'Creator One');"#,
        )
        .expect("fixture schema creation failed");
    }

    fn fixture_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        create_fixture_schema(&conn);
        conn
    }

    /// Every fixture post is attributed to the fictional creator 'c1' — the
    /// production schema declares posts.creator_id NOT NULL, so the fixtures
    /// follow the same constraint instead of leaning on production reads
    /// being NULL-tolerant.
    fn insert_post(conn: &rusqlite::Connection, id: &str, title: &str, content: Option<&str>) {
        conn.execute(
            "INSERT INTO posts (id, title, content_rendered_html, creator_id) VALUES (?1, ?2, ?3, 'c1')",
            rusqlite::params![id, title, content],
        )
        .unwrap_or_else(|e| panic!("fixture insert of post {} failed: {}", id, e));
    }

    /// Raw number of index rows matching a term, counted on posts_fts itself
    /// — NOT via run_fts_query, whose JOIN against posts would mask stale
    /// entries whose source row is already deleted.
    fn fts_match_count(conn: &rusqlite::Connection, term: &str) -> i64 {
        conn.query_row(
            "SELECT count(*) FROM posts_fts WHERE posts_fts MATCH ?1",
            rusqlite::params![term],
            |r| r.get(0),
        )
        .unwrap_or_else(|e| panic!("match count for '{}' failed: {}", term, e))
    }

    /// PRAGMA schema_version only moves when DDL runs (DROP/CREATE
    /// TABLE/TRIGGER); rebuilding index rows leaves it alone. So
    /// "ensure ran no DDL" ⇔ schema_version unchanged.
    fn schema_version(conn: &rusqlite::Connection) -> i64 {
        conn.query_row("PRAGMA schema_version", [], |r| r.get(0))
            .expect("PRAGMA schema_version failed")
    }

    /// Fingerprint of the FTS5 shadow data table. NOTE what this can and
    /// cannot prove: a full rebuild over identical content can leave it
    /// completely unchanged (independent review R3 — the write count moves
    /// while the fingerprint doesn't), so it is NOT evidence that "no
    /// rebuild happened". What it does capture is the delete+insert cycles
    /// that change which rows the index carries (stale rowids left behind by
    /// misfiring triggers). The authoritative no-write proof is
    /// `second_ensure_attempts_no_writes` (a read-only connection, where any
    /// write attempt errors); the authoritative no-DDL proof is
    /// schema_version above. The assertions using this fingerprint are kept
    /// as a cheap supplementary signal.
    fn fts_data_fingerprint(conn: &rusqlite::Connection) -> (i64, i64) {
        conn.query_row(
            "SELECT count(*), coalesce(max(rowid), -1) FROM posts_fts_data",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .expect("posts_fts_data fingerprint failed")
    }

    /// FTS5 integrity-check: Ok(()) ⇔ index is consistent with the content table.
    fn integrity_check_ok(conn: &rusqlite::Connection) -> bool {
        conn.execute(
            "INSERT INTO posts_fts(posts_fts, rank) VALUES('integrity-check', 1)",
            [],
        )
        .is_ok()
    }

    fn trigger_sql(conn: &rusqlite::Connection, name: &str) -> String {
        conn.query_row(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?1",
            rusqlite::params![name],
            |r| r.get(0),
        )
        .unwrap_or_else(|e| panic!("trigger {} not found: {}", name, e))
    }

    // ---- Helpers for the multi-connection (temp-file) tests ----
    // :memory: databases are private per connection, so the concurrency and
    // read-only tests below need real files. Uniqueness = test tag + process
    // id + monotonic counter (tests run in parallel threads).

    static TEMP_DB_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_db_path(tag: &str) -> std::path::PathBuf {
        let n = TEMP_DB_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "patreonbox-search-test-{}-{}-{}.db",
            tag,
            std::process::id(),
            n
        ))
    }

    /// RAII guard removing the temp database plus its WAL sidecar files, also
    /// on panic, so test reruns never trip over a stale file.
    struct TempDb(std::path::PathBuf);

    impl TempDb {
        fn new(tag: &str) -> TempDb {
            TempDb(temp_db_path(tag))
        }

        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{}", self.0.display(), suffix));
            }
        }
    }

    /// Open a temp-file database the way production open_db does: WAL
    /// journal mode and a 5 s busy timeout, so lock contention is retried
    /// instead of erroring immediately (the concurrency tests depend on
    /// threads parking on the write lock, not failing fast).
    fn open_wal_conn(path: &std::path::Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(path).expect("temp db open failed");
        conn.busy_timeout(std::time::Duration::from_millis(5000))
            .expect("busy_timeout failed");
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .expect("WAL journal mode failed");
        conn
    }

    /// Open the temp database strictly read-only. Any write attempt — DDL,
    /// BEGIN IMMEDIATE on a work path, an FTS5 'rebuild' — fails with a
    /// readonly error, which is exactly what makes this an oracle for "the
    /// code under test attempted zero writes".
    fn open_readonly_conn(path: &std::path::Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .expect("read-only open failed");
        conn.busy_timeout(std::time::Duration::from_millis(5000))
            .expect("busy_timeout failed");
        conn
    }

    // ---- Write-lock parking probes for the two concurrency tests ----
    //
    // rusqlite 0.31's busy_handler accepts a plain `fn(i32) -> bool`, not a
    // closure, so the "a worker is provably parked on the write lock"
    // signals live in module statics instead of captured state. Each probe
    // writes only its own static, each test resets its static on entry, and
    // every worker thread is joined before the test ends — so the two
    // concurrency tests stay independent even though cargo runs them as
    // parallel threads of one process.
    //
    // Why the signal is proof, not hope (follow-up independent review
    // 2026-09-26, "需要补的第二项"): SQLite invokes the busy handler only
    // when a statement of that connection has actually collided with a
    // lock held by another connection. In these tests the colliding
    // statement is the worker's BEGIN IMMEDIATE — the correct
    // implementation queues there directly, an erroneous no-recheck copy
    // would queue on its first DDL — and a worker can only get there after
    // the lock-free fast path has already observed the pre-race state. So
    // the signal lighting up means: this worker saw the old state, decided
    // work was needed, and is now stopped on the write lock. The main
    // thread waits for that proof before letting the race begin; a
    // late-scheduled worker merely extends that wait — it can no longer
    // arrive after the commit, return through the outer fast path, and
    // pass the test without the race ever happening.
    //
    // Installing a busy handler clears the connection's busy_timeout
    // (SQLite treats them as one mechanism), so probe connections retry on
    // the probe alone; calls > 2000 (≈10 s at 5 ms per retry) returns false
    // so a dead or wedged counterparty surfaces as SQLITE_BUSY and fails
    // the test instead of hanging it.

    static WORKER_PARKED: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);

    static WORKER_PARK_COUNT: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);

    /// Probe for `concurrent_ensure_upgrades_exactly_once`: flag the single
    /// worker as parked on the write lock, then back off 5 ms and tell
    /// SQLite to keep retrying.
    fn note_worker_parked_and_retry(calls: i32) -> bool {
        if calls > 2000 {
            return false;
        }
        WORKER_PARKED.store(true, std::sync::atomic::Ordering::SeqCst);
        std::thread::sleep(std::time::Duration::from_millis(5));
        true
    }

    /// Probe for `concurrent_fresh_initialize_runs_exactly_once`: count each
    /// *distinct* worker connection once. SQLite resets its busy-retry
    /// counter per statement (sqlite3VdbeExec) and passes it as the `calls`
    /// argument, so `calls == 0` marks the first collision of a new
    /// statement; while the control transaction holds the write lock, each
    /// worker's only colliding statement is its single BEGIN IMMEDIATE, so
    /// the count cannot be inflated by one connection retrying.
    fn count_parked_worker_and_retry(calls: i32) -> bool {
        if calls > 2000 {
            return false;
        }
        if calls == 0 {
            WORKER_PARK_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
        true
    }

    /// The legacy index state exactly as the pre-fix ensure_search_index
    /// left it: the same external-content CREATE VIRTUAL TABLE, the old
    /// plain-DELETE trigger bodies verbatim, and the one-time backfill.
    /// Shared by the sequential and the concurrency upgrade tests.
    fn create_legacy_external_fts(conn: &rusqlite::Connection) {
        conn.execute_batch(
            r#"
            CREATE VIRTUAL TABLE posts_fts USING fts5(
                title, content_rendered_html,
                content='posts',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
                INSERT INTO posts_fts(rowid, title, content_rendered_html)
                VALUES (new.rowid, new.title, new.content_rendered_html);
            END;
            CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
                DELETE FROM posts_fts WHERE rowid = old.rowid;
            END;
            CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
                DELETE FROM posts_fts WHERE rowid = old.rowid;
                INSERT INTO posts_fts(rowid, title, content_rendered_html)
                VALUES (new.rowid, new.title, new.content_rendered_html);
            END;

            INSERT INTO posts_fts(rowid, title, content_rendered_html)
            SELECT rowid, title, content_rendered_html FROM posts;
            "#,
        )
        .expect("legacy fixture creation failed");
    }

    // Bug 1 guard: an already-external-content posts_fts must not be
    // misdetected as "legacy" and DROP+recreated on every call. schema_version
    // only moves on DDL, and posts_fts_data only moves when the index is
    // actually rewritten — both must stay put on the second ensure.
    #[test]
    fn second_ensure_is_a_noop() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "oldword", Some("oldbody"));
        insert_post(&conn, "p2", "otherword", Some("otherbody"));
        ensure_search_index(&conn).expect("first ensure failed");

        let schema_before = schema_version(&conn);
        let data_before = fts_data_fingerprint(&conn);

        ensure_search_index(&conn).expect("second ensure failed");

        assert_eq!(
            schema_version(&conn),
            schema_before,
            "second ensure must not run any DDL (no drop/recreate)"
        );
        assert_eq!(
            fts_data_fingerprint(&conn),
            data_before,
            "second ensure must not rewrite the index"
        );
    }

    // Bug 2 guard: after an UPDATE of title/content, the old tokens must be
    // gone from the index and only the new tokens must match.
    #[test]
    fn update_replaces_indexed_tokens() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "oldword", Some("oldbody"));
        ensure_search_index(&conn).expect("ensure failed");

        conn.execute(
            "UPDATE posts SET title='newword', content_rendered_html='newbody' WHERE id='p1'",
            [],
        )
        .expect("update of indexed post failed");

        assert_eq!(
            fts_match_count(&conn, "oldword"),
            0,
            "old term must no longer match after the post was updated"
        );
        assert_eq!(
            fts_match_count(&conn, "newword"),
            1,
            "new term must match after the post was updated"
        );

        // The same view through the production query path.
        let stale = run_fts_query(&conn, &build_fts_match("oldword"), 100).unwrap();
        assert!(
            stale.is_empty(),
            "run_fts_query must not return stale hits (got {})",
            stale.len()
        );
        let fresh = run_fts_query(&conn, &build_fts_match("newword"), 100).unwrap();
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].post_id, "p1");

        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after an indexed post is updated"
        );
    }

    // Bug 2 guard: deleting a post must remove its tokens from the index.
    // Counted directly on posts_fts because run_fts_query's JOIN against
    // posts hides stale entries whose source row is gone.
    #[test]
    fn delete_removes_indexed_tokens() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "oldword", Some("oldbody"));
        ensure_search_index(&conn).expect("ensure failed");

        conn.execute("DELETE FROM posts WHERE id='p1'", [])
            .expect("delete of indexed post failed");

        assert_eq!(
            fts_match_count(&conn, "oldword"),
            0,
            "deleted post's term must leave the index"
        );
        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after an indexed post is deleted"
        );
    }

    // Upgrade guard: a database written by the pre-fix code (external-content
    // posts_fts + the old plain-DELETE triggers) carries drifted index
    // entries. One call to ensure_search_index must repair it exactly once:
    // 'delete'-command triggers, no stale terms, a consistent index, and a
    // second ensure that is a no-op.
    #[test]
    fn legacy_index_upgraded_exactly_once() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "oldword", Some("oldbody"));

        // Legacy state exactly as the current (pre-fix) ensure_search_index
        // leaves it: same CREATE VIRTUAL TABLE + old trigger bodies,
        // verbatim, plus the one-time backfill.
        create_legacy_external_fts(&conn);

        // Create the drift the old triggers leave behind: the old tokens
        // stay indexed after the row's text changed.
        conn.execute(
            "UPDATE posts SET title='newword', content_rendered_html='newbody' WHERE id='p1'",
            [],
        )
        .expect("drift update under legacy triggers failed");
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            1,
            "fixture sanity: legacy triggers must leave the old term stale"
        );

        // The production upgrade path.
        ensure_search_index(&conn).expect("ensure failed to upgrade legacy index");

        // (a) Both write triggers must now use the FTS5 'delete' command.
        for name in ["posts_fts_ad", "posts_fts_au"] {
            let sql = trigger_sql(&conn, name);
            assert!(
                sql.to_lowercase().contains("'delete'"),
                "trigger {} must use the FTS5 'delete' command, got: {}",
                name,
                sql
            );
        }

        // (b) The drift is repaired.
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            0,
            "legacy stale term must be gone after upgrade"
        );
        assert_eq!(
            fts_match_count(&conn, "newword"),
            1,
            "current term must be indexed after upgrade"
        );

        // (c) The upgraded index is internally consistent.
        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after the legacy upgrade"
        );

        // (d) The upgrade happens exactly once.
        let schema_before = schema_version(&conn);
        let data_before = fts_data_fingerprint(&conn);
        ensure_search_index(&conn).expect("second ensure failed");
        assert_eq!(
            schema_version(&conn),
            schema_before,
            "second ensure after upgrade must not run any DDL"
        );
        assert_eq!(
            fts_data_fingerprint(&conn),
            data_before,
            "second ensure after upgrade must not rewrite the index"
        );
    }

    // Bug 3 guard: an UPDATE that touches neither title nor content (e.g.
    // starring a post) must not fire the FTS triggers at all.
    #[test]
    fn non_content_update_skips_reindex() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "oldword", Some("oldbody"));
        ensure_search_index(&conn).expect("ensure failed");

        let data_before = fts_data_fingerprint(&conn);

        conn.execute("UPDATE posts SET is_starred=1 WHERE id='p1'", [])
            .expect("starring a post failed");

        assert_eq!(
            fts_data_fingerprint(&conn),
            data_before,
            "an is_starred-only update must not rewrite the FTS index"
        );
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            1,
            "term must still match after a non-content update"
        );
        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after a non-content update"
        );
    }

    // Robustness guard: a post whose content_rendered_html is NULL must
    // survive the whole update/delete cycle without errors (the FTS5
    // 'delete' command receives a NULL column argument), leaving no stale
    // terms behind.
    #[test]
    fn null_content_survives_update_and_delete() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "t1", None);
        ensure_search_index(&conn).expect("ensure with NULL content failed");

        conn.execute("UPDATE posts SET title='t2' WHERE id='p1'", [])
            .expect("update of a post with NULL content failed");
        assert_eq!(
            fts_match_count(&conn, "t1"),
            0,
            "old title term must be gone (NULL content)"
        );
        assert_eq!(
            fts_match_count(&conn, "t2"),
            1,
            "new title term must match (NULL content)"
        );

        conn.execute("DELETE FROM posts WHERE id='p1'", [])
            .expect("delete of a post with NULL content failed");
        assert_eq!(
            fts_match_count(&conn, "t2"),
            0,
            "term must be gone after delete (NULL content)"
        );

        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after updating/deleting a NULL-content post"
        );
    }

    // Regression guard (must pass both before and after the fix): the FTS and
    // LIKE query paths still find the right posts.
    #[test]
    fn fts_and_like_queries_still_work() {
        let conn = fixture_conn();
        // creators ('c1', 'Creator One') is part of the fixture schema now.
        conn.execute(
            "INSERT INTO posts (id, title, content_rendered_html, excerpt, creator_id, published_at)
             VALUES ('p1', 'alphaword', 'alpha body', 'ax', 'c1', '2024-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO posts (id, title, content_rendered_html, excerpt, creator_id, published_at)
             VALUES ('p2', 'betaword', 'beta body', 'bx', 'c1', '2024-01-02')",
            [],
        )
        .unwrap();
        ensure_search_index(&conn).expect("ensure failed");

        let alpha = run_fts_query(&conn, &build_fts_match("alphaword"), 100).unwrap();
        assert_eq!(alpha.len(), 1);
        assert_eq!(alpha[0].post_id, "p1");

        let beta = run_fts_query(&conn, &build_fts_match("betaword"), 100).unwrap();
        assert_eq!(beta.len(), 1);
        assert_eq!(beta[0].post_id, "p2");

        // Multiple tokens are AND-ed together.
        let both = run_fts_query(&conn, &build_fts_match("alphaword betaword"), 100).unwrap();
        assert!(
            both.is_empty(),
            "AND query must match nothing (got {} rows)",
            both.len()
        );

        // LIKE fallback path.
        let like = run_like_query(&conn, "betaword", 100).unwrap();
        assert_eq!(like.len(), 1);
        assert_eq!(like[0].post_id, "p2");
    }

    // R2 guard (concurrent upgrade): two connections both observe the legacy
    // trigger form and both decide to upgrade. The one that loses the race
    // for the write lock must re-check the state under the lock, find the
    // other's work committed, and do nothing — not blindly re-run the whole
    // trigger swap + full rebuild (schema_version +12 = two upgrades).
    //
    // Deterministic construction: the main connection takes BEGIN IMMEDIATE
    // (holding the write lock) before T starts, so T parks on the write lock
    // either way — pre-fix on the first DROP TRIGGER inside a DEFERRED
    // transaction (BEGIN itself takes no lock), post-fix on the BEGIN
    // IMMEDIATE itself. T parking is *proven*, not assumed (follow-up
    // independent review 2026-09-26, "需要补的第二项"): T's connection
    // installs the note_worker_parked_and_retry busy handler, which flips
    // WORKER_PARKED the moment SQLite calls it — i.e. only once T's BEGIN
    // IMMEDIATE has actually queued on the lock conn_lock is holding. The
    // main thread waits for that signal before performing the "other
    // concurrent upgrader's" work inside its own uncommitted transaction
    // and committing. A late-scheduled T therefore just extends the wait —
    // it can no longer arrive after the commit, return through the outer
    // fast path, and pass the test without the race ever happening (the
    // 300 ms blind sleep of the original test allowed exactly that: the
    // review demonstrated a 600 ms-delayed worker passing against a
    // no-recheck implementation).
    #[test]
    fn concurrent_ensure_upgrades_exactly_once() {
        let tmp = TempDb::new("concurrent-upgrade");
        let path = tmp.path().to_path_buf();
        let conn = open_wal_conn(&path);
        create_fixture_schema(&conn);
        insert_post(&conn, "p1", "oldword", Some("oldbody"));
        create_legacy_external_fts(&conn);
        // Drift the old triggers leave behind: the old tokens stay indexed.
        conn.execute(
            "UPDATE posts SET title='newword', content_rendered_html='newbody' WHERE id='p1'",
            [],
        )
        .expect("drift update under legacy triggers failed");
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            1,
            "fixture sanity: legacy triggers must leave the old term stale"
        );
        let schema_start = schema_version(&conn);

        // Hold the write lock without changing anything yet.
        let conn_lock = open_wal_conn(&path);
        conn_lock
            .execute_batch("BEGIN IMMEDIATE")
            .expect("lock BEGIN IMMEDIATE failed");

        // T flags WORKER_PARKED from inside the busy handler SQLite calls
        // when T's BEGIN IMMEDIATE collides with the write lock above.
        WORKER_PARKED.store(false, std::sync::atomic::Ordering::SeqCst);
        let worker = {
            let path = path.clone();
            std::thread::spawn(move || {
                let conn_t = open_wal_conn(&path);
                conn_t
                    .busy_handler(Some(note_worker_parked_and_retry))
                    .expect("busy_handler installation failed");
                ensure_search_index(&conn_t)
            })
        };

        // The race may only begin once T is provably parked on the write
        // lock: poll the signal every 10 ms and fail loudly after 5 s — no
        // fixed sleep stands in as "the contention happened".
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !WORKER_PARKED.load(std::sync::atomic::Ordering::SeqCst) {
            if std::time::Instant::now() > deadline {
                panic!(
                    "worker thread never reached the write-lock wait within 5s; \
                     test is not exercising the race"
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Simulate the concurrent upgrader completing while T waits: the
        // same DDL + rebuild the production upgrade path would run, executed
        // inside the transaction that holds the write lock.
        conn_lock
            .execute_batch(&format!(
                "DROP TRIGGER IF EXISTS posts_fts_ai;
                 DROP TRIGGER IF EXISTS posts_fts_ad;
                 DROP TRIGGER IF EXISTS posts_fts_au;
                 {POSTS_FTS_TRIGGERS}
                 INSERT INTO posts_fts(posts_fts) VALUES('rebuild');"
            ))
            .expect("concurrent upgrade on the lock connection failed");
        conn_lock
            .execute_batch("COMMIT")
            .expect("lock COMMIT failed");

        let t_result = worker.join().expect("worker thread panicked");
        t_result.expect("concurrent ensure must succeed");

        assert_eq!(
            schema_version(&conn),
            schema_start + 6,
            "exactly one upgrade may run (DROP 3 + CREATE 3 = schema_version +6; \
             +12 would mean T re-ran the whole upgrade after the winner committed)"
        );
        assert!(
            fts_triggers_current(&conn),
            "triggers must be in the current form after the single upgrade"
        );
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            0,
            "stale legacy term must be gone after the upgrade"
        );
        assert_eq!(
            fts_match_count(&conn, "newword"),
            1,
            "current term must be indexed after the upgrade"
        );
        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after the concurrent upgrade"
        );
    }

    // R2 guard (concurrent first initialization): with no index at all, four
    // connections racing to initialize must produce exactly one CREATE +
    // backfill. Without the in-lock re-check, the loser re-runs
    // "CREATE VIRTUAL TABLE" after the winner committed and fails with
    // "table already exists" (all-Ok assertion) — and/or the schema_version
    // delta exceeds D, the single-run cost measured on a control database.
    //
    // Deterministic construction (follow-up independent review 2026-09-26,
    // "需要补的第二项"): a control connection holds an empty BEGIN
    // IMMEDIATE (lock only) while the four workers start. Each worker
    // installs the count_parked_worker_and_retry busy handler, which bumps
    // WORKER_PARK_COUNT the moment SQLite calls it on the worker's BEGIN
    // IMMEDIATE queueing on that lock — i.e. only after the worker's
    // fast path has observed the index-less state. The main thread waits
    // until all four are provably parked (10 ms polling, 5 s deadline,
    // panic on timeout) before committing the control transaction, so the
    // race starts with every contender already past the decision and
    // waiting on the lock — no scheduling luck between "lock released" and
    // "late worker reads the state", which is all a Barrier ever
    // guaranteed.
    #[test]
    fn concurrent_fresh_initialize_runs_exactly_once() {
        // Control database: identical fixture, one single-threaded ensure.
        let control = TempDb::new("fresh-init-control");
        let single_run_delta = {
            let conn = open_wal_conn(control.path());
            create_fixture_schema(&conn);
            insert_post(&conn, "p1", "oldword", Some("oldbody"));
            let before = schema_version(&conn);
            ensure_search_index(&conn).expect("control ensure failed");
            schema_version(&conn) - before
        };

        let tmp = TempDb::new("fresh-init-concurrent");
        let path = tmp.path().to_path_buf();
        {
            let conn = open_wal_conn(&path);
            create_fixture_schema(&conn);
            insert_post(&conn, "p1", "oldword", Some("oldbody"));
        }
        let schema_before = {
            let conn = open_wal_conn(&path);
            schema_version(&conn)
        };

        // Hold the write lock with an empty transaction so every worker
        // queues on it before the race is allowed to begin.
        let conn_ctrl = open_wal_conn(&path);
        conn_ctrl
            .execute_batch("BEGIN IMMEDIATE")
            .expect("control BEGIN IMMEDIATE failed");

        // Each worker registers its arrival on the write-lock wait via the
        // probe: the count rises only once that worker's BEGIN IMMEDIATE
        // has actually collided with the control transaction's lock.
        WORKER_PARK_COUNT.store(0, std::sync::atomic::Ordering::SeqCst);
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let conn = open_wal_conn(&path);
                    conn.busy_handler(Some(count_parked_worker_and_retry))
                        .expect("busy_handler installation failed");
                    ensure_search_index(&conn)
                })
            })
            .collect();

        // All four workers must be parked on the write lock before the race
        // starts — anything less means this test is not exercising the
        // contention its name claims. Poll every 10 ms, fail loudly after
        // 5 s.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while WORKER_PARK_COUNT.load(std::sync::atomic::Ordering::SeqCst) < 4 {
            if std::time::Instant::now() > deadline {
                panic!(
                    "not all 4 worker threads reached the write-lock wait within 5s; \
                     test is not exercising the race"
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // Release the lock writing nothing: the four-way race starts here.
        conn_ctrl
            .execute_batch("COMMIT")
            .expect("control COMMIT failed");
        for worker in workers {
            worker
                .join()
                .expect("worker thread panicked")
                .expect("concurrent first initialization must succeed for every thread");
        }

        let conn = open_wal_conn(&path);
        assert!(
            fts_triggers_current(&conn),
            "index must exist with current triggers after the concurrent initialization"
        );
        assert!(
            fts_is_external_content(&conn),
            "concurrently created index must be external-content"
        );
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            1,
            "the post must be searchable after the concurrent initialization"
        );
        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after the concurrent initialization"
        );
        assert_eq!(
            schema_version(&conn),
            schema_before + single_run_delta,
            "exactly one initialization may run (delta must equal the control's \
             single-run delta, not 2D/3D/4D)"
        );
    }

    // R3 guard: a read-only connection turns any write attempt into an
    // error — DDL, BEGIN IMMEDIATE on a work path, an FTS5 'rebuild', all
    // fail as "attempt to write a readonly database". So the second ensure
    // returning Ok on a read-only connection is direct proof that it
    // attempted zero writes (the posts_fts_data fingerprint cannot prove
    // this: a rebuild over identical content leaves it unchanged).
    #[test]
    fn second_ensure_attempts_no_writes() {
        // Fresh database, fully initialized by the first ensure.
        let fresh = TempDb::new("readonly-fresh");
        {
            let conn = open_wal_conn(fresh.path());
            create_fixture_schema(&conn);
            insert_post(&conn, "p1", "oldword", Some("oldbody"));
            ensure_search_index(&conn).expect("first ensure failed");
        }
        // Dropping the last writer checkpoints and removes the WAL files, so
        // the read-only open needs no -shm sidecar.
        {
            let conn = open_readonly_conn(fresh.path());
            ensure_search_index(&conn).expect(
                "second ensure must be a pure read — any write attempt (DDL, BEGIN \
                 IMMEDIATE, rebuild) errors on a read-only connection",
            );
            assert_eq!(
                fts_match_count(&conn, "oldword"),
                1,
                "the index must still be searchable through the read-only connection"
            );
        }

        // Same guarantee for the legacy-upgraded state: after the one-time
        // upgrade, a further ensure must also be write-free.
        let legacy = TempDb::new("readonly-legacy");
        {
            let conn = open_wal_conn(legacy.path());
            create_fixture_schema(&conn);
            insert_post(&conn, "p1", "oldword", Some("oldbody"));
            create_legacy_external_fts(&conn);
            conn.execute(
                "UPDATE posts SET title='newword', content_rendered_html='newbody' WHERE id='p1'",
                [],
            )
            .expect("drift update under legacy triggers failed");
            ensure_search_index(&conn).expect("legacy upgrade failed");
        }
        {
            let conn = open_readonly_conn(legacy.path());
            ensure_search_index(&conn).expect(
                "post-upgrade ensure must be a pure read — any write attempt (DDL, \
                 BEGIN IMMEDIATE, rebuild) errors on a read-only connection",
            );
            assert_eq!(
                fts_match_count(&conn, "newword"),
                1,
                "the upgraded index must still be searchable through the read-only connection"
            );
        }
    }

    // Permanence guard for the self-contained → external-content recreation:
    // a posts_fts created without content= (body text duplicated inside the
    // FTS table, posts_fts_content shadow table present) must be detected
    // and recreated in external-content mode.
    #[test]
    fn self_contained_index_is_recreated_as_external() {
        let conn = fixture_conn();
        insert_post(&conn, "p1", "oldword", Some("oldbody"));
        conn.execute_batch(
            "CREATE VIRTUAL TABLE posts_fts USING fts5(title, content_rendered_html);
             INSERT INTO posts_fts(title, content_rendered_html) VALUES('oldword', 'oldbody');",
        )
        .expect("self-contained fixture creation failed");

        ensure_search_index(&conn).expect("ensure failed to recreate the self-contained index");

        // Self-contained mode's content shadow table must be gone.
        let has_shadow: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='posts_fts_content'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            has_shadow, 0,
            "the _content shadow table must disappear together with the self-contained index"
        );
        assert!(
            fts_is_external_content(&conn),
            "the recreated index must be external-content"
        );
        assert!(
            fts_triggers_current(&conn),
            "the recreated index must have current triggers"
        );
        assert_eq!(
            fts_match_count(&conn, "oldword"),
            1,
            "the recreated index must be searchable"
        );
        assert!(
            integrity_check_ok(&conn),
            "integrity-check must pass after the recreation"
        );
    }
}

/// Drop and rebuild the FTS index from scratch — recovers from any drift or a
/// corrupt index without touching the source `posts` data.
#[tauri::command]
pub async fn rebuild_search_index(app: AppHandle) -> Result<(), String> {
    // Rebuilding rewrites the FTS table from every post's content — proportional
    // to the library size, so move it off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&app)?;
        conn.execute_batch(
            r#"
        DROP TRIGGER IF EXISTS posts_fts_ai;
        DROP TRIGGER IF EXISTS posts_fts_ad;
        DROP TRIGGER IF EXISTS posts_fts_au;
        DROP TABLE IF EXISTS posts_fts;
        "#,
        ).map_err(|e| e.to_string())?;
        ensure_search_index(&conn).map_err(|e| format!("FTS5 unavailable: {}", e))
    })
    .await
    .map_err(|e| format!("rebuild search index task failed: {}", e))?
}
