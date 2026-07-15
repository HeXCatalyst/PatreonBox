use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use super::util::{build_http_client, open_db};

/// One row in the global Downloads page. Serialized to the frontend.
#[derive(Clone, serde::Serialize)]
pub struct DownloadJob {
    pub asset_id: String,
    pub creator_id: String,
    pub file_name: String,
    pub status: String, // "queued" | "downloading" | "done" | "failed"
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub error: Option<String>,
}

/// Full queue state for the frontend: the job list plus whether the queue is
/// paused (which the job rows alone can't convey — a paused queue still has
/// "queued" jobs). Drives the animated Downloads icon's three states.
#[derive(Clone, serde::Serialize)]
pub struct DownloadState {
    pub jobs: Vec<DownloadJob>,
    pub paused: bool,
}

struct JobEntry {
    job: DownloadJob,
    source_url: String,
    dest: std::path::PathBuf,
    attempts: u32,
}

pub struct DownloadManager {
    order: Vec<String>,                  // asset_ids, insertion order
    entries: HashMap<String, JobEntry>,
    paused: bool,
    active: usize,
    supervisor_running: bool,
}

impl DownloadManager {
    fn new() -> Self {
        DownloadManager { order: Vec::new(), entries: HashMap::new(), paused: false, active: 0, supervisor_running: false }
    }
    fn snapshot(&self) -> Vec<DownloadJob> {
        self.order.iter().filter_map(|id| self.entries.get(id)).map(|e| e.job.clone()).collect()
    }
    fn has_queued(&self) -> bool {
        self.order.iter().any(|id| self.entries.get(id).map(|e| e.job.status == "queued").unwrap_or(false))
    }
}

pub struct DownloadManagerState(pub Arc<Mutex<DownloadManager>>);
impl DownloadManagerState {
    pub fn new() -> Self { DownloadManagerState(Arc::new(Mutex::new(DownloadManager::new()))) }
}

fn emit_job(app: &AppHandle, job: &DownloadJob) {
    let _ = app.emit("download-job-update", job);
}

/// Read the live concurrency / retry / delay settings each time (so changes apply mid-run).
fn read_download_settings(app: &AppHandle) -> (usize, u32, bool, u32, bool, u32) {
    let state = app.state::<super::settings::AppSettingsState>();
    let s = state.0.read().unwrap_or_else(|e| e.into_inner());
    (
        (s.download_concurrency.clamp(1, 5)) as usize,
        s.download_retries,
        s.image_download_delay_enabled,
        s.image_download_delay_ms,
        s.image_download_jitter_enabled,
        s.image_download_jitter_ms,
    )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Enqueue a creator's pending assets (or a specific set) and make sure the worker
/// pool is draining the queue. "pending" = downloaded_at IS NULL AND download_error
/// IS NULL, restricted to the enabled asset types.
#[tauri::command]
pub async fn start_downloads(
    app: AppHandle,
    creator_id: Option<String>,
    asset_ids: Option<Vec<String>>,
    enabled_types: Option<Vec<String>>,
) -> Result<usize, String> {
    // Collect the assets to enqueue synchronously (rusqlite is !Send).
    struct Row { id: String, creator_id: String, source_url: String, local_path: String, file_name: String }
    let rows: Vec<Row> = {
        let conn = open_db(&app)?;
        let type_filter = match &enabled_types {
            Some(types) if !types.is_empty() => {
                let ph: Vec<String> = types.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
                format!("AND (a.media_type IN ({}) OR a.media_type IS NULL)", ph.join(", "))
            }
            _ => String::new(),
        };
        let (scope, first_param): (&str, rusqlite::types::Value) = if let Some(cid) = &creator_id {
            ("p.creator_id = ?1", rusqlite::types::Value::Text(cid.clone()))
        } else if let Some(ids) = &asset_ids {
            // handled below via IN clause; use a dummy first param slot
            let _ = ids;
            ("1 = ?1", rusqlite::types::Value::Integer(1))
        } else {
            ("1 = ?1", rusqlite::types::Value::Integer(1))
        };
        let id_filter = match &asset_ids {
            Some(ids) if !ids.is_empty() => {
                let base = 2 + enabled_types.as_ref().map(|t| t.len()).unwrap_or(0);
                let ph: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", base + i)).collect();
                format!("AND a.id IN ({})", ph.join(", "))
            }
            _ => String::new(),
        };
        let sql = format!(
            "SELECT a.id, p.creator_id, a.source_url, a.local_path, a.file_name
             FROM assets a JOIN posts p ON a.post_id = p.id
             WHERE {scope}
               AND a.downloaded_at IS NULL AND a.download_error IS NULL
               AND a.source_url IS NOT NULL
               {type_filter} {id_filter}
             ORDER BY a.created_at ASC"
        );
        let mut params: Vec<rusqlite::types::Value> = vec![first_param];
        if let Some(types) = &enabled_types {
            params.extend(types.iter().map(|t| rusqlite::types::Value::Text(t.clone())));
        }
        if let Some(ids) = &asset_ids {
            params.extend(ids.iter().map(|i| rusqlite::types::Value::Text(i.clone())));
        }
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mapped = stmt.query_map(rusqlite::params_from_iter(params), |r| {
            Ok(Row { id: r.get(0)?, creator_id: r.get(1)?, source_url: r.get(2)?, local_path: r.get(3)?, file_name: r.get(4)? })
        }).map_err(|e| e.to_string())?;
        mapped.filter_map(|r| r.ok()).collect()
    };

    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut added = 0usize;
    {
        let mut m = mgr_arc.lock().await;
        for row in rows {
            // Skip assets already tracked as queued/downloading.
            if let Some(e) = m.entries.get(&row.id) {
                if e.job.status == "queued" || e.job.status == "downloading" { continue; }
            }
            let dest = super::file_ops::asset_full_path(&app, &row.local_path)?;
            let job = DownloadJob {
                asset_id: row.id.clone(),
                creator_id: row.creator_id,
                file_name: row.file_name,
                status: "queued".into(),
                bytes_done: 0,
                bytes_total: None,
                error: None,
            };
            if !m.entries.contains_key(&row.id) { m.order.push(row.id.clone()); }
            m.entries.insert(row.id.clone(), JobEntry { job: job.clone(), source_url: row.source_url, dest, attempts: 0 });
            emit_job(&app, &job);
            added += 1;
        }
        ensure_supervisor(&app, &mgr_arc, &mut m);
    }
    Ok(added)
}

#[tauri::command]
pub async fn get_download_state(app: AppHandle) -> DownloadState {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let m = mgr_arc.lock().await;
    DownloadState { jobs: m.snapshot(), paused: m.paused }
}

#[tauri::command]
pub async fn pause_downloads(app: AppHandle) {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut m = mgr_arc.lock().await;
    m.paused = true;
    // Pause/resume don't touch job rows, so emit a dedicated event to keep the
    // frontend's paused state (and the animated icon) in sync across views.
    let _ = app.emit("download-paused", true);
}

#[tauri::command]
pub async fn resume_downloads(app: AppHandle) {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut m = mgr_arc.lock().await;
    m.paused = false;
    let _ = app.emit("download-paused", false);
    ensure_supervisor(&app, &mgr_arc, &mut m);
}

/// Remove a job from the queue / list. An in-flight download is left to finish
/// (its file is fine); it simply won't be retried. Queued/failed/done are dropped.
#[tauri::command]
pub async fn cancel_download(app: AppHandle, asset_id: String) {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut m = mgr_arc.lock().await;
    let downloading = m.entries.get(&asset_id).map(|e| e.job.status == "downloading").unwrap_or(false);
    if !downloading {
        m.entries.remove(&asset_id);
        m.order.retain(|id| id != &asset_id);
    } else if let Some(e) = m.entries.get_mut(&asset_id) {
        // Mark so the worker discards the result instead of requeuing.
        e.job.status = "cancelled".into();
    }
}

/// Clear a previous failure and re-queue the asset.
#[tauri::command]
pub async fn retry_download(app: AppHandle, asset_id: String) -> Result<(), String> {
    if let Ok(conn) = open_db(&app) {
        let _ = conn.execute("UPDATE assets SET download_error = NULL WHERE id = ?1", rusqlite::params![asset_id]);
    }
    start_downloads(app, None, Some(vec![asset_id]), None).await.map(|_| ())
}

/// Clear all recorded failures (optionally for one creator) and re-queue them.
#[tauri::command]
pub async fn retry_all_failed(app: AppHandle, creator_id: Option<String>) -> Result<usize, String> {
    let ids: Vec<String> = {
        let conn = open_db(&app)?;
        let (sql, param): (&str, Option<String>) = match &creator_id {
            Some(_) => (
                "SELECT a.id FROM assets a JOIN posts p ON a.post_id = p.id WHERE a.download_error IS NOT NULL AND p.creator_id = ?1",
                creator_id.clone(),
            ),
            None => ("SELECT id FROM assets WHERE download_error IS NOT NULL", None),
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let map = |r: &rusqlite::Row| r.get::<_, String>(0);
        let rows = if let Some(p) = &param {
            stmt.query_map(rusqlite::params![p], map)
        } else {
            stmt.query_map([], map)
        }.map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if ids.is_empty() { return Ok(0); }
    if let Ok(conn) = open_db(&app) {
        for id in &ids {
            let _ = conn.execute("UPDATE assets SET download_error = NULL WHERE id = ?1", rusqlite::params![id]);
        }
    }
    start_downloads(app, None, Some(ids), None).await
}

/// Drop the finished-job rows from the in-memory list (files are untouched).
#[tauri::command]
pub async fn clear_completed_downloads(app: AppHandle) {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut m = mgr_arc.lock().await;
    let done: Vec<String> = m.order.iter()
        .filter(|id| m.entries.get(*id).map(|e| e.job.status == "done").unwrap_or(false))
        .cloned().collect();
    for id in done { m.entries.remove(&id); m.order.retain(|x| x != &id); }
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

/// Start the supervisor loop if it isn't already running. Called while holding the lock.
fn ensure_supervisor(app: &AppHandle, mgr_arc: &Arc<Mutex<DownloadManager>>, m: &mut DownloadManager) {
    if m.supervisor_running || m.paused || !m.has_queued() {
        return;
    }
    m.supervisor_running = true;
    let app = app.clone();
    let mgr_arc = mgr_arc.clone();
    tauri::async_runtime::spawn(async move { supervisor(app, mgr_arc).await; });
}

/// Keeps up to `concurrency` downloads in flight, draining the queue. Exits when the
/// queue is empty (and nothing active) or the manager is paused.
async fn supervisor(app: AppHandle, mgr_arc: Arc<Mutex<DownloadManager>>) {
    loop {
        let mut launch: Vec<String> = Vec::new();
        {
            let mut m = mgr_arc.lock().await;
            let (concurrency, ..) = read_download_settings(&app);
            if !m.paused {
                let slots = concurrency.saturating_sub(m.active);
                let queued: Vec<String> = m.order.iter()
                    .filter(|id| m.entries.get(*id).map(|e| e.job.status == "queued").unwrap_or(false))
                    .take(slots)
                    .cloned()
                    .collect();
                for id in &queued {
                    if let Some(e) = m.entries.get_mut(id) {
                        e.job.status = "downloading".into();
                        e.job.bytes_done = 0;
                        emit_job(&app, &e.job);
                    }
                    m.active += 1;
                }
                launch = queued;
            }
            // Nothing to do and nothing running → stop the supervisor.
            if launch.is_empty() && m.active == 0 {
                m.supervisor_running = false;
                return;
            }
        }
        for asset_id in launch {
            let app = app.clone();
            let mgr_arc = mgr_arc.clone();
            tauri::async_runtime::spawn(async move { run_download(app, mgr_arc, asset_id).await; });
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

enum DlOutcome { Ok(u64), Transient(String), Permanent(String) }

async fn run_download(app: AppHandle, mgr_arc: Arc<Mutex<DownloadManager>>, asset_id: String) {
    let (source_url, dest) = {
        let m = mgr_arc.lock().await;
        match m.entries.get(&asset_id) {
            Some(e) => (e.source_url.clone(), e.dest.clone()),
            None => { return; }
        }
    };

    let client = build_http_client(&app);
    let outcome = download_streaming(&app, &mgr_arc, &asset_id, &client, &source_url, &dest).await;

    // Per-request pacing to avoid CDN rate-limiting (kept per worker).
    let (_, retries, delay_enabled, delay_ms, jitter_enabled, jitter_ms) = read_download_settings(&app);
    if delay_enabled {
        let jitter = if jitter_enabled { fastrand::u32(0..jitter_ms.max(1)) } else { 0 };
        tokio::time::sleep(Duration::from_millis((delay_ms + jitter) as u64)).await;
    }

    let mut m = mgr_arc.lock().await;
    m.active = m.active.saturating_sub(1);
    // If the user cancelled this job mid-flight, drop it.
    if m.entries.get(&asset_id).map(|e| e.job.status == "cancelled").unwrap_or(true) {
        m.entries.remove(&asset_id);
        m.order.retain(|id| id != &asset_id);
        return;
    }
    match outcome {
        DlOutcome::Ok(size) => {
            if let Ok(conn) = open_db(&app) {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = conn.execute(
                    "UPDATE assets SET downloaded_at = ?1, byte_size = ?2, download_error = NULL WHERE id = ?3",
                    rusqlite::params![now, size as i64, asset_id],
                );
            }
            if let Some(e) = m.entries.get_mut(&asset_id) {
                e.job.status = "done".into();
                e.job.bytes_done = size;
                e.job.bytes_total = Some(size);
                e.job.error = None;
                emit_job(&app, &e.job);
            }
        }
        DlOutcome::Transient(msg) => {
            let mut requeued = false;
            if let Some(e) = m.entries.get_mut(&asset_id) {
                if e.attempts < retries {
                    e.attempts += 1;
                    e.job.status = "queued".into();
                    e.job.error = None;
                    emit_job(&app, &e.job);
                    requeued = true;
                }
            }
            if !requeued {
                fail_job(&app, &mut m, &asset_id, msg);
            }
        }
        DlOutcome::Permanent(msg) => fail_job(&app, &mut m, &asset_id, msg),
    }
}

fn fail_job(app: &AppHandle, m: &mut DownloadManager, asset_id: &str, msg: String) {
    if let Ok(conn) = open_db(app) {
        let _ = conn.execute("UPDATE assets SET download_error = ?1 WHERE id = ?2", rusqlite::params![msg, asset_id]);
    }
    if let Some(e) = m.entries.get_mut(asset_id) {
        e.job.status = "failed".into();
        e.job.error = Some(msg);
        emit_job(app, &e.job);
    }
}

/// Streams the response body to a temp file (bounded memory), emitting throttled
/// byte progress, then atomically renames into place.
async fn download_streaming(
    app: &AppHandle,
    mgr_arc: &Arc<Mutex<DownloadManager>>,
    asset_id: &str,
    client: &reqwest::Client,
    source_url: &str,
    dest: &std::path::Path,
) -> DlOutcome {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Already on disk (e.g. pre-migration): count it as done.
    if dest.exists() {
        let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
        return DlOutcome::Ok(size);
    }

    let mut resp = match client.get(source_url).send().await {
        Ok(r) => r,
        Err(e) => return DlOutcome::Transient(format!("request failed: {}", e)),
    };
    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let msg = format!("HTTP {}", code);
        // Expired/forbidden/gone links won't recover on retry.
        return if matches!(code, 401 | 403 | 404 | 410) { DlOutcome::Permanent(msg) } else { DlOutcome::Transient(msg) };
    }

    let total = resp.content_length();
    if let Some(e) = mgr_arc.lock().await.entries.get_mut(asset_id) {
        e.job.bytes_total = total;
    }

    let tmp = dest.with_extension("part");
    let mut file = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(e) => return DlOutcome::Permanent(format!("create temp: {}", e)),
    };
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk) {
                    let _ = std::fs::remove_file(&tmp);
                    return DlOutcome::Permanent(format!("write: {}", e));
                }
                downloaded += chunk.len() as u64;
                if last_emit.elapsed() >= Duration::from_millis(150) {
                    last_emit = Instant::now();
                    let mut m = mgr_arc.lock().await;
                    // Cancelled mid-stream → stop.
                    if m.entries.get(asset_id).map(|e| e.job.status == "cancelled").unwrap_or(true) {
                        drop(file);
                        let _ = std::fs::remove_file(&tmp);
                        return DlOutcome::Permanent("cancelled".into());
                    }
                    if let Some(e) = m.entries.get_mut(asset_id) {
                        e.job.bytes_done = downloaded;
                        emit_job(app, &e.job);
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return DlOutcome::Transient(format!("stream: {}", e));
            }
        }
    }

    if let Err(e) = file.flush() {
        let _ = std::fs::remove_file(&tmp);
        return DlOutcome::Permanent(format!("flush: {}", e));
    }
    drop(file);
    if let Err(e) = std::fs::rename(&tmp, dest) {
        let _ = std::fs::remove_file(&tmp);
        return DlOutcome::Permanent(format!("rename: {}", e));
    }
    DlOutcome::Ok(downloaded)
}
