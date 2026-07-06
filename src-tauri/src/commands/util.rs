use tauri::{AppHandle, Manager};

// ─── ProseMirror JSON → HTML ─────────────────────────────────────────────────

/// Convert a ProseMirror/TipTap JSON document node to an HTML string.
/// Handles the node types used by Patreon's editor (paragraph, text, heading,
/// lists, blockquote, code blocks, hard breaks, images).
pub fn prosemirror_to_html(node: &serde_json::Value) -> String {
    match node.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "doc" => render_pm_children(node),
        "paragraph" => {
            let inner = render_pm_children(node);
            if inner.is_empty() { "<p><br></p>".to_string() } else { format!("<p>{}</p>", inner) }
        }
        "text" => {
            let text = node.get("text").and_then(|t| t.as_str()).unwrap_or("");
            let escaped = html_escape(text);
            match node.get("marks").and_then(|m| m.as_array()) {
                Some(marks) => marks.iter().fold(escaped, |acc, m| apply_pm_mark(acc, m)),
                None => escaped,
            }
        }
        "hardBreak" => "<br>".to_string(),
        "horizontalRule" => "<hr>".to_string(),
        // Images are handled separately as assets; omit inline <img> to avoid broken src
        "image" => String::new(),
        "heading" => {
            let level = node.get("attrs")
                .and_then(|a| a.get("level"))
                .and_then(|l| l.as_u64())
                .unwrap_or(1)
                .min(6);
            format!("<h{}>{}</h{}>", level, render_pm_children(node), level)
        }
        "bulletList"  => format!("<ul>{}</ul>", render_pm_children(node)),
        "orderedList" => format!("<ol>{}</ol>", render_pm_children(node)),
        "listItem"    => format!("<li>{}</li>", render_pm_children(node)),
        "blockquote"  => format!("<blockquote>{}</blockquote>", render_pm_children(node)),
        "codeBlock" | "code_block" =>
            format!("<pre><code>{}</code></pre>", render_pm_children(node)),
        _ => render_pm_children(node), // unknown node — pass through children
    }
}

fn render_pm_children(node: &serde_json::Value) -> String {
    node.get("content")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().map(prosemirror_to_html).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}

fn apply_pm_mark(text: String, mark: &serde_json::Value) -> String {
    match mark.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "bold" | "strong"            => format!("<strong>{}</strong>", text),
        "italic" | "em"              => format!("<em>{}</em>", text),
        "underline"                  => format!("<u>{}</u>", text),
        "strike" | "strikethrough"   => format!("<s>{}</s>", text),
        "code"                       => format!("<code>{}</code>", text),
        "link" => {
            let href = mark.get("attrs")
                .and_then(|a| a.get("href"))
                .and_then(|h| h.as_str())
                .unwrap_or("#");
            format!("<a href=\"{}\" target=\"_blank\">{}</a>", href, text)
        }
        _ => text,
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&#39;")
}

/// Deterministic hash for generating IDs. Uses SHA-256 truncated to 64 bits
/// so results are stable across Rust versions (unlike DefaultHasher).
pub fn stable_hash(input: &str) -> u64 {
    use sha2::{Sha256, Digest};
    let hash = Sha256::digest(input.as_bytes());
    u64::from_le_bytes(hash[..8].try_into().expect("SHA-256 is always ≥ 8 bytes"))
}

/// Close a webview window by label if it exists (no-op if not found)
pub fn close_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }
}

/// Build an HTTP client that respects proxy settings from managed AppSettingsState.
/// proxy_mode "auto"   → detect the OS system proxy (macOS: scutil, Windows: registry,
///                       other: HTTP(S)_PROXY env vars)
/// proxy_mode "manual" → use proxy_url from settings
/// proxy_mode "off"    → no proxy
/// Resolve the effective HTTPS proxy for the current settings: returns the proxy
/// mode plus the concrete proxy URL it resolves to (if any). Shared by
/// `build_http_client` and the self-check panel so the resolution logic lives in
/// exactly one place.
pub(crate) fn resolve_proxy(app: &tauri::AppHandle) -> (String, Option<String>) {
    use tauri::Manager;
    let (proxy_mode, proxy_url) = {
        let state = app.state::<super::settings::AppSettingsState>();
        let s = state.0.read().unwrap_or_else(|e| e.into_inner());
        (s.proxy_mode.clone(), s.proxy_url.clone())
    };
    let resolved = match proxy_mode.as_str() {
        "manual" => proxy_url,
        "off"    => None,
        _        => detect_system_https_proxy(), // "auto" or unknown → OS system proxy
    };
    (proxy_mode, resolved)
}

pub fn build_http_client(app: &tauri::AppHandle) -> reqwest::Client {
    use tauri::Manager;
    let timeout_secs = {
        let state = app.state::<super::settings::AppSettingsState>();
        let s = state.0.read().unwrap_or_else(|e| e.into_inner());
        s.download_timeout_secs
    };

    let mut builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(timeout_secs as u64))
        .connect_timeout(std::time::Duration::from_secs(15));

    let (_, resolved_proxy) = resolve_proxy(app);

    if let Some(ref proxy_url) = resolved_proxy {
        eprintln!("DEBUG: Using proxy: {}", proxy_url);
        if let Ok(proxy) = reqwest::Proxy::https(proxy_url) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::http(proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

/// Detect the OS-configured system HTTPS proxy, returning it as an `http://host:port`
/// URL suitable for reqwest. Dispatches to a per-platform implementation; returns
/// `None` when no system proxy is configured (or it can't be read).
fn detect_system_https_proxy() -> Option<String> {
    #[cfg(target_os = "macos")]
    { detect_macos_https_proxy() }
    #[cfg(target_os = "windows")]
    { detect_windows_https_proxy() }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { detect_env_https_proxy() }
}

#[cfg(target_os = "macos")]
fn detect_macos_https_proxy() -> Option<String> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;

    // Check if HTTPS proxy is enabled
    if !text.lines().any(|l| l.trim().starts_with("HTTPSEnable") && l.contains("1")) {
        return None;
    }
    // Use rsplitn(2, ':') so IPv6 addresses like [::1]:8080 parse correctly
    let host = text.lines()
        .find(|l| l.trim().starts_with("HTTPSProxy"))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|s| s.trim())?;
    let port = text.lines()
        .find(|l| l.trim().starts_with("HTTPSPort"))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|s| s.trim())?;

    if host.is_empty() || port.is_empty() {
        return None;
    }
    Some(format!("http://{}:{}", host, port))
}

/// Read the per-user WinINET proxy from the registry via `reg query` — mirroring the
/// macOS path's shell-out to `scutil`, so no extra crate is needed.
#[cfg(target_os = "windows")]
fn detect_windows_https_proxy() -> Option<String> {
    const BASE: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    // ProxyEnable (REG_DWORD): 0x0 = off, 0x1 = on
    let enable = std::process::Command::new("reg")
        .args(["query", BASE, "/v", "ProxyEnable"])
        .output()
        .ok()?;
    let enable_text = String::from_utf8_lossy(&enable.stdout);
    let enabled = enable_text
        .lines()
        .find(|l| l.contains("ProxyEnable"))
        .map(|l| l.trim_end().ends_with("0x1"))
        .unwrap_or(false);
    if !enabled {
        return None;
    }

    // ProxyServer (REG_SZ): either "host:port" (all protocols) or a per-protocol list
    // like "http=host:port;https=host:port;ftp=...;socks=..."
    let server = std::process::Command::new("reg")
        .args(["query", BASE, "/v", "ProxyServer"])
        .output()
        .ok()?;
    let server_text = String::from_utf8_lossy(&server.stdout);
    let value = server_text
        .lines()
        .find(|l| l.contains("ProxyServer"))
        .and_then(|l| l.split("REG_SZ").nth(1))
        .map(|s| s.trim())?;
    if value.is_empty() {
        return None;
    }

    let hostport = if value.contains('=') {
        // Per-protocol list — prefer https=, fall back to http=
        value.split(';').find_map(|p| p.trim().strip_prefix("https="))
            .or_else(|| value.split(';').find_map(|p| p.trim().strip_prefix("http=")))?
    } else {
        // Single proxy used for all protocols
        value
    };

    let hostport = hostport.trim();
    if hostport.is_empty() {
        return None;
    }
    Some(format!("http://{}", hostport))
}

/// Fallback for Linux/other: read the conventional HTTP(S)_PROXY environment variables.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn detect_env_https_proxy() -> Option<String> {
    ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]
        .into_iter()
        .find_map(|k| std::env::var(k).ok())
        .filter(|s| !s.is_empty())
}

/// Open a rusqlite connection to the app's database
pub fn open_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let db_path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("patreonbox.db");
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    Ok(conn)
}
