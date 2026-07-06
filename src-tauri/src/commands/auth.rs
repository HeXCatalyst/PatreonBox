use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn open_auth_webview(app: AppHandle) -> Result<(), String> {
    use tauri::{WebviewWindowBuilder, WebviewUrl};

    // Check if window already exists
    if let Some(window) = app.get_webview_window("auth-window") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let init_script = r#"
        setInterval(() => {
            const currentUrl = window.location.href;
            if (currentUrl.includes('patreon.com/home') || currentUrl.includes('patreon.com/user/')) {
                if (window.__patLoginHandled) return;
                window.__patLoginHandled = true;
                console.log("Login detected. Fetching user info...");
                fetch('/api/current_user', { credentials: 'include' })
                    .then(r => r.json())
                    .then(json => {
                        const attr = json && json.data && json.data.attributes;
                        if (attr) {
                            return window.__TAURI_INTERNALS__.invoke('report_account_info', {
                                user: {
                                    full_name: attr.full_name || '',
                                    email: attr.email || '',
                                    image_url: attr.image_url || attr.thumb_url || '',
                                    is_creator: !!(attr.is_creator),
                                }
                            });
                        }
                    })
                    .catch(e => { console.warn('Failed to fetch/store account info:', e); })
                    .finally(() => {
                        window.__TAURI_INTERNALS__.invoke('trigger_login_success', {});
                    });
            }
        }, 1000);
    "#;

    // Open a native window to log into Patreon
    let builder = WebviewWindowBuilder::new(
        &app,
        "auth-window",
        WebviewUrl::External("https://www.patreon.com/login".parse().unwrap())
    );

    builder
        .title("Login to Patreon")
        .inner_size(800.0, 600.0)
        .initialization_script(init_script)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn trigger_login_success(app: AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    eprintln!("DEBUG: trigger_login_success called!");
    // Close the auth window if it's still open
    if let Some(window) = app.get_webview_window("auth-window") {
        eprintln!("DEBUG: Closing auth window");
        let _ = window.close();
    }

    // Emit event to frontend
    app.emit("patreon-logged-in", ()).map_err(|e| e.to_string())?;
    Ok(())
}
