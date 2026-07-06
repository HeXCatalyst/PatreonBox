use tauri::{AppHandle, Manager};
use serde::{Deserialize, Serialize};
use super::util::close_window;

/// Best-effort delay to give the Patreon logout page time to clear session cookies.
const LOGOUT_WINDOW_CLOSE_DELAY_SECS: u64 = 2;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PatreonUser {
    pub full_name: String,
    pub email: String,
    pub image_url: String,
    pub is_creator: bool,
}

pub struct AccountInfoState(pub std::sync::RwLock<Option<PatreonUser>>);

fn account_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("account.json"))
}

#[tauri::command]
pub fn report_account_info(app: AppHandle, user: PatreonUser) -> Result<(), String> {
    // Write to disk first — if this fails, state is unchanged and an error is returned
    let json = serde_json::to_string_pretty(&user).map_err(|e| e.to_string())?;
    std::fs::write(account_path(&app)?, json).map_err(|e| e.to_string())?;
    // Update in-memory state only after disk write succeeds
    let state = app.state::<AccountInfoState>();
    *state.0.write().map_err(|e| e.to_string())? = Some(user);
    Ok(())
}

#[tauri::command]
pub fn get_account_info(app: AppHandle) -> Result<Option<PatreonUser>, String> {
    let state = app.state::<AccountInfoState>();
    let user = state.0.read().map_err(|e| e.to_string())?.clone();
    Ok(user)
}

/// Clears account state, deletes account.json, and opens a short-lived webview to
/// https://www.patreon.com/logout to clear Patreon session cookies.
/// `async` is required because of the tokio::time::sleep call.
#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), String> {
    use tauri::{WebviewWindowBuilder, WebviewUrl};

    // Clear managed state
    {
        let state = app.state::<AccountInfoState>();
        *state.0.write().map_err(|e| e.to_string())? = None;
    }
    // Delete persisted file (ignore if already absent)
    let _ = std::fs::remove_file(account_path(&app)?);

    // Open a temporary webview to clear Patreon session cookies via their logout page
    let logout_url = "https://www.patreon.com/logout"
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;
    WebviewWindowBuilder::new(
        &app,
        "logout-window",
        WebviewUrl::External(logout_url),
    )
    .title("Logging out...")
    .inner_size(800.0, 600.0)
    .build()
    .map_err(|e| e.to_string())?;

    tokio::time::sleep(std::time::Duration::from_secs(LOGOUT_WINDOW_CLOSE_DELAY_SECS)).await;
    close_window(&app, "logout-window");

    Ok(())
}
