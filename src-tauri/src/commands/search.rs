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

/// Idempotently create the FTS5 index (self-contained: stores its own copy of
/// title + content, kept synced by triggers on `posts`) and backfill it from the
/// existing posts. Returns Err if the bundled SQLite lacks FTS5 — callers then
/// fall back to a LIKE scan. Only builds when the table is absent, so it never
/// double-backfills.
pub fn ensure_search_index(conn: &Connection) -> Result<(), rusqlite::Error> {
    if posts_fts_exists(conn) {
        return Ok(());
    }
    conn.execute_batch(
        r#"
        CREATE VIRTUAL TABLE posts_fts USING fts5(title, content);

        CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
            INSERT INTO posts_fts(rowid, title, content)
            VALUES (new.rowid, new.title, new.content_rendered_html);
        END;
        CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
            DELETE FROM posts_fts WHERE rowid = old.rowid;
        END;
        CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
            DELETE FROM posts_fts WHERE rowid = old.rowid;
            INSERT INTO posts_fts(rowid, title, content)
            VALUES (new.rowid, new.title, new.content_rendered_html);
        END;

        INSERT INTO posts_fts(rowid, title, content)
        SELECT rowid, title, content_rendered_html FROM posts;
        "#,
    )
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
    let like = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
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
pub fn search_posts(app: AppHandle, query: String, limit: Option<i64>) -> Result<Vec<SearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let conn = open_db(&app)?;

    if ensure_search_index(&conn).is_ok() {
        // A malformed MATCH (shouldn't happen after quoting) falls back to LIKE.
        if let Ok(results) = run_fts_query(&conn, &build_fts_match(q), limit) {
            return Ok(results);
        }
    }
    run_like_query(&conn, q, limit).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
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
}

/// Drop and rebuild the FTS index from scratch — recovers from any drift or a
/// corrupt index without touching the source `posts` data.
#[tauri::command]
pub fn rebuild_search_index(app: AppHandle) -> Result<(), String> {
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
}
