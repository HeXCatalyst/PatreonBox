use tauri::{AppHandle, Manager};

/// One row of the developer-mode self-check panel. `id` is a stable key the
/// frontend maps to a localized title; `detail` carries the technical value
/// (path / proxy / timing / error) shown verbatim.
#[derive(serde::Serialize)]
pub struct CheckResult {
    pub id: String,
    pub status: String, // "pass" | "warn" | "fail"
    pub detail: String,
}

fn result(id: &str, status: &str, detail: impl Into<String>) -> CheckResult {
    CheckResult { id: id.into(), status: status.into(), detail: detail.into() }
}

/// Write + read + delete a temp file in `dir` to confirm it's actually writable.
fn probe_writable(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let probe = dir.join(".patreonbox_selfcheck.tmp");
    std::fs::write(&probe, b"ok").map_err(|e| e.to_string())?;
    let content = std::fs::read(&probe).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&probe);
    if content != b"ok" {
        return Err("read-back mismatch".into());
    }
    Ok(())
}

fn check_data_dir(app: &AppHandle) -> CheckResult {
    match app.path().app_data_dir() {
        Ok(dir) => match probe_writable(&dir) {
            Ok(()) => result("data_dir", "pass", dir.to_string_lossy()),
            Err(e) => result("data_dir", "fail", format!("{} — {}", dir.to_string_lossy(), e)),
        },
        Err(e) => result("data_dir", "fail", e.to_string()),
    }
}

fn check_images_dir(app: &AppHandle) -> CheckResult {
    match super::file_ops::images_dir(app) {
        Ok(dir) => match probe_writable(&dir) {
            Ok(()) => result("images_dir", "pass", dir.to_string_lossy()),
            Err(e) => result("images_dir", "fail", format!("{} — {}", dir.to_string_lossy(), e)),
        },
        Err(e) => result("images_dir", "fail", e),
    }
}

fn check_downloads_dir(app: &AppHandle) -> CheckResult {
    match app.path().download_dir() {
        Ok(dir) => result("downloads_dir", "pass", dir.to_string_lossy()),
        Err(e) => result("downloads_dir", "fail", e.to_string()),
    }
}

fn check_database(app: &AppHandle) -> CheckResult {
    match super::util::open_db(app) {
        Ok(conn) => {
            // Exercise read+write against a connection-local TEMP table only — this
            // never touches any real table or data.
            let probe = (|| -> Result<(), String> {
                conn.execute_batch(
                    "CREATE TEMP TABLE _selfcheck (id INTEGER);\n\
                     INSERT INTO _selfcheck (id) VALUES (1);",
                ).map_err(|e| e.to_string())?;
                let n: i64 = conn
                    .query_row("SELECT COUNT(*) FROM _selfcheck", [], |r| r.get(0))
                    .map_err(|e| e.to_string())?;
                conn.execute_batch("DROP TABLE _selfcheck").map_err(|e| e.to_string())?;
                if n != 1 {
                    return Err(format!("unexpected row count: {}", n));
                }
                Ok(())
            })();
            match probe {
                Ok(()) => result("database", "pass", "read/write OK (temp table)"),
                Err(e) => result("database", "fail", e),
            }
        }
        Err(e) => result("database", "fail", e),
    }
}

fn check_proxy(app: &AppHandle) -> CheckResult {
    let (mode, resolved) = super::util::resolve_proxy(app);
    match (mode.as_str(), resolved) {
        ("off", _) => result("proxy", "pass", "disabled (mode: off)"),
        (_, Some(url)) => result("proxy", "pass", format!("{} (mode: {})", url, mode)),
        (_, None) => result("proxy", "warn", format!("no proxy resolved (mode: {})", mode)),
    }
}

fn check_system_info(app: &AppHandle) -> CheckResult {
    let version = app.package_info().version.to_string();
    let detail = format!(
        "PatreonBOX v{} · {} · {}",
        version,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    result("system_info", "pass", detail)
}

/// Read-only reachability probe: GET patreon.com through the current proxy settings
/// with a short timeout. Any HTTP response counts as a pass (it proves DNS + TLS +
/// proxy all work); only a transport/timeout/TLS error is a fail. No login, no scrape.
async fn check_patreon_connectivity(app: &AppHandle) -> CheckResult {
    let (_, resolved_proxy) = super::util::resolve_proxy(app);
    let mut builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; PatreonBOX self-check)")
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(8));
    if let Some(ref url) = resolved_proxy {
        if let Ok(p) = reqwest::Proxy::https(url) {
            builder = builder.proxy(p);
        }
        if let Ok(p) = reqwest::Proxy::http(url) {
            builder = builder.proxy(p);
        }
    }
    let client = match builder.build() {
        Ok(c) => c,
        Err(e) => return result("patreon_connectivity", "fail", format!("client build failed: {}", e)),
    };

    let start = std::time::Instant::now();
    match client.get("https://www.patreon.com").send().await {
        Ok(resp) => {
            let ms = start.elapsed().as_millis();
            result("patreon_connectivity", "pass", format!("HTTP {}, {} ms", resp.status().as_u16(), ms))
        }
        Err(e) => result("patreon_connectivity", "fail", e.to_string()),
    }
}

/// Run all self-check probes and return their results. Always returns Ok with the
/// full set — an individual check's failure is represented as a `fail`/`warn`
/// result rather than aborting the whole run.
#[tauri::command]
pub async fn run_self_check(app: AppHandle) -> Result<Vec<CheckResult>, String> {
    let mut results = vec![
        check_data_dir(&app),
        check_images_dir(&app),
        check_downloads_dir(&app),
        check_database(&app),
        check_proxy(&app),
        check_system_info(&app),
    ];
    results.push(check_patreon_connectivity(&app).await);
    Ok(results)
}
