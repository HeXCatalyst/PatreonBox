use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use super::util::open_db;

fn default_true() -> bool { true }
fn default_delay_ms() -> u32 { 300 }
fn default_jitter_ms() -> u32 { 150 }
fn default_sidebar_width() -> u32 { 256 }
fn default_post_list_width() -> u32 { 320 }
fn default_asset_types() -> DownloadAssetTypes { DownloadAssetTypes::default() }
fn default_language() -> String { "en".to_string() }
fn default_debug_output_mode() -> String { "none".to_string() }
fn default_migration_verify_mode() -> String { "size".to_string() }
fn default_download_concurrency() -> u32 { 3 }
fn default_download_retries() -> u32 { 2 }
fn default_delete_mode() -> String { "trash".to_string() }
fn default_layout_mode() -> String { "classic".to_string() }
fn default_color_theme() -> String { "default".to_string() }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DownloadAssetTypes {
    #[serde(default = "default_true")]
    pub images: bool,
    #[serde(default = "default_true")]
    pub audio: bool,
    #[serde(default = "default_true")]
    pub attachments: bool,
}

impl Default for DownloadAssetTypes {
    fn default() -> Self {
        DownloadAssetTypes { images: true, audio: true, attachments: true }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSettings {
    pub default_max_posts: u32,
    pub default_sync_mode: String,   // "normal" | "full"
    pub download_timeout_secs: u32,
    pub proxy_mode: String,          // "auto" | "manual" | "off"
    pub proxy_url: Option<String>,
    pub theme: String,               // "dark" | "light" | "system"
    #[serde(default = "default_language")]
    pub language: String,            // "zh" | "en"
    #[serde(default = "default_true")]
    pub image_download_delay_enabled: bool,
    #[serde(default = "default_delay_ms")]
    pub image_download_delay_ms: u32,
    #[serde(default)]
    pub image_download_jitter_enabled: bool,
    #[serde(default = "default_jitter_ms")]
    pub image_download_jitter_ms: u32,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_post_list_width")]
    pub post_list_width: u32,
    #[serde(default = "default_asset_types", rename = "downloadAssetTypes")]
    pub download_asset_types: DownloadAssetTypes,
    #[serde(default)]
    pub developer_mode_enabled: bool,
    #[serde(default)]
    pub perf_hud_enabled: bool,
    #[serde(default = "default_debug_output_mode")]
    pub debug_output_mode: String,   // "terminal" | "inherit" | "none"
    #[serde(default)]
    pub custom_images_dir: Option<String>,
    #[serde(default = "default_migration_verify_mode")]
    pub migration_verify_mode: String,  // "size" | "hash"
    #[serde(default)]
    pub demo_mode: bool,
    #[serde(default = "default_download_concurrency")]
    pub download_concurrency: u32,      // parallel downloads (capped 1..=5 in the UI)
    #[serde(default = "default_download_retries")]
    pub download_retries: u32,          // auto-retries for transient failures
    #[serde(default = "default_delete_mode")]
    pub delete_mode: String,            // "trash" (move to Trash) | "direct" (permanent)
    #[serde(default)]
    pub last_seen_sync_runs_at: String, // RFC3339 stamp; failed runs after it show the sidebar error dot
    #[serde(default = "default_layout_mode")]
    pub layout_mode: String,            // "classic" (3-pane) | "workbench" (rail + canvas + dock)
    #[serde(default = "default_color_theme")]
    pub color_theme: String,            // "default" | "reading-room" | "dhole" | "nightwolf" | "azure-fox"
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            default_max_posts: 9999,
            default_sync_mode: "normal".to_string(),
            download_timeout_secs: 60,
            proxy_mode: "auto".to_string(),
            proxy_url: None,
            theme: "dark".to_string(),
            language: "en".to_string(),
            image_download_delay_enabled: true,
            image_download_delay_ms: 300,
            image_download_jitter_enabled: false,
            image_download_jitter_ms: 150,
            sidebar_width: 256,
            post_list_width: 320,
            download_asset_types: DownloadAssetTypes::default(),
            developer_mode_enabled: false,
            perf_hud_enabled: false,
            debug_output_mode: "none".to_string(),
            custom_images_dir: None,
            migration_verify_mode: "size".to_string(),
            demo_mode: false,
            download_concurrency: 3,
            download_retries: 2,
            delete_mode: "trash".to_string(),
            last_seen_sync_runs_at: String::new(),
            layout_mode: "classic".to_string(),
            color_theme: "default".to_string(),
        }
    }
}

/// Managed state holding the current settings (kept in sync with settings.json).
pub struct AppSettingsState(pub std::sync::RwLock<AppSettings>);

#[derive(Serialize)]
pub struct StorageUsage {
    pub db_bytes: u64,
    pub images_bytes: u64,
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json"))
}

fn dir_size(path: &std::path::Path) -> u64 {
    if !path.exists() { return 0; }
    std::fs::read_dir(path).ok()
        .map(|entries| {
            entries.filter_map(|e| e.ok())
                .map(|e| {
                    let p = e.path();
                    if p.is_dir() { dir_size(&p) }
                    else { std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0) }
                })
                .sum()
        })
        .unwrap_or(0)
}

#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<AppSettings, String> {
    let state = app.state::<AppSettingsState>();
    let settings = state.0.read().map_err(|e| e.to_string())?.clone();
    Ok(settings)
}

/// Whether the scraper webview windows should be created hidden (run in the
/// background). Hidden by default — scraping runs silently for normal users.
/// Shown only when developer mode is on, so a developer can watch what the
/// scraper is doing. (Verified: a hidden WKWebView still runs its JS and network
/// fetches, so scraping works identically while hidden.) A stuck scrape — e.g.
/// Patreon demanding re-login — is surfaced by the caller's auto-reveal fallback.
pub fn scraper_windows_hidden(app: &AppHandle) -> bool {
    let state = app.state::<AppSettingsState>();
    let hidden = match state.0.read() {
        Ok(s) => !s.developer_mode_enabled,
        Err(_) => false, // on lock poisoning, fail open (visible) rather than hide silently
    };
    hidden
}

#[tauri::command]
pub fn write_settings(app: AppHandle, mut settings: AppSettings) -> Result<(), String> {
    // Reject outright while a migration holds the lock, rather than relying on
    // timing to avoid a stale-cache write landing between migrate_images_dir's
    // own settings write and this command's read of the current value below.
    super::image_migration::check_not_migrating(&app)?;
    let state = app.state::<AppSettingsState>();
    // custom_images_dir is exclusively owned by migrate_images_dir, which writes
    // it directly (out-of-band from this command) the instant a migration
    // completes. A generic settings write from a stale frontend cache — e.g. the
    // user navigated away from Settings mid-migration and changed something else
    // before the migration UI's refreshSettings() call landed — must never be
    // allowed to revert it to a pre-migration value while the files have already
    // moved. Always keep the backend's current value for this one field.
    {
        let current = state.0.read().map_err(|e| e.to_string())?;
        settings.custom_images_dir = current.custom_images_dir.clone();
    }
    // Update managed state so build_http_client sees the new proxy immediately
    *state.0.write().map_err(|e| e.to_string())? = settings.clone();
    // Persist to disk
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_storage_usage(app: AppHandle) -> Result<StorageUsage, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_bytes = std::fs::metadata(base.join("patreonbox.db"))
        .map(|m| m.len()).unwrap_or(0);
    let images_bytes = dir_size(&super::file_ops::images_dir(&app)?);
    Ok(StorageUsage { db_bytes, images_bytes })
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn clear_all_data(app: AppHandle) -> Result<(), String> {
    super::image_migration::check_not_migrating(&app)?;
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM posts", [])
        .map_err(|e| format!("DB error: {}", e))?;
    conn.execute("DELETE FROM assets", []).map_err(|e| format!("DB error: {}", e))?;
    conn.execute("DELETE FROM sync_runs", []).map_err(|e| format!("DB error: {}", e))?;
    conn.execute("DELETE FROM sync_checkpoints", []).map_err(|e| format!("DB error: {}", e))?;
    let images_dir_path = super::file_ops::images_dir(&app)?;
    if images_dir_path.exists() {
        if let Err(e) = std::fs::remove_dir_all(&images_dir_path) {
            eprintln!("WARN: Could not remove images dir: {}", e);
        }
    }
    Ok(())
}
