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
    pub status: String, // "queued" | "downloading" | "paused" | "done" | "failed" | "cancelled"
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

/// The slice of a job the always-mounted app shell needs (P1-6): identity and
/// status, nothing else. `get_download_state` ships whole rows — file names, byte
/// counters, error strings — and the root pulled that entire list on every launch
/// only to count the outstanding jobs for the sidebar badge.
#[derive(Clone, serde::Serialize)]
pub struct DownloadJobLite {
    pub asset_id: String,
    pub status: String,
}

/// Summary-only queue state: the outstanding jobs plus the queue-wide pause flag
/// (a paused queue still has "queued" rows, so the rows alone can't convey it).
#[derive(Clone, serde::Serialize)]
pub struct DownloadSummaryState {
    pub active: Vec<DownloadJobLite>,
    pub paused: bool,
}

struct JobEntry {
    job: DownloadJob,
    source_url: String,
    dest: std::path::PathBuf,
    attempts: u32,
    /// Bytes already on disk in this job's `.part` file that the next attempt
    /// should resume from. Zero means start clean.
    ///
    /// Session-scoped on purpose. Patreon's CDN links are signed and expire, so
    /// a `.part` left over from a previous run may belong to a URL that no
    /// longer serves the same bytes — appending to it with a Range request
    /// would silently produce a corrupt file. Only a pause or retry *within
    /// this run*, where the URL is known to be the same one, sets this.
    resume_from: u64,
}

/// Cached HTTP client + the proxy settings it was built for, so we only rebuild
/// the expensive Client (native-tls stack init + `scutil` proxy resolution) when
/// the proxy mode/url or timeout actually changes — not once per download.
/// reqwest::Client is internally an Arc, so clone is cheap.
struct CachedClient {
    client: reqwest::Client,
    proxy_mode: String,
    proxy_url: Option<String>,
    timeout_secs: u32,
}

pub struct DownloadManager {
    order: Vec<String>,                  // asset_ids, insertion order
    entries: HashMap<String, JobEntry>,
    paused: bool,
    active: usize,
    supervisor_running: bool,
    cached_client: Option<CachedClient>,
    /// Patreon session-cookie header plus when it was read (P2-2). `patreon_cookie_header`
    /// hops to the webview thread for a full cookie-store read; a 500-file queue
    /// used to pay that round trip once per file. The `None` case is cached too —
    /// a signed-out webview shouldn't be re-interrogated per download either.
    cached_cookie: Option<(Option<String>, Instant)>,
}

impl DownloadManager {
    fn new() -> Self {
        DownloadManager {
            order: Vec::new(),
            entries: HashMap::new(),
            paused: false,
            active: 0,
            supervisor_running: false,
            cached_client: None,
            cached_cookie: None,
        }
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

/// Where a download's in-progress bytes live.
///
/// Appends `.part` rather than using `with_extension`, which *replaces* the
/// extension — "a.zip" and "a.jpg" would both map to "a.part" and clobber each
/// other mid-download.
fn part_path(dest: &std::path::Path) -> std::path::PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    dest.with_file_name(name)
}

/// Delete a job's partial bytes. Called when a job is cancelled or abandoned, so
/// half-finished files don't accumulate in the images directory.
fn remove_partial(dest: &std::path::Path) {
    let _ = std::fs::remove_file(part_path(dest));
}

fn emit_job(app: &AppHandle, job: &DownloadJob) {
    let _ = app.emit("download-job-update", job);
}

/// Drop a job from the queue and tell the frontend it's gone.
///
/// The removal event matters: `download-job-update` is an upsert on the
/// frontend, so a deleted job has no way to express itself through that channel
/// and the row would linger until something happened to call `refresh()`. That
/// left a cancelled in-flight download visibly "downloading" — with a ticking
/// progress bar — well after the user cancelled it, and kept it counted in the
/// sidebar badge.
fn remove_job(app: &AppHandle, m: &mut DownloadManager, asset_id: &str) {
    m.entries.remove(asset_id);
    m.order.retain(|id| id != asset_id);
    let _ = app.emit("download-job-removed", asset_id);
}

/// Bulk form of `remove_job`: one pass over `order` regardless of how many jobs
/// are being dropped.
fn remove_jobs(app: &AppHandle, m: &mut DownloadManager, asset_ids: &[String]) {
    if asset_ids.is_empty() { return; }
    let doomed: std::collections::HashSet<&str> = asset_ids.iter().map(|s| s.as_str()).collect();
    m.order.retain(|id| !doomed.contains(id.as_str()));
    for id in asset_ids {
        m.entries.remove(id);
        let _ = app.emit("download-job-removed", id);
    }
}

/// How many finished jobs the in-memory queue keeps (P2-10).
///
/// Completed rows are history for the Downloads page, and nothing pruned them:
/// a 10k-file batch left 10k jobs resident for the rest of the session, so every
/// snapshot — including the launch seed — paid for all of them. The newest 200
/// are more than anyone scrolls back through, and `clear_completed_downloads`
/// still clears them on demand.
const MAX_DONE_JOBS: usize = 200;

/// Ids of the done jobs to drop so at most `max` remain, oldest first. Pure, so
/// the eviction order is unit-testable without a manager or an app handle.
/// Only `done` rows are candidates: a failed job is still actionable, and a
/// cancelled one is removed by its own worker.
fn excess_done_jobs(
    order: &[String],
    entries: &HashMap<String, JobEntry>,
    max: usize,
) -> Vec<String> {
    let done: Vec<&String> = order.iter()
        .filter(|id| entries.get(*id).map(|e| e.job.status == "done").unwrap_or(false))
        .collect();
    if done.len() <= max { return Vec::new(); }
    done[..done.len() - max].iter().map(|id| (*id).clone()).collect()
}

/// Read the live concurrency / retry / delay settings each time (so changes apply mid-run).
fn read_download_settings(app: &AppHandle) -> (usize, u32, bool, u32, bool, u32) {
    let state = app.state::<super::settings::AppSettingsState>();
    let s = state.0.read().unwrap_or_else(|e| e.into_inner());
    (
        (s.download_concurrency.clamp(1, 10)) as usize,
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
    // When downloading a whole creator, optionally scope to just its newest N
    // posts (matches the toolbar's post-count field). Ignored for asset-id
    // downloads. None = every post.
    max_posts: Option<u32>,
) -> Result<usize, String> {
    // Collect the assets to enqueue synchronously (rusqlite is !Send).
    struct Row { id: String, creator_id: String, source_url: String, local_path: String, file_name: String }
    let rows: Vec<Row> = {
        let conn = open_db(&app)?;
        // An explicit whole-creator download is a deliberate user action, so also
        // re-attempt assets that previously errored (e.g. attachments/videos that
        // 403'd before auth cookies were wired up). Clear their error flag so the
        // SELECT below re-enqueues them instead of skipping on `download_error IS NULL`.
        //
        // Permanent failures are deliberately left alone. download_streaming
        // already decides which HTTP codes can't recover (401/403/404/410 — an
        // expired signed CDN link, a deleted file) and records that verdict as
        // download_error_kind; clearing it too would throw that work away and
        // re-queue hundreds of guaranteed-to-fail requests on every click, each
        // one paying the full request + pacing delay while pushing genuinely new
        // assets to the back of the queue. Re-syncing the creator's posts mints
        // fresh signed URLs; `retry_download` / `retry_all_failed` are the
        // escape hatch once that's happened, since those target failed rows
        // explicitly and clear the kind regardless of its value. NULL kind =
        // recorded before this column existed, so those keep the old
        // retry-everything behaviour.
        if let Some(cid) = &creator_id {
            let _ = conn.execute(
                "UPDATE assets SET download_error = NULL, download_error_kind = NULL
                 WHERE downloaded_at IS NULL AND download_error IS NOT NULL
                   AND (download_error_kind IS NULL OR download_error_kind <> 'permanent')
                   AND post_id IN (SELECT id FROM posts WHERE creator_id = ?1)",
                rusqlite::params![cid],
            );
        }
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
        // Scope a whole-creator download to its newest N posts (published_at is
        // an ISO 8601 string, so lexical DESC == chronological). N is a validated
        // u32, safe to inline; the subquery reuses ?1 (the creator id).
        let post_limit_filter = match (&creator_id, max_posts) {
            (Some(_), Some(n)) if n > 0 => format!(
                "AND p.id IN (SELECT id FROM posts WHERE creator_id = ?1 ORDER BY published_at DESC LIMIT {n})"
            ),
            _ => String::new(),
        };
        let sql = format!(
            "SELECT a.id, p.creator_id, a.source_url, a.local_path, a.file_name
             FROM assets a JOIN posts p ON a.post_id = p.id
             WHERE {scope}
               AND a.downloaded_at IS NULL AND a.download_error IS NULL
               AND a.source_url IS NOT NULL
               {type_filter} {id_filter} {post_limit_filter}
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
            // A .part left over from a previous run belongs to a URL that may
            // since have expired and been re-minted, so it can't be resumed onto
            // safely — bin it and start clean.
            remove_partial(&dest);
            m.entries.insert(row.id.clone(), JobEntry {
                job: job.clone(), source_url: row.source_url, dest, attempts: 0, resume_from: 0,
            });
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

/// The app shell's seed: only the jobs that can affect the badge or the animated
/// icon (P1-6). Done/failed/cancelled rows are excluded by construction, so this
/// stays small no matter how long the session has been running — unlike the full
/// state, whose size is bounded only by `MAX_DONE_JOBS`.
#[tauri::command]
pub async fn get_download_summary(app: AppHandle) -> DownloadSummaryState {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let m = mgr_arc.lock().await;
    let active = m.order.iter()
        .filter_map(|id| m.entries.get(id))
        .filter(|e| matches!(e.job.status.as_str(), "downloading" | "queued" | "paused"))
        .map(|e| DownloadJobLite { asset_id: e.job.asset_id.clone(), status: e.job.status.clone() })
        .collect();
    DownloadSummaryState { active, paused: m.paused }
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
    // Workers that stopped mid-stream parked themselves as "paused". Put them
    // back in the queue so the supervisor picks them up; each keeps its
    // resume_from, so it continues rather than restarting.
    let ids: Vec<String> = m.order.clone();
    for id in ids {
        if let Some(e) = m.entries.get_mut(&id) {
            if e.job.status == "paused" {
                e.job.status = "queued".into();
                emit_job(&app, &e.job);
            }
        }
    }
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
        // Includes paused jobs, which own a half-written .part file. An in-flight
        // one is left to its worker, which deletes the partial on the way out.
        if let Some(e) = m.entries.get(&asset_id) { remove_partial(&e.dest); }
        remove_job(&app, &mut m, &asset_id);
    } else if let Some(e) = m.entries.get_mut(&asset_id) {
        // Mark so the worker discards the result instead of requeuing.
        e.job.status = "cancelled".into();
    }
}

/// Clear a previous failure and re-queue the asset. This targets one row the
/// user explicitly picked, so it clears permanent failures too — it's the escape
/// hatch for a link that went stale and has since been re-synced.
#[tauri::command]
pub async fn retry_download(app: AppHandle, asset_id: String) -> Result<(), String> {
    if let Ok(conn) = open_db(&app) {
        let _ = conn.execute(
            "UPDATE assets SET download_error = NULL, download_error_kind = NULL WHERE id = ?1",
            rusqlite::params![asset_id],
        );
    }
    start_downloads(app, None, Some(vec![asset_id]), None, None).await.map(|_| ())
}

/// Clear all recorded failures (optionally for one creator) and re-queue them.
/// Like `retry_download`, this is an explicit user action, so it also revives
/// rows marked permanently failed.
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
        // Batch the error-clear into chunked UPDATE ... WHERE id IN (...) (one
        // statement per 500 ids, safe under SQLite's 999-variable cap) wrapped in
        // a single transaction. The old per-id loop did N implicit transactions
        // (N WAL fsyncs); a 200-failure retry was 200 fsyncs. Now it's ≤1.
        if let Ok(tx) = conn.unchecked_transaction() {
            for chunk in ids.chunks(500) {
                let placeholders: String = chunk.iter().enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");
                let _ = tx.execute(
                    &format!(
                        "UPDATE assets SET download_error = NULL, download_error_kind = NULL \
                         WHERE id IN ({})",
                        placeholders,
                    ),
                    rusqlite::params_from_iter(chunk.iter()),
                );
            }
            let _ = tx.commit();
        }
    }
    start_downloads(app, None, Some(ids), None, None).await
}

/// Cancel every job that isn't finished (the header's "Cancel all"): queued and
/// failed rows are dropped; an in-flight download is flagged so its worker
/// discards the result instead of requeuing. Completed rows are left for history.
#[tauri::command]
pub async fn cancel_all_downloads(app: AppHandle) {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut m = mgr_arc.lock().await;
    // Flag the in-flight ones first; they can only be dropped by their own
    // worker, once it notices the flag and discards its result.
    for id in m.order.clone() {
        if let Some(e) = m.entries.get_mut(&id) {
            if e.job.status == "downloading" { e.job.status = "cancelled".into(); }
        }
    }
    // Everything else that isn't finished goes now. Collect first, then remove
    // in one pass — the old shape called `order.retain()` once per removal,
    // rescanning the whole queue each time while holding the manager lock.
    let doomed: Vec<String> = m.order.iter()
        .filter(|id| !matches!(
            m.entries.get(*id).map(|e| e.job.status.as_str()),
            Some("done") | Some("cancelled"),
        ))
        .cloned()
        .collect();
    // Discard half-written files rather than leaving them in the images folder.
    for id in &doomed {
        if let Some(e) = m.entries.get(id) { remove_partial(&e.dest); }
    }
    remove_jobs(&app, &mut m, &doomed);
}

/// Drop the finished-job rows from the in-memory list (files are untouched).
#[tauri::command]
pub async fn clear_completed_downloads(app: AppHandle) {
    let mgr_arc = app.state::<DownloadManagerState>().0.clone();
    let mut m = mgr_arc.lock().await;
    let done: Vec<String> = m.order.iter()
        .filter(|id| m.entries.get(*id).map(|e| e.job.status == "done").unwrap_or(false))
        .cloned().collect();
    remove_jobs(&app, &mut m, &done);
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
                        // Don't reset bytes_done: a resumed job already has
                        // e.resume_from bytes on disk, and zeroing here would
                        // make the bar jump back to empty before the first
                        // progress event corrected it.
                        e.job.bytes_done = e.resume_from;
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

/// How a single download attempt ended.
///
/// The distinction that matters is `LocalError` vs `Gone`: both stop the retry
/// loop for this run, but only `Gone` means the *URL* is dead, and only that
/// gets persisted as a permanent failure. A disk-full or rename error says
/// nothing about the link, so it stays retryable on the next explicit download.
enum DlOutcome {
    Ok(u64),
    /// Worth another attempt right away (network blip, 5xx, stream cut short).
    Transient(String),
    /// Something on our side failed (temp file, write, rename). Don't spin on it
    /// now, but the source URL is presumably still good.
    LocalError(String),
    /// The server says this URL will never serve again — 401/403/404/410, i.e.
    /// an expired signed CDN link or a deleted file.
    Gone(String),
    /// The user paused the queue mid-stream. The `.part` file is kept with this
    /// many bytes in it so resuming continues rather than restarting.
    Paused(u64),
}

/// Best-effort Patreon session cookies from the app's webview cookie store (shared
/// with the authenticated login/scraper webviews). Auth-gated attachment/video
/// URLs 403 without the session; signed image CDN links don't need it.
pub(crate) fn patreon_cookie_header(app: &AppHandle) -> Option<String> {
    use tauri::Manager;
    let url = tauri::Url::parse("https://www.patreon.com/").ok()?;
    let wv = app.webview_windows().into_values().next()?;
    let cookies = wv.cookies_for_url(url).ok()?;
    let header = cookies.iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    (!header.is_empty()).then_some(header)
}

/// How long a cookie-store read is trusted (P2-2).
const COOKIE_TTL: Duration = Duration::from_secs(60);

/// `patreon_cookie_header` memoised on the manager, so one queue run costs one
/// webview round trip instead of one per file.
///
/// Staleness: a re-login inside the TTL can serve the previous session's cookies.
/// The affected request 403s, which the downloader already treats as Transient
/// and retries — by then the entry has usually expired, so the failure is a short
/// delay rather than a wrong result.
///
/// The read happens *outside* the lock: `patreon_cookie_header` blocks on the
/// webview thread, and holding the manager mutex across it would stall the
/// supervisor and every worker. Two concurrent misses may both read and the
/// second write wins — same harmless race as `get_or_build_client`.
async fn cached_patreon_cookie(app: &AppHandle, mgr_arc: &Arc<Mutex<DownloadManager>>) -> Option<String> {
    {
        let m = mgr_arc.lock().await;
        if let Some((ref cached, at)) = m.cached_cookie {
            if at.elapsed() < COOKIE_TTL {
                return cached.clone();
            }
        }
    }
    let fresh = patreon_cookie_header(app);
    {
        let mut m = mgr_arc.lock().await;
        m.cached_cookie = Some((fresh.clone(), Instant::now()));
    }
    fresh
}

fn is_patreon_url(u: &str) -> bool {
    tauri::Url::parse(u).ok()
        .and_then(|p| p.host_str().map(|h| {
            h == "patreon.com" || h.ends_with(".patreon.com")
                || h == "patreonusercontent.com" || h.ends_with(".patreonusercontent.com")
        }))
        .unwrap_or(false)
}

/// Get a cached reqwest::Client, rebuilding only when proxy settings or
/// timeout change. Avoids the per-download cost of native-tls stack
/// initialization + `scutil` system-proxy resolution (a forked subprocess on
/// macOS). Two concurrent cache misses can both build — harmless, the second
/// just overwrites the cache.
async fn get_or_build_client(app: &AppHandle, mgr_arc: &Arc<Mutex<DownloadManager>>) -> reqwest::Client {
    // Read current proxy + timeout settings (cheap: just a RwLock read, no IO).
    let (proxy_mode, proxy_url, timeout_secs) = {
        let state = app.state::<super::settings::AppSettingsState>();
        let s = state.0.read().unwrap_or_else(|e| e.into_inner());
        (s.proxy_mode.clone(), s.proxy_url.clone(), s.download_timeout_secs)
    };
    // Fast path: cache hit.
    {
        let m = mgr_arc.lock().await;
        if let Some(ref c) = m.cached_client {
            if c.proxy_mode == proxy_mode && c.proxy_url == proxy_url && c.timeout_secs == timeout_secs {
                return c.client.clone();
            }
        }
    }
    // Cache miss: build (expensive — scutil + TLS init), then cache.
    let new_client = build_http_client(app);
    {
        let mut m = mgr_arc.lock().await;
        m.cached_client = Some(CachedClient {
            client: new_client.clone(),
            proxy_mode,
            proxy_url,
            timeout_secs,
        });
    }
    new_client
}

async fn run_download(app: AppHandle, mgr_arc: Arc<Mutex<DownloadManager>>, asset_id: String) {
    let (source_url, dest, resume_from) = {
        let m = mgr_arc.lock().await;
        match m.entries.get(&asset_id) {
            Some(e) => (e.source_url.clone(), e.dest.clone(), e.resume_from),
            None => { return; }
        }
    };

    let client = get_or_build_client(&app, &mgr_arc).await;
    // Attach the session cookie only for patreon.com hosts (auth-gated attachments
    // /videos). reqwest drops it on the cross-host redirect to the signed CDN.
    let cookie = if is_patreon_url(&source_url) { cached_patreon_cookie(&app, &mgr_arc).await } else { None };
    let outcome = download_streaming(&app, &mgr_arc, &asset_id, &client, &source_url, &dest, cookie.as_deref(), resume_from).await;

    // Per-request pacing to avoid CDN rate-limiting (kept per worker).
    let (_, retries, delay_enabled, delay_ms, jitter_enabled, jitter_ms) = read_download_settings(&app);
    if delay_enabled {
        let jitter = if jitter_enabled { fastrand::u32(0..jitter_ms.max(1)) } else { 0 };
        tokio::time::sleep(Duration::from_millis((delay_ms + jitter) as u64)).await;
    }

    // Persist a completed file BEFORE looking at queue state. The bytes are
    // already on disk under their final name at this point, so whether the user
    // happened to cancel during the last chunk is irrelevant to the database:
    // skipping this write would leave a file that exists on disk but reads as
    // never-downloaded, making it invisible in the media wall and favourites.
    if let DlOutcome::Ok(size) = &outcome {
        if let Ok(conn) = open_db(&app) {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = conn.execute(
                "UPDATE assets SET downloaded_at = ?1, byte_size = ?2,
                                   download_error = NULL, download_error_kind = NULL
                 WHERE id = ?3",
                rusqlite::params![now, *size as i64, asset_id],
            );
            // 主动生成缩略图：文件已落盘且 DB 标记 downloaded，现在生成缩略图。
            // 失败非致命——懒加载 ensure_thumbnail 会在下次 MediaView 加载时重试。
            // 跑在 blocking 线程上，因为 image::open 是同步的且可能耗时 10-50ms；
            // 内联执行会拖住下载 worker。
            let file_name = dest.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if super::thumbnails::is_image_filename(&file_name) {
                let app_t = app.clone();
                let dest_clone = dest.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let images_root = match super::file_ops::images_dir(&app_t) {
                        Ok(p) => p,
                        Err(e) => { eprintln!("WARN: 缩略图生成 images_dir: {}", e); return; }
                    };
                    // 重建 DB 存的 local_path 风格字符串。
                    // dest 形如 images_dir/{creator}/high_res/{file}；需要
                    // "images/{creator}/high_res/{file}" 形式给 thumb_path。
                    let rel = match dest_clone.strip_prefix(&images_root) {
                        Ok(r) => r.to_string_lossy().to_string(),
                        Err(_) => return,
                    };
                    let local_path = format!("images/{}", rel);
                    if let Some(thumb) = super::thumbnails::thumb_path(&images_root, &local_path) {
                        if !thumb.exists() {
                            if let Err(e) = super::thumbnails::generate_thumb(&dest_clone, &thumb) {
                                eprintln!("WARN: 主动缩略图生成 {}: {}", local_path, e);
                            }
                        }
                    }
                });
            }
        }
    }

    let mut m = mgr_arc.lock().await;
    m.active = m.active.saturating_sub(1);
    // If the user cancelled this job mid-flight, drop it and its partial bytes.
    if m.entries.get(&asset_id).map(|e| e.job.status == "cancelled").unwrap_or(true) {
        remove_partial(&dest);
        remove_job(&app, &mut m, &asset_id);
        return;
    }
    match outcome {
        DlOutcome::Ok(size) => {
            // Already written to the DB above; just reflect it in the queue row.
            if let Some(e) = m.entries.get_mut(&asset_id) {
                e.resume_from = 0;
                e.job.status = "done".into();
                e.job.bytes_done = size;
                e.job.bytes_total = Some(size);
                e.job.error = None;
                emit_job(&app, &e.job);
            }
            // Bound the resident history. The frontend's Completed list only ever
            // shows this window, and an unbounded done set grew every snapshot
            // (and every launch seed) with the size of the session's batches.
            // Evicted ids go out as `download-job-removed`, so an open Downloads
            // page drops the rows instead of keeping ghosts.
            let excess = excess_done_jobs(&m.order, &m.entries, MAX_DONE_JOBS);
            remove_jobs(&app, &mut m, &excess);
        }
        // Paused mid-stream. Hold the job and the bytes it already has so
        // resuming picks up where it stopped.
        DlOutcome::Paused(bytes) => {
            if let Some(e) = m.entries.get_mut(&asset_id) {
                e.resume_from = bytes;
                e.job.status = "paused".into();
                e.job.bytes_done = bytes;
                e.job.error = None;
                emit_job(&app, &e.job);
            }
        }
        DlOutcome::Transient(msg) => {
            let mut requeued = false;
            if let Some(e) = m.entries.get_mut(&asset_id) {
                if e.attempts < retries {
                    e.attempts += 1;
                    // The bytes already written are valid, so the retry resumes
                    // rather than re-fetching from zero.
                    e.resume_from = std::fs::metadata(part_path(&dest)).map(|md| md.len()).unwrap_or(0);
                    e.job.status = "queued".into();
                    e.job.error = None;
                    emit_job(&app, &e.job);
                    requeued = true;
                }
            }
            if !requeued {
                remove_partial(&dest);
                fail_job(&app, &mut m, &asset_id, msg, "transient");
            }
        }
        // Our side broke, not the link — record it but keep it retryable. The
        // partial file goes, since a write/flush failure means we can't vouch
        // for what actually landed.
        DlOutcome::LocalError(msg) => {
            remove_partial(&dest);
            fail_job(&app, &mut m, &asset_id, msg, "transient");
        }
        // The URL itself is dead; don't auto-retry it ever again. Its partial
        // bytes are useless too — a re-synced URL is a different signed link and
        // resuming onto it could splice two different responses together.
        DlOutcome::Gone(msg) => {
            remove_partial(&dest);
            fail_job(&app, &mut m, &asset_id, msg, "permanent");
        }
    }
}

/// Record a terminal failure. `kind` is "permanent" when retrying can't help
/// (expired/forbidden/deleted URL) and "transient" otherwise — start_downloads
/// uses it to decide which failures are worth re-queueing.
fn fail_job(app: &AppHandle, m: &mut DownloadManager, asset_id: &str, msg: String, kind: &str) {
    if let Ok(conn) = open_db(app) {
        let _ = conn.execute(
            "UPDATE assets SET download_error = ?1, download_error_kind = ?2 WHERE id = ?3",
            rusqlite::params![msg, kind, asset_id],
        );
    }
    if let Some(e) = m.entries.get_mut(asset_id) {
        e.job.status = "failed".into();
        e.job.error = Some(msg);
        emit_job(app, &e.job);
    }
}

/// Streams the response body to a `.part` file (bounded memory), emitting
/// throttled byte progress, then atomically renames into place.
///
/// `resume_from` > 0 asks the server to continue an interrupted transfer with a
/// Range request. The caller only sets it when the partial bytes are known to
/// belong to this same URL within this run.
async fn download_streaming(
    app: &AppHandle,
    mgr_arc: &Arc<Mutex<DownloadManager>>,
    asset_id: &str,
    client: &reqwest::Client,
    source_url: &str,
    dest: &std::path::Path,
    cookie: Option<&str>,
    resume_from: u64,
) -> DlOutcome {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Already on disk (e.g. pre-migration): count it as done.
    if dest.exists() {
        let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
        return DlOutcome::Ok(size);
    }

    let tmp = part_path(dest);
    // Never trust `resume_from` past what's actually on disk: the file may have
    // been truncated or removed since it was recorded.
    let on_disk = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
    let mut offset = resume_from.min(on_disk);

    let mut req = client.get(source_url);
    if let Some(ck) = cookie {
        req = req.header(reqwest::header::COOKIE, ck);
    }
    if offset > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={}-", offset));
    }
    let mut resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return DlOutcome::Transient(format!("request failed: {}", e)),
    };
    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let msg = format!("HTTP {}", code);
        // A rejected Range (416) just means our offset is stale — the next
        // attempt starts clean rather than treating it as a dead link.
        if code == 416 {
            let _ = std::fs::remove_file(&tmp);
            return DlOutcome::Transient("stale resume offset".into());
        }
        // Expired/forbidden/gone links won't recover on retry.
        return if matches!(code, 401 | 403 | 404 | 410) { DlOutcome::Gone(msg) } else { DlOutcome::Transient(msg) };
    }

    // 206 means the server honoured the Range and is sending the remainder.
    // Anything else (a plain 200) means it ignored it and is resending the whole
    // body, so the existing bytes have to go or the file would end up with a
    // duplicated prefix.
    let resuming = offset > 0 && status.as_u16() == 206;
    if offset > 0 && !resuming {
        offset = 0;
    }

    // With 206, Content-Length covers only what's still to come.
    let total = resp.content_length().map(|len| len + offset);
    if let Some(e) = mgr_arc.lock().await.entries.get_mut(asset_id) {
        e.job.bytes_total = total;
    }

    let file_result = if resuming {
        std::fs::OpenOptions::new().append(true).open(&tmp)
    } else {
        std::fs::File::create(&tmp)
    };
    let mut file = match file_result {
        Ok(f) => f,
        Err(e) => return DlOutcome::LocalError(format!("create temp: {}", e)),
    };
    let mut downloaded: u64 = offset;
    let mut last_emit = Instant::now();

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk) {
                    let _ = std::fs::remove_file(&tmp);
                    return DlOutcome::LocalError(format!("write: {}", e));
                }
                downloaded += chunk.len() as u64;
                if last_emit.elapsed() >= Duration::from_millis(150) {
                    last_emit = Instant::now();
                    let mut m = mgr_arc.lock().await;
                    // Cancelled mid-stream → stop and bin the partial bytes.
                    if m.entries.get(asset_id).map(|e| e.job.status == "cancelled").unwrap_or(true) {
                        drop(file);
                        let _ = std::fs::remove_file(&tmp);
                        return DlOutcome::LocalError("cancelled".into());
                    }
                    // Paused → stop but KEEP the partial bytes, so resuming
                    // continues from here instead of re-fetching from zero.
                    // Without this check the flag only stopped the supervisor
                    // from starting new jobs, and whatever was already in flight
                    // ran to completion.
                    if m.paused {
                        let _ = file.flush();
                        drop(file);
                        if let Some(e) = m.entries.get_mut(asset_id) {
                            e.job.bytes_done = downloaded;
                        }
                        return DlOutcome::Paused(downloaded);
                    }
                    if let Some(e) = m.entries.get_mut(asset_id) {
                        e.job.bytes_done = downloaded;
                        emit_job(app, &e.job);
                    }
                }
            }
            Ok(None) => break,
            // Keep the partial bytes: everything written so far is intact, so a
            // retry can resume rather than start over.
            Err(e) => return DlOutcome::Transient(format!("stream: {}", e)),
        }
    }

    if let Err(e) = file.flush() {
        let _ = std::fs::remove_file(&tmp);
        return DlOutcome::LocalError(format!("flush: {}", e));
    }
    drop(file);
    if let Err(e) = std::fs::rename(&tmp, dest) {
        let _ = std::fs::remove_file(&tmp);
        return DlOutcome::LocalError(format!("rename: {}", e));
    }
    DlOutcome::Ok(downloaded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(status: &str) -> JobEntry {
        JobEntry {
            job: DownloadJob {
                asset_id: String::new(),
                creator_id: String::new(),
                file_name: String::new(),
                status: status.into(),
                bytes_done: 0,
                bytes_total: None,
                error: None,
            },
            source_url: String::new(),
            dest: std::path::PathBuf::new(),
            attempts: 0,
            resume_from: 0,
        }
    }

    /// Builds an interleaved queue: only the `done` rows are eviction candidates,
    /// and they must be dropped oldest-first.
    fn mixed_queue() -> (Vec<String>, HashMap<String, JobEntry>) {
        let mut order = Vec::new();
        let mut entries = HashMap::new();
        for (i, status) in ["done", "failed", "done", "queued", "done", "cancelled", "done", "done"]
            .iter()
            .enumerate()
        {
            let id = format!("asset-{}", i);
            entries.insert(id.clone(), entry(status));
            order.push(id);
        }
        (order, entries)
    }

    #[test]
    fn excess_done_jobs_evicts_oldest_past_the_cap_only() {
        let (order, entries) = mixed_queue();
        // Five done rows; keeping two means the three oldest go.
        assert_eq!(
            excess_done_jobs(&order, &entries, 2),
            vec!["asset-0".to_string(), "asset-2".to_string(), "asset-4".to_string()],
        );
        // Non-done rows are never evicted, even when they sit before a done row
        // in `order` (a failed job is still actionable).
        let evicted = excess_done_jobs(&order, &entries, 2);
        assert!(!evicted.contains(&"asset-1".to_string()), "failed 作业不可淘汰");
        assert!(!evicted.contains(&"asset-3".to_string()), "queued 作业不可淘汰");
        assert!(!evicted.contains(&"asset-5".to_string()), "cancelled 作业由 worker 自行清掉");
    }

    #[test]
    fn excess_done_jobs_is_empty_under_the_cap() {
        let (order, entries) = mixed_queue();
        assert!(excess_done_jobs(&order, &entries, 5).is_empty(), "恰好等于上限时不淘汰");
        assert!(excess_done_jobs(&order, &entries, MAX_DONE_JOBS).is_empty());
        // A queue with no done rows at all: nothing to do.
        let (order, entries) = (vec!["a".to_string()], HashMap::from([("a".to_string(), entry("downloading"))]));
        assert!(excess_done_jobs(&order, &entries, 0).is_empty());
    }
}
