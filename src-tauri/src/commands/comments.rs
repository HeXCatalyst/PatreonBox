use std::collections::HashMap;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use super::util::{close_window, open_db};

const SINGLE_COMMENT_WINDOW: &str = "single-comment-scraper";
const BULK_COMMENT_WINDOW: &str = "comment-scraper";
// Each worker has one shared result buffer. Serialize its callers before
// resetting that buffer or touching its window; single and bulk stay independent.
static SINGLE_COMMENT_FETCH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static BULK_COMMENT_FETCH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Filled by `report_post_comments` (from the webview), drained by `fetch_post_comments`.
pub struct PostCommentsRawState(pub std::sync::Mutex<Option<Vec<serde_json::Value>>>);

/// One post's worth of results during a bulk backfill, pushed by the webview as
/// it works through the list. Separate from `PostCommentsRawState` so a bulk run
/// and a single-post refresh can't drain each other's slot.
#[derive(Default)]
pub struct BulkCommentsState {
    /// (post_id, pages) reported so far, drained by the polling loop.
    pub queue: std::sync::Mutex<Vec<(String, Vec<serde_json::Value>)>>,
    /// Set once the webview has worked through every id.
    pub done: std::sync::atomic::AtomicBool,
}

/// The webview reports the collected comment API pages back here.
#[tauri::command]
pub async fn report_post_comments(app: AppHandle, pages: Vec<serde_json::Value>) -> Result<(), String> {
    let state = app.state::<PostCommentsRawState>();
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    *data = Some(pages);
    Ok(())
}

/// The bulk webview reports one post's pages as it finishes each.
#[tauri::command]
pub async fn report_bulk_comments(
    app: AppHandle,
    post_id: String,
    pages: Vec<serde_json::Value>,
    done: bool,
) -> Result<(), String> {
    let state = app.state::<BulkCommentsState>();
    if !post_id.is_empty() {
        state.queue.lock().map_err(|e| e.to_string())?.push((post_id, pages));
    }
    if done {
        state.done.store(true, std::sync::atomic::Ordering::Release);
    }
    Ok(())
}

/// A commenter's display name and Patreon profile URL, keyed by user id.
struct UserInfo {
    name: String,
    url: Option<String>,
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
    is_author: bool,
    author_url: Option<String>,
}

fn parse_comment(
    item: &serde_json::Value,
    users: &HashMap<String, UserInfo>,
    creator_user_id: Option<&str>,
) -> Option<Row> {
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
    let user = author_id.as_ref().and_then(|aid| users.get(aid));
    let author_name = user.map(|u| u.name.clone());
    let author_url = user.and_then(|u| u.url.clone());
    let is_author = match (author_id.as_deref(), creator_user_id) {
        (Some(a), Some(c)) => a == c,
        _ => false,
    };
    Some(Row { id, parent_id, author_id, author_name, body, published_at, reply_count, is_author, author_url })
}

/// The post creator's *user* id, resolved from the campaign object in
/// `included` whose id matches `campaign_id`.
///
/// Needed because comments identify their author by user id, while
/// `creators.external_id` locally holds the campaign id — comparing those two
/// directly would never match.
///
/// The campaign has to be matched by id rather than just taking the first one:
/// when another creator comments on a post, Patreon includes *their* campaign
/// too, and picking whichever came first badged them as this post's author.
/// Returns None when the campaign isn't found (e.g. a creator row whose
/// external_id isn't a campaign id), so nobody gets badged rather than the
/// wrong person.
fn creator_user_id(json: &serde_json::Value, campaign_id: Option<&str>) -> Option<String> {
    let campaign_id = campaign_id?;
    json.get("included")?.as_array()?.iter().find_map(|item| {
        if item.get("type").and_then(|t| t.as_str()) != Some("campaign") {
            return None;
        }
        if item.get("id").and_then(|i| i.as_str()) != Some(campaign_id) {
            return None;
        }
        item.get("relationships")?
            .get("creator")?
            .get("data")?
            .get("id")?
            .as_str()
            .map(|s| s.to_string())
    })
}

/// The Patreon campaign id for the creator that owns a post, as stored locally.
fn campaign_id_for_post(conn: &rusqlite::Connection, post_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT c.external_id FROM posts p
         JOIN creators c ON c.id = p.creator_id
         WHERE p.id = ?1",
        rusqlite::params![post_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

/// Fetch a post's comments and cache them locally. Patreon's `/api/*` endpoints
/// are bot-protected, so — like the post scraper — this runs inside an
/// authenticated webview: it navigates to the comments API URL (raw JSON, no SPA),
/// reads it, follows `links.next`, and reports the pages back for parsing.
#[tauri::command]
pub async fn fetch_post_comments(app: AppHandle, post_id: String) -> Result<usize, String> {
    let _fetch_guard = SINGLE_COMMENT_FETCH.lock().await;
    // Close any lingering scraper window from a previous fetch (avoids a
    // "label already exists" collision) and reset the handoff slot.
    close_window(&app, SINGLE_COMMENT_WINDOW);
    {
        let state = app.state::<PostCommentsRawState>();
        *state.0.lock().map_err(|e| e.to_string())? = None;
    }

    // This id is pasted straight into a URL path, so constrain it to the shapes
    // we actually mint: a numeric Patreon post id, or — when the API omitted one
    // — the hex stable_hash fallback from report_scraped_post_page. Alphanumeric
    // covers both while rejecting `/`, `?`, `#` and `..`, any of which could
    // point the webview at a different endpoint than intended.
    if post_id.is_empty() || !post_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("Invalid post id: {}", post_id));
    }
    // Reply nesting needs `parent` in BOTH `include` and `fields[comment]`, and
    // the second one is the non-obvious half. A sparse fieldset is a whitelist:
    // once `fields[comment]` is present, anything not listed is stripped from the
    // response — and Patreon applies that to relationships too, not just
    // attributes. So with `include=parent` but no `parent` in the fieldset, every
    // comment came back with `"parent": {"data": null}` — the key present, the
    // link silently removed — parent_id was always NULL, and the UI (which
    // already nests by parent_id) drew every reply as top-level.
    //
    // That failure is easy to misread: a genuinely flat thread produces exactly
    // the same `"parent": {"data": null}`, so it only shows up on a post that
    // actually has replies. `first_reply.*` is included for the replies
    // themselves, which arrive inside `included` and go through the same parser.
    let api_url = format!(
        "https://www.patreon.com/api/posts/{}/comments2?include=commenter,parent,first_reply.commenter,first_reply.parent&fields[comment]=body,created,reply_count,parent&fields[user]=full_name,image_url,url&page[count]=50&sort=-created&json-api-version=1.0",
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
        SINGLE_COMMENT_WINDOW,
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
        if app.get_webview_window(SINGLE_COMMENT_WINDOW).is_none() { break; }
    }
    close_window(&app, SINGLE_COMMENT_WINDOW);

    let pages = pages.ok_or_else(|| "Timed out fetching comments".to_string())?;

    let conn = open_db(&app)?;
    save_comment_pages(&conn, &post_id, &pages)
}

/// Empty `data` is a valid cached result. Missing data, error responses, or a
/// remaining next page mean the fetch did not finish; never mark those complete.
fn validate_comment_pages(pages: &[serde_json::Value]) -> Result<(), String> {
    if pages.is_empty() {
        return Err("No valid comment response received".into());
    }
    for page in pages {
        let data = page.get("data").and_then(|v| v.as_array())
            .ok_or("Invalid comment response")?;
        if page.get("errors").is_some()
            || data.iter().any(|item| {
                item.get("type").and_then(|v| v.as_str()) != Some("comment")
                    || item.get("id").and_then(|v| v.as_str()).map_or(true, str::is_empty)
            })
        {
            return Err("Invalid comment response".into());
        }
    }
    let next = pages.last().and_then(|page| page.get("links")).and_then(|v| v.get("next"));
    if next.is_some_and(|value| !value.is_null()) {
        return Err("Comment pagination did not finish; retry this post".into());
    }
    Ok(())
}

/// Parse one post's API pages and replace its cached comments. Returns how many
/// rows were written. Shared by the single-post fetch and the bulk backfill.
///
/// Comments are collected from both `data` and `included` — replies come back
/// nested under `first_reply`, so they only exist in `included`.
fn save_comment_pages(
    conn: &rusqlite::Connection,
    post_id: &str,
    pages: &[serde_json::Value],
) -> Result<usize, String> {
    validate_comment_pages(pages)?;
    // Which campaign counts as "the author" for this post.
    let campaign_id = campaign_id_for_post(conn, post_id);
    let mut rows: HashMap<String, Row> = HashMap::new();
    for json in pages {
        let creator_uid = creator_user_id(json, campaign_id.as_deref());
        let mut users: HashMap<String, UserInfo> = HashMap::new();
        if let Some(inc) = json.get("included").and_then(|v| v.as_array()) {
            for item in inc {
                if item.get("type").and_then(|t| t.as_str()) == Some("user") {
                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                        let attrs = item.get("attributes");
                        let name = attrs.and_then(|a| a.get("full_name"))
                            .and_then(|n| n.as_str()).unwrap_or("").to_string();
                        // `url` is the public profile page. The `links.related`
                        // on the relationship points at the API endpoint instead,
                        // which would open raw JSON rather than a profile.
                        let url = attrs.and_then(|a| a.get("url"))
                            .and_then(|u| u.as_str())
                            .filter(|u| u.starts_with("https://"))
                            .map(|u| u.to_string());
                        users.insert(id.to_string(), UserInfo { name, url });
                    }
                }
            }
        }
        if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
            for item in data {
                if let Some(r) = parse_comment(item, &users, creator_uid.as_deref()) {
                    rows.insert(r.id.clone(), r);
                }
            }
        }
        if let Some(inc) = json.get("included").and_then(|v| v.as_array()) {
            for item in inc {
                if item.get("type").and_then(|t| t.as_str()) == Some("comment") {
                    if let Some(r) = parse_comment(item, &users, creator_uid.as_deref()) {
                        rows.insert(r.id.clone(), r);
                    }
                }
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    // Cache replacement and completion marker commit together, including a
    // genuinely empty cache. Any write/commit failure preserves the old data.
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM comments WHERE post_id = ?1", [post_id])
        .map_err(|e| e.to_string())?;
    for r in rows.values() {
        tx.execute(
            "INSERT OR REPLACE INTO comments
               (id, post_id, parent_id, author_name, author_id, body, published_at, reply_count, fetched_at, is_author, author_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![r.id, post_id, r.parent_id, r.author_name, r.author_id, r.body, r.published_at, r.reply_count, now, r.is_author as i32, r.author_url],
        ).map_err(|e| e.to_string())?;
    }
    let updated = tx.execute("UPDATE posts SET comments_fetched_at = ?1 WHERE id = ?2",
        rusqlite::params![now, post_id]).map_err(|e| e.to_string())?;
    if updated != 1 {
        return Err("Post no longer exists; comment cache was not saved".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(rows.len())
}

/// Progress ping for a bulk comment backfill.
#[derive(Clone, serde::Serialize)]
struct BulkCommentProgress {
    done: usize,
    total: usize,
    saved: usize,
}

/// Fetch comments for many posts in one pass, replacing each post's cache.
///
/// Deliberately one webview for the whole batch rather than calling
/// `fetch_post_comments` per post: that opens a window and polls for up to 30s
/// each time, so a creator with a few hundred posts would mean hundreds of
/// windows and potentially hours. Here a single hidden webview walks the list
/// with same-origin fetches and streams each post's pages back as it goes.
///
/// Returns the number of comment rows written across all posts.
#[tauri::command]
pub async fn fetch_comments_for_posts(app: AppHandle, post_ids: Vec<String>) -> Result<usize, String> {
    use tauri::Emitter;

    // Same constraint as the single fetch: these ids are interpolated into URLs.
    let ids: Vec<String> = post_ids
        .into_iter()
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        .collect();
    if ids.is_empty() {
        return Ok(0);
    }
    let total = ids.len();

    let _fetch_guard = BULK_COMMENT_FETCH.lock().await;
    close_window(&app, BULK_COMMENT_WINDOW);
    {
        let state = app.state::<BulkCommentsState>();
        state.queue.lock().map_err(|e| e.to_string())?.clear();
        state.done.store(false, std::sync::atomic::Ordering::Release);
    }

    let ids_js = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    // Read the live concurrency setting each run (clamped the same 1..=10 the
    // settings UI enforces), so a change applies to the next backfill without a
    // restart — same pattern as read_download_settings in download_manager.
    let concurrency: usize = {
        let state = app.state::<super::settings::AppSettingsState>();
        let s = state.0.read().unwrap_or_else(|e| e.into_inner());
        s.comment_fetch_concurrency.clamp(1, 10) as usize
    };
    // Paced to stay under Patreon's rate limiting; a backfill is a background
    // chore, so it's better to be slow than to get throttled into failures.
    // `concurrency` posts are in flight at once (1 = the original strictly
    // sequential walk); each worker keeps the 350ms pause between the posts it
    // picks up, so raising the count raises the request rate accordingly.
    let init_script = format!(
        r#"
        window.addEventListener('DOMContentLoaded', async () => {{
            const IDS = {ids_js};
            const WORKERS = {concurrency};
            const FIELDS = 'include=commenter,parent,first_reply.commenter,first_reply.parent'
                + '&fields[comment]=body,created,reply_count,parent&fields[user]=full_name,image_url,url'
                + '&page[count]=50&sort=-created&json-api-version=1.0';
            let next = 0;
            const worker = async () => {{
                for (;;) {{
                    const i = next++;
                    if (i >= IDS.length) return;
                    const id = IDS[i];
                    const pages = [];
                    try {{
                        let url = 'https://www.patreon.com/api/posts/' + id + '/comments2?' + FIELDS;
                        for (let p = 0; p < 20 && url; p++) {{
                            const resp = await fetch(url, {{ credentials: 'include', headers: {{ 'Accept': 'application/json' }} }});
                            if (!resp.ok) break;
                            const json = await resp.json();
                            pages.push(json);
                            url = json && json.links && json.links.next;
                        }}
                    }} catch (e) {{ /* skip this post, keep going */ }}
                    try {{
                        await window.__TAURI_INTERNALS__.invoke('report_bulk_comments',
                            {{ postId: id, pages: pages, done: false }});
                    }} catch (e) {{}}
                    // Anti-throttle pacing, per worker: pause between the posts
                    // this worker picks up (unchanged from the sequential walk).
                    await new Promise(r => setTimeout(r, 350));
                }}
            }};
            await Promise.all(Array.from({{ length: WORKERS }}, worker));
            try {{
                await window.__TAURI_INTERNALS__.invoke('report_bulk_comments',
                    {{ postId: '', pages: [], done: true }});
            }} catch (e) {{}}
        }});
    "#
    );

    // Land on a cheap same-origin page: the script drives everything by fetch,
    // so the document itself only has to establish the origin + session.
    let _window = WebviewWindowBuilder::new(
        &app,
        BULK_COMMENT_WINDOW,
        WebviewUrl::External(
            "https://www.patreon.com/favicon.ico"
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?,
        ),
    )
    .title("Fetching comments…")
    .visible(false)
    .focused(false)
    .inner_size(400.0, 300.0)
    .initialization_script(init_script)
    .build()
    .map_err(|e| e.to_string())?;

    // Drain reported posts as they arrive. The bound is a stall timeout, not a
    // total one — a few hundred posts at ~0.5s each legitimately takes minutes.
    const STALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
    let mut saved = 0usize;
    let mut failed = 0usize;
    let mut done_count = 0usize;
    let mut last_progress = std::time::Instant::now();

    loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let batch: Vec<(String, Vec<serde_json::Value>)> = {
            let state = app.state::<BulkCommentsState>();
            let mut q = state.queue.lock().map_err(|e| e.to_string())?;
            std::mem::take(&mut *q)
        };

        if !batch.is_empty() {
            let conn = match open_db(&app) {
                Ok(conn) => conn,
                Err(error) => {
                    close_window(&app, BULK_COMMENT_WINDOW);
                    return Err(error);
                }
            };
            for (post_id, pages) in &batch {
                match save_comment_pages(&conn, post_id, pages) {
                    Ok(count) => saved += count,
                    Err(_) => failed += 1,
                }
                done_count += 1;
            }
            last_progress = std::time::Instant::now();
            let _ = app.emit(
                "comment-backfill-progress",
                BulkCommentProgress { done: done_count, total, saved },
            );
        }

        let finished = app
            .state::<BulkCommentsState>()
            .done
            .load(std::sync::atomic::Ordering::Acquire);
        // Only stop once the drain is empty too, or a final batch could be lost.
        if finished && batch.is_empty() {
            break;
        }
        if app.get_webview_window(BULK_COMMENT_WINDOW).is_none() {
            break; // user closed it — keep whatever landed
        }
        if last_progress.elapsed() >= STALL_TIMEOUT {
            break;
        }
    }

    close_window(&app, BULK_COMMENT_WINDOW);
    if failed > 0 || done_count < total {
        return Err(format!("Comment fetch incomplete: {} of {} posts failed or were not reached",
            failed + total.saturating_sub(done_count), total));
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::{creator_user_id, save_comment_pages};
    use serde_json::json;

    fn cache_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/00001_init.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/00016_comment_fetch_state.sql")).unwrap();
        conn.execute_batch(
            "CREATE TABLE comments (
                id TEXT PRIMARY KEY, post_id TEXT NOT NULL, parent_id TEXT,
                author_name TEXT, author_id TEXT, body TEXT, published_at TEXT,
                reply_count INTEGER NOT NULL DEFAULT 0, fetched_at TEXT,
                is_author INTEGER NOT NULL DEFAULT 0, author_url TEXT
            );
            INSERT INTO creators (id, source_key, external_id, name, created_at, updated_at)
                VALUES ('c1', 'patreon', '1', 'Example Creator', 'test', 'test');
            INSERT INTO posts (id, creator_id, source_key, title, created_at, updated_at)
                VALUES ('101', 'c1', 'patreon', 'Example post', 'test', 'test');"
        ).unwrap();
        conn
    }

    fn fetched_at(conn: &rusqlite::Connection) -> Option<String> {
        conn.query_row("SELECT comments_fetched_at FROM posts WHERE id='101'", [], |row| row.get(0)).unwrap()
    }

    fn comment_page(id: &str) -> serde_json::Value {
        json!({ "data": [{ "type": "comment", "id": id, "attributes": { "body": "Example comment" } }],
            "links": { "next": null } })
    }

    #[test]
    fn successful_empty_comments_are_persisted_and_survive_post_updates() {
        let conn = cache_db();
        assert_eq!(fetched_at(&conn), None);
        assert_eq!(save_comment_pages(&conn, "101", &[json!({"data": [], "links": {"next": null}})]).unwrap(), 0);
        let fetched = fetched_at(&conn);
        assert!(fetched.is_some());
        conn.execute("UPDATE posts SET title='Updated example' WHERE id='101'", []).unwrap();
        assert_eq!(fetched_at(&conn), fetched);
        let count: i64 = conn.query_row("SELECT count(*) FROM comments", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn failed_and_incomplete_responses_remain_retryable() {
        let conn = cache_db();
        let mut unfinished = comment_page("1");
        unfinished["links"]["next"] = json!("https://example.invalid/comments?page=2");
        for pages in [
            vec![], vec![json!({"errors": [{"status": "429"}]})],
            vec![json!({"data": null})], vec![json!({"data": [{"type": "comment"}]})],
            vec![unfinished], vec![comment_page("1"), json!({"errors": []})],
        ] {
            assert!(save_comment_pages(&conn, "101", &pages).is_err());
            assert_eq!(fetched_at(&conn), None);
            let count: i64 = conn.query_row("SELECT count(*) FROM comments", [], |r| r.get(0)).unwrap();
            assert_eq!(count, 0);
        }
    }

    #[test]
    fn failed_refresh_preserves_cache_but_valid_empty_refresh_clears_it() {
        let conn = cache_db();
        assert_eq!(save_comment_pages(&conn, "101", &[comment_page("1")]).unwrap(), 1);
        let fetched = fetched_at(&conn);
        assert!(save_comment_pages(&conn, "101", &[]).is_err());
        assert_eq!(fetched_at(&conn), fetched);
        let count: i64 = conn.query_row("SELECT count(*) FROM comments", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        assert_eq!(save_comment_pages(&conn, "101", &[json!({"data": []})]).unwrap(), 0);
        assert!(fetched_at(&conn).is_some());
        let count: i64 = conn.query_row("SELECT count(*) FROM comments", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn failed_cache_or_marker_write_rolls_back_the_whole_refresh() {
        for trigger in [
            "CREATE TRIGGER fail_write BEFORE INSERT ON comments BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
            "CREATE TRIGGER fail_write BEFORE UPDATE OF comments_fetched_at ON posts BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        ] {
            let conn = cache_db();
            save_comment_pages(&conn, "101", &[comment_page("1")]).unwrap();
            let fetched = fetched_at(&conn);
            conn.execute_batch(trigger).unwrap();
            assert!(save_comment_pages(&conn, "101", &[comment_page("2")]).is_err());
            assert_eq!(fetched_at(&conn), fetched);
            let id: String = conn.query_row("SELECT id FROM comments", [], |r| r.get(0)).unwrap();
            assert_eq!(id, "1");
        }
    }

    #[test]
    fn multi_page_fetch_marks_success_only_after_the_last_page() {
        let conn = cache_db();
        let mut first = comment_page("1");
        first["links"]["next"] = json!("https://example.invalid/comments?page=2");
        assert_eq!(save_comment_pages(&conn, "101", &[first, comment_page("2")]).unwrap(), 2);
        assert!(fetched_at(&conn).is_some());
        assert!(save_comment_pages(&conn, "missing", &[comment_page("3")]).is_err());
        let count: i64 = conn.query_row("SELECT count(*) FROM comments", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    /// Two campaigns in `included` — the post's own, plus one belonging to
    /// another creator who left a comment. Picking the first would badge the
    /// visiting creator as this post's author.
    fn two_campaign_page() -> serde_json::Value {
        json!({
            "included": [
                { "type": "user", "id": "111", "attributes": { "full_name": "Visitor" } },
                { "type": "campaign", "id": "VISITOR_CAMPAIGN",
                  "relationships": { "creator": { "data": { "id": "111", "type": "user" } } } },
                { "type": "campaign", "id": "OWN_CAMPAIGN",
                  "relationships": { "creator": { "data": { "id": "999", "type": "user" } } } }
            ]
        })
    }

    #[test]
    fn resolves_the_matching_campaigns_creator() {
        let page = two_campaign_page();
        assert_eq!(creator_user_id(&page, Some("OWN_CAMPAIGN")).as_deref(), Some("999"));
        // ...and not merely whichever campaign happened to come first.
        assert_eq!(creator_user_id(&page, Some("VISITOR_CAMPAIGN")).as_deref(), Some("111"));
    }

    #[test]
    fn no_match_badges_nobody() {
        // An unknown campaign id (or a creator row whose external_id isn't one)
        // must yield None, so no commenter is wrongly marked as the author.
        let page = two_campaign_page();
        assert_eq!(creator_user_id(&page, Some("SOMETHING_ELSE")), None);
        assert_eq!(creator_user_id(&page, None), None);
    }

    #[test]
    fn handles_pages_without_campaigns() {
        let page = json!({ "included": [ { "type": "user", "id": "1" } ] });
        assert_eq!(creator_user_id(&page, Some("OWN_CAMPAIGN")), None);
        assert_eq!(creator_user_id(&json!({}), Some("OWN_CAMPAIGN")), None);
    }
}
