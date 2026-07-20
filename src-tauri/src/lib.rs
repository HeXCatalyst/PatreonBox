use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};
mod commands;

// debug_output_mode: "terminal" (open a standalone Terminal.app tailing a log file),
// "none" (silence stderr entirely), or anything else (default: inherit — stderr flows
// wherever it already does, e.g. the terminal that launched `npm run tauri dev`).
#[cfg(unix)]
fn apply_debug_output_mode(mode: &str, app_data_dir: &std::path::Path) {
    use std::os::unix::io::AsRawFd;

    match mode {
        "terminal" => {
            let log_path = app_data_dir.join("debug.log");
            let file = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(&log_path);
            if let Ok(file) = file {
                unsafe { libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO); }
            }
            #[cfg(target_os = "macos")]
            {
                let script = format!("tell application \"Terminal\" to do script \"tail -f '{}'\"", log_path.display());
                let _ = std::process::Command::new("osascript").arg("-e").arg(script).spawn();
            }
        }
        "none" => {
            if let Ok(null) = std::fs::OpenOptions::new().write(true).open("/dev/null") {
                unsafe { libc::dup2(null.as_raw_fd(), libc::STDERR_FILENO); }
            }
        }
        _ => {}
    }
}

#[cfg(not(unix))]
fn apply_debug_output_mode(_mode: &str, _app_data_dir: &std::path::Path) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/00001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_downloaded_at_to_assets",
            sql: "ALTER TABLE assets ADD COLUMN downloaded_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_subscription_type_and_is_subscribed",
            sql: "ALTER TABLE creators ADD COLUMN subscription_type TEXT; \
                  ALTER TABLE creators ADD COLUMN is_subscribed INTEGER NOT NULL DEFAULT 1;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_sync_checkpoints",
            sql: "CREATE TABLE IF NOT EXISTS sync_checkpoints (
                    creator_id TEXT PRIMARY KEY,
                    cursor     TEXT NOT NULL,
                    posts_done INTEGER NOT NULL DEFAULT 0,
                    mode       TEXT NOT NULL,
                    created_at TEXT NOT NULL
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_creator_pinning",
            sql: "ALTER TABLE creators ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0; \
                  ALTER TABLE creators ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            // An asset is uniquely one file within one post. Asset ids used to be
            // hashed from the (token-carrying) CDN URL, then later from post_id+
            // file_name — so rows synced under the old scheme and re-synced under
            // the new one landed with different ids and no longer deduped, leaving
            // a duplicate placeholder per image. Collapse those duplicates (keeping
            // the downloaded/newest row per post+filename) and enforce the natural
            // key with a UNIQUE index, so dedup no longer depends on the id scheme.
            version: 6,
            description: "dedupe_assets_and_unique_post_file",
            sql: "DELETE FROM assets \
                  WHERE id IN ( \
                    SELECT id FROM ( \
                      SELECT id, ROW_NUMBER() OVER ( \
                        PARTITION BY post_id, file_name \
                        ORDER BY (downloaded_at IS NOT NULL) DESC, updated_at DESC, created_at DESC \
                      ) AS rn FROM assets \
                    ) WHERE rn > 1 \
                  ); \
                  CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_post_file ON assets(post_id, file_name);",
            kind: MigrationKind::Up,
        },
        Migration {
            // Records why a download failed, so the download manager can tell
            // "failed" apart from "not yet attempted": downloaded_at IS NULL AND
            // download_error IS NULL = queued; download_error IS NOT NULL = failed.
            version: 7,
            description: "add_download_error_to_assets",
            sql: "ALTER TABLE assets ADD COLUMN download_error TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            // Post comments, fetched on-demand when a post is opened and cached
            // for offline reading. parent_id links replies to their top-level
            // comment (NULL = top-level).
            version: 8,
            description: "add_comments",
            sql: "CREATE TABLE IF NOT EXISTS comments (
                    id TEXT PRIMARY KEY,
                    post_id TEXT NOT NULL,
                    parent_id TEXT,
                    author_name TEXT,
                    author_id TEXT,
                    body TEXT,
                    published_at TEXT,
                    reply_count INTEGER NOT NULL DEFAULT 0,
                    fetched_at TEXT
                  );
                  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);",
            kind: MigrationKind::Up,
        },
        Migration {
            // Per-image favourites. A timestamp rather than a flag so the
            // favourites view can sort by when it was favourited (NULL = not).
            version: 9,
            description: "add_favorited_at_to_assets",
            sql: "ALTER TABLE assets ADD COLUMN favorited_at TEXT;
                  CREATE INDEX IF NOT EXISTS idx_assets_favorited ON assets(favorited_at);",
            kind: MigrationKind::Up,
        },
        Migration {
            // 'transient' (network blip, 5xx — worth retrying) vs 'permanent'
            // (401/403/404/410 — an expired signed CDN link or a deleted file,
            // which will fail identically no matter how often we retry).
            // start_downloads clears only the transient ones, so a creator with
            // hundreds of expired links no longer re-queues them on every click.
            // Existing rows stay NULL and are treated as transient, preserving
            // today's retry-everything behaviour for already-recorded failures.
            version: 10,
            description: "add_download_error_kind_to_assets",
            sql: "ALTER TABLE assets ADD COLUMN download_error_kind TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            // Every per-creator query (post list, media wall, post counts,
            // retry-all) filters or groups by posts.creator_id; without this the
            // COUNT(*) in getCreators() alone scans the whole posts table on
            // every refresh, and it refreshes on each sync/delete/clear.
            version: 11,
            description: "add_posts_creator_index",
            sql: "CREATE INDEX IF NOT EXISTS idx_posts_creator ON posts(creator_id);
                  CREATE INDEX IF NOT EXISTS idx_assets_post ON assets(post_id);",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).unwrap_or_default();

            eprintln!("DEBUG: App data dir = {:?}", app_data_dir);

            // Load persisted settings (fall back to defaults if file missing/corrupt)
            let settings = {
                let path = app_data_dir.join("settings.json");
                std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(commands::settings::AppSettings::default)
            };

            // Ensure the active images directory exists: the default
            // app_data_dir/images, or the user's custom_images_dir if a
            // migration has already relocated it.
            let images_dir = settings.custom_images_dir.clone()
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| app_data_dir.join("images"));
            std::fs::create_dir_all(&images_dir).unwrap_or_default();

            // debug_output_mode only takes effect while developer mode is on; when
            // it's off, output behaves as the default ("inherit") regardless of the
            // stored mode — so the user's mode choice is preserved across toggles
            // without leaking a standalone-terminal/silenced state into normal use.
            let effective_debug_mode = if settings.developer_mode_enabled {
                settings.debug_output_mode.as_str()
            } else {
                "inherit"
            };
            apply_debug_output_mode(effective_debug_mode, &app_data_dir);
            app.manage(commands::AppSettingsState(std::sync::RwLock::new(settings)));

            // Load persisted account info (None if file missing/corrupt = logged out)
            let account_info = {
                let path = app_data_dir.join("account.json");
                std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
            };
            app.manage(commands::AccountInfoState(std::sync::RwLock::new(account_info)));

            Ok(())
        })
        .manage(commands::ScrapedSubscriptionsState(std::sync::Mutex::new(None)))
        .manage(commands::ScrapedPostsRawState(std::sync::Mutex::new(None)))
        .manage(commands::ScrapeProgressTick(std::sync::atomic::AtomicU64::new(0)))
        .manage(commands::comments::PostCommentsRawState(std::sync::Mutex::new(None)))
        .manage(commands::perf::SysState(std::sync::Mutex::new(sysinfo::System::new())))
        .manage(commands::ImageDownloadCancelFlag(
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))
        ))
        .manage(commands::ImageMigrationLock(
            std::sync::atomic::AtomicBool::new(false)
        ))
        .manage(commands::DownloadManagerState::new())
        .plugin(SqlBuilder::default().add_migrations("sqlite:patreonbox.db", migrations).build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_ops::resolve_app_data_dir,
            commands::file_ops::resolve_images_dir,
            commands::file_ops::ensure_demo_assets_on_disk,
            commands::file_ops::save_asset_to_downloads,
            commands::file_ops::open_asset_in_system,
            commands::file_ops::delete_downloaded_assets,
            commands::file_ops::clear_creator_data,
            commands::file_ops::delete_creator,
            commands::logging::log_sync_error,
            commands::auth::open_auth_webview,
            commands::auth::trigger_login_success,
            commands::scraping::scrape_creator_posts,
            commands::scraping::report_scraped_posts_progress,
            commands::scraping::report_scraped_post_page,
            commands::scraping::report_scraped_posts_raw,
            commands::scraping::get_sync_checkpoint,
            commands::scraping::clear_sync_checkpoint,
            commands::scraping::cancel_image_download,
            commands::scraping::close_post_sync_window,
            commands::subscriptions::scrape_subscriptions,
            commands::subscriptions::report_scraped_subscriptions,
            commands::subscriptions::save_scraped_to_db,
            commands::subscriptions::set_creator_pinned,
            commands::subscriptions::reorder_pinned_creators,
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::settings::get_storage_usage,
            commands::settings::get_app_version,
            commands::settings::clear_all_data,
            commands::image_migration::migrate_images_dir,
            commands::account::report_account_info,
            commands::account::get_account_info,
            commands::account::logout,
            commands::self_check::run_self_check,
            commands::download_manager::start_downloads,
            commands::download_manager::get_download_state,
            commands::download_manager::pause_downloads,
            commands::download_manager::resume_downloads,
            commands::download_manager::cancel_download,
            commands::download_manager::cancel_all_downloads,
            commands::download_manager::retry_download,
            commands::download_manager::retry_all_failed,
            commands::download_manager::clear_completed_downloads,
            commands::sync_history::get_sync_runs,
            commands::sync_history::clear_sync_runs,
            commands::comments::fetch_post_comments,
            commands::comments::report_post_comments,
            commands::perf::process_stats,
            commands::perf::disk_io_stats,
            commands::sync_history::get_unseen_failed_count,
            commands::sync_history::mark_sync_runs_seen,
            commands::search::search_posts,
            commands::search::rebuild_search_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
