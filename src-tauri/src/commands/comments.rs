use std::collections::HashMap;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use super::util::{close_window, open_db};

/// Filled by `report_post_comments` (from the webview), drained by `fetch_post_comments`.
pub struct PostCommentsRawState(pub std::sync::Mutex<Option<Vec<serde_json::Value>>>);

/// The webview reports the collected comment API pages back here.
#[tauri::command]
pub async fn report_post_comments(app: AppHandle, pages: Vec<serde_json::Value>) -> Result<(), String> {
    let state = app.state::<PostCommentsRawState>();
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    *data = Some(pages);
    Ok(())
}

/// A parsed comment ready to persist.
struct Row {
    id: String,
    parent_id: Option<String>,
    author_id: Option<String>,
    author_name: Option<String>,
    body: String,
    published_at: Option<String>,
    reply_count: i64,
}

fn parse_comment(item: &serde_json::Value, users: &HashMap<String, String>) -> Option<Row> {
    if item.get("type").and_then(|t| t.as_str()) != Some("comment") {
        return None;
    }
    let id = item.get("id").and_then(|i| i.as_str())?.to_string();
    let attrs = item.get("attributes");
    let body = attrs.and_then(|a| a.get("body")).and_then(|b| b.as_str()).unwrap_or("").to_string();
    let published_at = attrs.and_then(|a| a.get("created")).and_then(|c| c.as_str()).map(|s| s.to_string());
    let reply_count = attrs.and_then(|a| a.get("reply_count")).and_then(|c| c.as_i64()).unwrap_or(0);
    let rels = item.get("relationships");
    let author_id = rels
        .and_then(|r| r.get("commenter")).and_then(|c| c.get("data")).and_then(|d| d.get("id"))
        .and_then(|i| i.as_str()).map(|s| s.to_string());
    let parent_id = rels
        .and_then(|r| r.get("parent")).and_then(|p| p.get("data")).and_then(|d| d.get("id"))
        .and_then(|i| i.as_str()).map(|s| s.to_string());
    let author_name = author_id.as_ref().and_then(|aid| users.get(aid).cloned());
    Some(Row { id, parent_id, author_id, author_name, body, published_at, reply_count })
}

/// Fetch a post's comments and cache them locally. Patreon's `/api/*` endpoints
/// are bot-protected, so — like the post scraper — this runs inside an
/// authenticated webview: it navigates to the comments API URL (raw JSON, no SPA),
/// reads it, follows `links.next`, and reports the pages back for parsing.
#[tauri::command]
pub async fn fetch_post_comments(app: AppHandle, post_id: String) -> Result<usize, String> {
    // Close any lingering scraper window from a previous fetch (avoids a
    // "label already exists" collision) and reset the handoff slot.
    close_window(&app, "comment-scraper");
    {
        let state = app.state::<PostCommentsRawState>();
        *state.0.lock().map_err(|e| e.to_string())? = None;
    }

    let api_url = format!(
        "https://www.patreon.com/api/posts/{}/comments2?include=commenter,first_reply.commenter&fields[comment]=body,created,reply_count&fields[user]=full_name,image_url&page[count]=50&sort=-created&json-api-version=1.0",
        post_id
    );

    // The webview lands on the raw-JSON API page (already authenticated + past
    // Cloudflare because it's a real browser with the session), reads it as page 1,
    // then paginates via same-origin fetch.
    let init_script = r#"
        window.addEventListener('DOMContentLoaded', async () => {
            const pages = [];
            try {
                const first = JSON.parse(document.body.innerText);
                pages.push(first);
                let next = first && first.links && first.links.next;
                for (let i = 0; i < 20 && next; i++) {
                    const resp = await fetch(next, { credentials: 'include', headers: { 'Accept': 'application/json' } });
                    if (!resp.ok) break;
                    const json = await resp.json();
                    pages.push(json);
                    next = json && json.links && json.links.next;
                }
            } catch (e) { /* not JSON (e.g. a challenge page) → report empty */ }
            try { window.__TAURI_INTERNALS__.invoke('report_post_comments', { pages: pages }); } catch (e) {}
        });
    "#;

    let _window = WebviewWindowBuilder::new(
        &app,
        "comment-scraper",
        WebviewUrl::External(api_url.parse().map_err(|e: url::ParseError| e.to_string())?),
    )
    .title("Fetching comments…")
    // Hidden: we navigate straight to a raw-JSON page (no SPA render loop needed),
    // so DOMContentLoaded + our fetch still run without ever showing a window.
    .visible(false)
    .focused(false)
    .inner_size(400.0, 300.0)
    .initialization_script(init_script)
    .build()
    .map_err(|e| e.to_string())?;

    // Poll for the reported pages (up to ~30s), or bail if the window is closed.
    let mut pages: Option<Vec<serde_json::Value>> = None;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        {
            let state = app.state::<PostCommentsRawState>();
            let mut data = state.0.lock().map_err(|e| e.to_string())?;
            if data.is_some() { pages = data.take(); break; }
        }
        if app.get_webview_window("comment-scraper").is_none() { break; }
    }
    close_window(&app, "comment-scraper");

    let pages = pages.ok_or_else(|| "Timed out fetching comments".to_string())?;

    // Parse every page: build the author map from `included` users, collect
    // comments from both `data` and `included` (first replies).
    let mut rows: HashMap<String, Row> = HashMap::new();
    for json in &pages {
        let mut users: HashMap<String, String> = HashMap::new();
        if let Some(inc) = json.get("included").and_then(|v| v.as_array()) {
            for item in inc {
                if item.get("type").and_then(|t| t.as_str()) == Some("user") {
                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                        let name = item.get("attributes").and_then(|a| a.get("full_name"))
                            .and_then(|n| n.as_str()).unwrap_or("").to_string();
                        users.insert(id.to_string(), name);
                    }
                }
            }
        }
        if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
            for item in data { if let Some(r) = parse_comment(item, &users) { rows.insert(r.id.clone(), r); } }
        }
        if let Some(inc) = json.get("included").and_then(|v| v.as_array()) {
            for item in inc {
                if item.get("type").and_then(|t| t.as_str()) == Some("comment") {
                    if let Some(r) = parse_comment(item, &users) { rows.insert(r.id.clone(), r); }
                }
            }
        }
    }

    let conn = open_db(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("DELETE FROM comments WHERE post_id = ?1", rusqlite::params![post_id]).map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for r in rows.values() {
        let res = conn.execute(
            "INSERT OR REPLACE INTO comments
               (id, post_id, parent_id, author_name, author_id, body, published_at, reply_count, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![r.id, post_id, r.parent_id, r.author_name, r.author_id, r.body, r.published_at, r.reply_count, now],
        );
        if res.is_ok() { count += 1; }
    }
    Ok(count)
}
