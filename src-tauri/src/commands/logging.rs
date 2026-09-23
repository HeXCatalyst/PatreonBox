use tauri::{AppHandle, Manager};
use std::fs;

/// Pure filesystem append (log dir + log file), so it runs on the blocking
/// threadpool instead of inline on the main thread (`async` on a non-async fn =
/// "sync_threadpool" in Tauri v2, no signature change).
#[tauri::command(async)]
pub fn log_sync_error(app: AppHandle, error_message: String) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    if !log_dir.exists() {
        fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }

    let log_file = log_dir.join("sync_errors.log");

    use std::fs::OpenOptions;
    use std::io::Write;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
        .map_err(|e| e.to_string())?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    writeln!(file, "[{}] {}", timestamp, error_message).map_err(|e| e.to_string())?;

    Ok(())
}
