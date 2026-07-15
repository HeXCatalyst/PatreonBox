use tauri::{AppHandle, Emitter, Manager};
use super::util::open_db;

/// `source_key` sentinel for a subscription-list sync (which scans creators, not
/// a single creator's posts). Per-creator post syncs use the creator's id.
pub const SUBSCRIPTIONS_KEY: &str = "__subscriptions__";

/// One row of the Sync History list, serialized to the frontend. `creator_name`
/// is resolved from the creators table (NULL for the subscriptions sentinel or a
/// since-deleted creator).
#[derive(serde::Serialize)]
pub struct SyncRunView {
    pub id: String,
    pub source_key: String,
    pub creator_name: Option<String>,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub creators_scanned: i64,
    pub posts_imported: i64,
    pub error_message: Option<String>,
}

/// Open a run: insert a 'running' row and return its id. Recording is best-effort
/// — any DB error returns None so a sync never fails just because its history row
/// couldn't be written. Also closes out any orphaned 'running' row for the same
/// source (left behind by a crash / hard-quit mid-sync) as 'interrupted'.
pub fn start_run(app: &AppHandle, source_key: &str) -> Option<String> {
    let conn = open_db(app).ok()?;
    let now = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE sync_runs SET status='interrupted', finished_at=?1 WHERE status='running' AND source_key=?2",
        rusqlite::params![now, source_key],
    );
    let id = format!("{}-{:016x}", chrono::Utc::now().timestamp_millis(), fastrand::u64(..));
    conn.execute(
        "INSERT INTO sync_runs (id, source_key, status, started_at) VALUES (?1, ?2, 'running', ?3)",
        rusqlite::params![id, source_key, now],
    ).ok()?;
    Some(id)
}

/// Close a run opened by `start_run`. No-op if `run_id` is None (recording was
/// unavailable at start). `status` is "success" | "failed" | "cancelled".
pub fn finish_run(
    app: &AppHandle,
    run_id: &Option<String>,
    status: &str,
    creators_scanned: i64,
    posts_imported: i64,
    error: Option<String>,
) {
    let Some(id) = run_id else { return; };
    if let Ok(conn) = open_db(app) {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE sync_runs SET status=?1, finished_at=?2, creators_scanned=?3, posts_imported=?4, error_message=?5 WHERE id=?6",
            rusqlite::params![status, now, creators_scanned, posts_imported, error, id],
        );
    }
    // Nudge the sidebar's error dot / history list to refresh.
    let _ = app.emit("sync-runs-changed", ());
}

/// Count posts for a creator — used to derive a run's `posts_imported` as the
/// after-minus-before delta (new posts; re-synced/upserted posts don't count).
pub fn creator_post_count(app: &AppHandle, creator_id: &str) -> i64 {
    open_db(app)
        .and_then(|conn| {
            conn.query_row(
                "SELECT count(*) FROM posts WHERE creator_id = ?1",
                rusqlite::params![creator_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
        })
        .unwrap_or(0)
}

#[tauri::command]
pub fn get_sync_runs(app: AppHandle, limit: Option<i64>) -> Result<Vec<SyncRunView>, String> {
    let conn = open_db(&app)?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let mut stmt = conn.prepare(
        "SELECT r.id, r.source_key, c.name, r.status, r.started_at, r.finished_at,
                r.creators_scanned, r.posts_imported, r.error_message
         FROM sync_runs r
         LEFT JOIN creators c ON c.id = r.source_key
         ORDER BY r.started_at DESC
         LIMIT ?1",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![limit], |row| {
        Ok(SyncRunView {
            id: row.get(0)?,
            source_key: row.get(1)?,
            creator_name: row.get(2)?,
            status: row.get(3)?,
            started_at: row.get(4)?,
            finished_at: row.get(5)?,
            creators_scanned: row.get(6)?,
            posts_imported: row.get(7)?,
            error_message: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn clear_sync_runs(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM sync_runs", []).map_err(|e| e.to_string())?;
    Ok(())
}

/// Number of failed runs the user hasn't seen yet — drives the sidebar's passive
/// error dot. "Seen" is the `last_seen_sync_runs_at` settings timestamp; a failed
/// run started after it counts as unseen.
#[tauri::command]
pub fn get_unseen_failed_count(app: AppHandle) -> Result<i64, String> {
    let last_seen = {
        let state = app.state::<super::settings::AppSettingsState>();
        let s = state.0.read().map_err(|e| e.to_string())?;
        s.last_seen_sync_runs_at.clone()
    };
    let conn = open_db(&app)?;
    let count: i64 = conn.query_row(
        "SELECT count(*) FROM sync_runs WHERE status='failed' AND started_at > ?1",
        rusqlite::params![last_seen],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(count)
}

/// Mark all current runs as seen: stamp `last_seen_sync_runs_at` = now and persist.
#[tauri::command]
pub fn mark_sync_runs_seen(app: AppHandle) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let state = app.state::<super::settings::AppSettingsState>();
    let settings = {
        let mut s = state.0.write().map_err(|e| e.to_string())?;
        s.last_seen_sync_runs_at = now;
        s.clone()
    };
    // Persist to settings.json so the dot stays cleared across restarts.
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    let _ = app.emit("sync-runs-changed", ());
    Ok(())
}
