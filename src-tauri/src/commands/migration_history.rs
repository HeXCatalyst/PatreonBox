use tauri::{AppHandle, Emitter};
use super::util::open_db;

/// One row of the image-migration history list, serialized to the frontend.
/// `source_dir`/`target_dir` are the absolute paths involved; `is_restore` is
/// true when the migration was a "Restore Default" (target_dir was None at the
/// call site, resolved to the app-data default by `migrate_images_dir`).
#[derive(serde::Serialize)]
pub struct MigrationRecord {
    pub id: i64,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub source_dir: String,
    pub target_dir: String,
    pub is_restore: bool,
    pub file_count: Option<i64>,
    pub total_bytes: Option<i64>,
    pub copied_bytes: Option<i64>,
    pub verify_mode: String,
    pub status: String, // "running" | "success" | "failed" | "rolled_back"
    pub error: Option<String>,
}

/// Open a migration record: insert a 'running' row and return its id. Recording
/// is best-effort — any DB error returns None so a migration never fails just
/// because its history row couldn't be written. Also closes out any orphaned
/// 'running' row (left behind by a crash / hard-quit mid-migration) as 'failed'.
/// At most one migration can be running at a time (enforced by the process-wide
/// `ImageMigrationLock`), so there's no per-source scoping here.
pub fn record_migration_start(
    app: &AppHandle,
    source_dir: &str,
    target_dir: &str,
    is_restore: bool,
    verify_mode: &str,
) -> Option<i64> {
    let conn = open_db(app).ok()?;
    let now = chrono::Utc::now().to_rfc3339();
    // Reap any orphaned 'running' row from a previous process that died mid-
    // migration. (The `setup` hook also does this on launch; this covers the
    // theoretical case of a second migration starting in the same process after
    // a panic that somehow didn't unwind the lock — defensive, not expected.)
    let _ = conn.execute(
        "UPDATE image_migrations SET status='failed', finished_at=?1, error='进程中断' WHERE status='running'",
        rusqlite::params![now],
    );
    conn.execute(
        "INSERT INTO image_migrations (started_at, source_dir, target_dir, is_restore, verify_mode, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'running')",
        rusqlite::params![now, source_dir, target_dir, is_restore as i64, verify_mode],
    ).ok()?;
    conn.last_insert_rowid().into()
}

/// Best-effort mid-migration progress update for `copied_bytes`. Called
/// periodically from the copy loop so a crash leaves a record showing how far
/// the copy got, not a flat zero.
pub fn record_migration_progress(app: &AppHandle, record_id: &Option<i64>, copied_bytes: u64) {
    let Some(id) = record_id else { return; };
    if let Ok(conn) = open_db(app) {
        let _ = conn.execute(
            "UPDATE image_migrations SET copied_bytes=?1 WHERE id=?2",
            rusqlite::params![copied_bytes as i64, id],
        );
    }
}

/// Close a record opened by `record_migration_start`. No-op if `record_id` is
/// None (recording was unavailable at start). `status` is "success" | "failed"
/// | "rolled_back". `error` is the failure message, if any.
pub fn record_migration_finish(
    app: &AppHandle,
    record_id: &Option<i64>,
    status: &str,
    file_count: usize,
    total_bytes: u64,
    copied_bytes: u64,
    error: Option<&str>,
) {
    let Some(id) = record_id else { return; };
    if let Ok(conn) = open_db(app) {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE image_migrations
             SET finished_at=?1, status=?2, file_count=?3, total_bytes=?4, copied_bytes=?5, error=?6
             WHERE id=?7",
            rusqlite::params![now, status, file_count as i64, total_bytes as i64, copied_bytes as i64, error, id],
        );
    }
    // Nudge the history list / Storage summary card to refresh.
    let _ = app.emit("image-migrations-changed", ());
}

/// Called from `setup` on every launch: any 'running' row is an orphan left by
/// a process that died mid-migration (the lock is process-wide, so no live
/// migration can survive a restart). Mark them 'failed' with the reason, so the
/// history list never shows a permanently-running entry.
pub fn cleanup_orphan_runs(app: &AppHandle) {
    if let Ok(conn) = open_db(app) {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE image_migrations SET status='failed', finished_at=?1, error='进程中断' WHERE status='running'",
            rusqlite::params![now],
        );
    }
}

#[tauri::command]
pub fn get_migration_history(app: AppHandle, limit: Option<i64>) -> Result<Vec<MigrationRecord>, String> {
    let conn = open_db(&app)?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let mut stmt = conn.prepare(
        "SELECT id, started_at, finished_at, source_dir, target_dir, is_restore,
                file_count, total_bytes, copied_bytes, verify_mode, status, error
         FROM image_migrations
         ORDER BY started_at DESC
         LIMIT ?1",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![limit], |row| {
        Ok(MigrationRecord {
            id: row.get(0)?,
            started_at: row.get(1)?,
            finished_at: row.get(2)?,
            source_dir: row.get(3)?,
            target_dir: row.get(4)?,
            is_restore: row.get::<_, i64>(5)? != 0,
            file_count: row.get(6)?,
            total_bytes: row.get(7)?,
            copied_bytes: row.get(8)?,
            verify_mode: row.get(9)?,
            status: row.get(10)?,
            error: row.get(11)?,
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Most-recent migration record (any status), for the Storage page's "last
/// migration" summary card. None if there's never been one.
#[tauri::command]
pub fn get_last_migration(app: AppHandle) -> Result<Option<MigrationRecord>, String> {
    let conn = open_db(&app)?;
    conn.query_row(
        "SELECT id, started_at, finished_at, source_dir, target_dir, is_restore,
                file_count, total_bytes, copied_bytes, verify_mode, status, error
         FROM image_migrations
         ORDER BY started_at DESC
         LIMIT 1",
        [],
        |row| {
            Ok(MigrationRecord {
                id: row.get(0)?,
                started_at: row.get(1)?,
                finished_at: row.get(2)?,
                source_dir: row.get(3)?,
                target_dir: row.get(4)?,
                is_restore: row.get::<_, i64>(5)? != 0,
                file_count: row.get(6)?,
                total_bytes: row.get(7)?,
                copied_bytes: row.get(8)?,
                verify_mode: row.get(9)?,
                status: row.get(10)?,
                error: row.get(11)?,
            })
        },
    ).map(Some).or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.to_string()),
    })
}

#[tauri::command]
pub fn clear_migration_history(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    // Keep 'running' rows (shouldn't exist post-cleanup, but defensive) so a live
    // migration's record is never silently deleted out from under it.
    conn.execute("DELETE FROM image_migrations WHERE status != 'running'", [])
        .map_err(|e| e.to_string())?;
    let _ = app.emit("image-migrations-changed", ());
    Ok(())
}
