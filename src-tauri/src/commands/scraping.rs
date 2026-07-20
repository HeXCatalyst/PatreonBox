use tauri::{AppHandle, Manager};
use super::util::{stable_hash, close_window, open_db};

// --- Sync Checkpoint ---
#[derive(serde::Serialize, Debug)]
pub struct SyncCheckpoint {
    pub creator_id: String,
    pub cursor: String,
    pub posts_done: i64,
    pub mode: String,
}

// --- Post Scraping State ---
pub struct ScrapedPostsRawState(pub std::sync::Mutex<Option<Vec<serde_json::Value>>>);
pub struct ImageDownloadCancelFlag(pub std::sync::Arc<std::sync::atomic::AtomicBool>);

/// Monotonic heartbeat, bumped every time the in-page crawler reports forward
/// progress (one tick per API page). `scrape_creator_posts` watches it to tell
/// "still working, just slow" apart from "genuinely wedged" — see the stall
/// timeout there.
pub struct ScrapeProgressTick(pub std::sync::atomic::AtomicU64);

fn bump_progress_tick(app: &AppHandle) {
    app.state::<ScrapeProgressTick>()
        .0
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn report_scraped_posts_progress(app: AppHandle, current: i32, total: i32) -> Result<(), String> {
    use tauri::Emitter;
    bump_progress_tick(&app);
    let _ = app.emit("sync-progress", serde_json::json!({ "current": current, "total": total }));
    Ok(())
}

#[tauri::command]
pub async fn report_scraped_posts_raw(app: AppHandle, json_responses: Vec<serde_json::Value>) -> Result<(), String> {
    eprintln!("Received {} raw API JSON pages! Storing in state...", json_responses.len());
    let state = app.state::<ScrapedPostsRawState>();
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    *data = Some(json_responses);
    Ok(())
}

#[tauri::command]
pub async fn get_sync_checkpoint(app: AppHandle, creator_id: String) -> Result<Option<SyncCheckpoint>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn.prepare(
        "SELECT creator_id, cursor, posts_done, mode FROM sync_checkpoints WHERE creator_id = ?1"
    ).map_err(|e| e.to_string())?;
    let result = stmt.query_row(rusqlite::params![creator_id], |row| {
        Ok(SyncCheckpoint {
            creator_id: row.get(0)?,
            cursor: row.get(1)?,
            posts_done: row.get(2)?,
            mode: row.get(3)?,
        })
    });
    match result {
        Ok(cp) => Ok(Some(cp)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn clear_sync_checkpoint(app: AppHandle, creator_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "DELETE FROM sync_checkpoints WHERE creator_id = ?1",
        rusqlite::params![creator_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_image_download(app: AppHandle) -> Result<(), String> {
    let flag = app.state::<ImageDownloadCancelFlag>();
    flag.0.store(true, std::sync::atomic::Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn close_post_sync_window(app: AppHandle) -> Result<(), String> {
    close_window(&app, "post-scraper");
    // Unblock the polling loop in scrape_creator_posts so it exits cleanly
    let state = app.state::<ScrapedPostsRawState>();
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    *data = Some(vec![]);
    Ok(())
}

/// Close out a scrape run that produced usable data: record the imported-post
/// delta in Sync History and tell the frontend to refresh. Shared by the two
/// success exits (crawler finished; user closed the window mid-run).
fn finish_scrape_success(app: &AppHandle, run_id: &Option<String>, creator_id: &str, posts_before: i64) {
    use tauri::Emitter;
    let posts_after = super::sync_history::creator_post_count(app, creator_id);
    super::sync_history::finish_run(app, run_id, "success", 1, (posts_after - posts_before).max(0), None);
    let _ = app.emit("sync-complete", serde_json::json!({ "creator_id": creator_id }));
}

#[tauri::command]
pub async fn scrape_creator_posts(app: AppHandle, creator_url: String, creator_id: String, max_posts: Option<usize>, mode: String, resume_cursor: Option<String>, incremental: Option<bool>) -> Result<usize, String> {
    use tauri::{WebviewWindowBuilder, WebviewUrl};

    let limit = max_posts.unwrap_or(99999);
    let incremental = incremental.unwrap_or(false);
    eprintln!("DEBUG: scrape_creator_posts called for {} (id: {}, max: {}, mode: {}, resume: {:?}, incremental: {})", creator_url, creator_id, limit, mode, resume_cursor, incremental);

    // Open a Sync History run (best-effort). posts_imported is derived as the
    // after-minus-before post-count delta, so it must be sampled before scraping.
    let run_id = super::sync_history::start_run(&app, &creator_id);
    let posts_before = super::sync_history::creator_post_count(&app, &creator_id);

    // Clear previous post results
    {
        let state = app.state::<ScrapedPostsRawState>();
        let mut data = state.0.lock().map_err(|e| e.to_string())?;
        *data = None;
    }

    // Close existing scraper window
    close_window(&app, "post-scraper");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Append /posts to make sure we get the posts page
    let posts_url = if creator_url.ends_with("/posts") {
        creator_url.clone()
    } else {
        format!("{}/posts", creator_url.trim_end_matches('/'))
    };

    // Every value interpolated into the script below is emitted as a JSON
    // literal rather than pasted between hand-written quotes. JSON string syntax
    // is a subset of JS, so this is both correct and injection-proof: a quote or
    // backslash in any of these values escapes itself instead of ending the
    // literal and spilling into executable code. `limit` and `incremental` are
    // already a usize and a bool, so they need no such treatment.
    let js_literal = |v: &str| serde_json::to_string(v).unwrap_or_else(|_| "null".to_string());
    let creator_id_js = js_literal(&creator_id);
    let mode_js = js_literal(&mode);
    let start_cursor_js = match &resume_cursor {
        Some(c) => js_literal(c),
        None => "null".to_string(),
    };

    let init_script = format!(r#"
        window.addEventListener('DOMContentLoaded', () => {{
            console.log('Post Scraper: DOMContentLoaded');

            const originalFetch = window.fetch;
            let hasIntercepted = false;
            const CREATOR_ID = {};
            const MAX_POSTS = {};
            const SYNC_MODE = {};
            const START_CURSOR = {};
            const INCREMENTAL = {};

            window.fetch = async function() {{
                const response = await originalFetch.apply(this, arguments);
                let url = "";
                if (typeof arguments[0] === 'string') {{
                    url = arguments[0];
                }} else if (arguments[0] && arguments[0].url) {{
                    url = arguments[0].url;
                }}

                if (!hasIntercepted && url && url.includes('/api/posts') && url.includes('filter[campaign_id]')) {{
                    hasIntercepted = true;
                    console.log("Intercepted Patreon API:", url);

                    // Strip any pre-existing cursor from the intercepted URL.
                    // Patreon's SPA can restore the last scroll position from
                    // localStorage/cookies and embed an old cursor in its first
                    // API call, causing a fresh sync to start from a historical
                    // page instead of page 1 (newest posts).
                    let crawlUrl = url;
                    try {{
                        const urlObj = new URL(crawlUrl, window.location.origin);
                        urlObj.searchParams.delete('page[cursor]');
                        crawlUrl = urlObj.toString();
                    }} catch(e) {{}}
                    if (START_CURSOR) {{
                        try {{
                            const urlObj = new URL(crawlUrl, window.location.origin);
                            urlObj.searchParams.set('page[cursor]', START_CURSOR);
                            crawlUrl = urlObj.toString();
                        }} catch(e) {{
                            console.error('Failed to inject start cursor:', e);
                        }}
                    }}

                    setTimeout(() => crawlPatreonApi(crawlUrl), 1000);
                }}

                return response;
            }};

            async function crawlPatreonApi(initialUrl) {{
                let nextUrl = initialUrl;
                let currentCount = 0;
                window.scrollTo(0, 100);

                try {{
                    while (nextUrl) {{
                        const res = await originalFetch(nextUrl);
                        const json = await res.json();

                        // Slice the page to exactly as many posts as we still need
                        const pageData = (json.data && Array.isArray(json.data)) ? json.data : [];
                        const remaining = MAX_POSTS - currentCount;
                        const postsToSave = pageData.slice(0, remaining);
                        const pageToSend = Object.assign({{}}, json, {{ data: postsToSave }});

                        // Extract cursor for checkpoint (null on last page)
                        const cursor = (json.meta && json.meta.pagination && json.meta.pagination.cursors && json.meta.pagination.cursors.next) || null;

                        // Stream to Rust with cursor and mode.
                        // Must await so checkpoint management completes before the done signal is sent.
                        // Returns true when incremental mode detects a post that was already
                        // synced in a previous run — the page itself is still saved (upsert),
                        // but we stop paging since everything older is presumably already synced.
                        const hitExisting = await window.__TAURI_INTERNALS__.invoke('report_scraped_post_page', {{
                            creatorId: CREATOR_ID,
                            page: pageToSend,
                            cursor: cursor,
                            mode: SYNC_MODE,
                            incremental: INCREMENTAL
                        }});

                        currentCount += postsToSave.length;

                        // In incremental mode, pagination.total is the creator's whole-feed
                        // count on Patreon, not the (much smaller, unknown ahead of time)
                        // number of new posts — showing it as the denominator makes an
                        // early, successful stop look like a sync that got cut off.
                        // Leave total at 0 so the UI falls back to an indeterminate "current/..." display.
                        let total = 0;
                        if (!INCREMENTAL && json.meta && json.meta.pagination && typeof json.meta.pagination.total === 'number') {{
                            total = json.meta.pagination.total;
                        }}

                        window.__TAURI_INTERNALS__.invoke('report_scraped_posts_progress', {{ current: currentCount, total: total }});

                        if (hitExisting) {{
                            console.log("Reached already-synced posts, stopping incremental sync.");
                            nextUrl = null;
                        }} else if (currentCount >= MAX_POSTS) {{
                            console.log("Reached max posts limit:", MAX_POSTS);
                            nextUrl = null;
                        }} else if (cursor) {{
                            const urlObj = new URL(nextUrl, window.location.origin);
                            urlObj.searchParams.set('page[cursor]', cursor);
                            nextUrl = urlObj.toString();
                            await new Promise(r => setTimeout(r, 1500));
                        }} else {{
                            nextUrl = null; // No more pages
                        }}
                    }}

                    console.log('Finished fetching API pages. Sending FINISH trigger to Rust.');
                    window.__TAURI_INTERNALS__.invoke('report_scraped_posts_raw', {{ jsonResponses: [] }});
                }} catch(e) {{
                    console.error('API crawling error:', e);
                    window.__TAURI_INTERNALS__.invoke('report_scraped_posts_raw', {{ jsonResponses: [] }});
                }}
            }}

            setInterval(() => {{
                if (!hasIntercepted) {{
                    window.scrollBy(0, 500);
                }}
            }}, 2000);
        }});
    "#, creator_id_js, limit, mode_js, start_cursor_js, incremental);


    let builder = WebviewWindowBuilder::new(
        &app,
        "post-scraper",
        WebviewUrl::External(posts_url.parse().map_err(|e: url::ParseError| e.to_string())?)
    );

    // A hidden (`.visible(false)`) WKWebView doesn't run the page's render loop, so
    // Patreon's SPA never fires the /api/posts request the scraper intercepts — hiding
    // silently breaks scraping. Instead, when it should stay out of the way, show a
    // small unfocused window: it still renders (scrapes) but doesn't grab the screen.
    let unobtrusive = super::settings::scraper_windows_hidden(&app);
    let b = builder
        .title("Scraping API Posts...")
        .visible(true)
        .focused(!unobtrusive)
        .inner_size(if unobtrusive { 420.0 } else { 800.0 }, if unobtrusive { 300.0 } else { 600.0 })
        .initialization_script(init_script);
    let _window = b.build().map_err(|e| e.to_string())?;

    eprintln!("DEBUG: Post scraper API window created. Waiting for data...");

    // Wait for the crawler to signal completion via report_scraped_posts_raw.
    //
    // The bound here is a STALL timeout, not a total-duration one. A total cap
    // can't work: the in-page crawler deliberately paces itself (1.5s between
    // pages, ~20 posts a page), so a legitimate 1000-post sync needs well over
    // two minutes of wall clock. The old fixed 120s cap marked those runs
    // "failed" in Sync History and stopped the spinner while the webview kept
    // crawling and writing rows in the background — the archive grew while the
    // UI insisted the sync had died.
    //
    // Instead we watch ScrapeProgressTick, which the crawler bumps once per
    // page. As long as it keeps moving we keep waiting, however long that takes;
    // when it goes quiet for STALL_TIMEOUT we conclude something is genuinely
    // wedged (a Cloudflare challenge page, a dropped connection, a JS error) and
    // give up. That reports real failures *faster* than the old cap while never
    // cutting a healthy run short.
    const STALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);
    let tick_of = |app: &AppHandle| {
        app.state::<ScrapeProgressTick>().0.load(std::sync::atomic::Ordering::Relaxed)
    };
    let mut last_tick = tick_of(&app);
    let mut last_advance = std::time::Instant::now();

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let posts_opt = {
            let state = app.state::<ScrapedPostsRawState>();
            let mut data = state.0.lock().map_err(|e| e.to_string())?;
            data.take()
        };

        if let Some(json_pages) = posts_opt {
            eprintln!("DEBUG: Got {} JSON pages. Closing scraper window.", json_pages.len());
            close_window(&app, "post-scraper");
            finish_scrape_success(&app, &run_id, &creator_id, posts_before);
            return Ok(1);
        }

        // User closed the scraper window before it finished → stop waiting.
        // Whatever pages already reported are saved; treat it as a (partial)
        // success so the UI stops and refreshes.
        if tauri::Manager::get_webview_window(&app, "post-scraper").is_none() {
            eprintln!("DEBUG: scraper window closed by user; ending sync.");
            finish_scrape_success(&app, &run_id, &creator_id, posts_before);
            return Ok(1);
        }

        let tick = tick_of(&app);
        if tick != last_tick {
            last_tick = tick;
            last_advance = std::time::Instant::now();
        } else if last_advance.elapsed() >= STALL_TIMEOUT {
            break;
        }
    }

    close_window(&app, "post-scraper");

    // Stalled. Any pages that did land are already committed, so record the
    // partial import rather than reporting a flat zero.
    let imported = (super::sync_history::creator_post_count(&app, &creator_id) - posts_before).max(0);
    let msg = format!(
        "Post scraping stalled: no progress for {}s ({} post(s) imported before the stall).",
        STALL_TIMEOUT.as_secs(),
        imported,
    );
    super::sync_history::finish_run(&app, &run_id, "failed", 1, imported, Some(msg.clone()));
    Err(msg)
}

/// Classify an asset into the `assets.media_type` bucket.
///
/// ⚠️ The extension lists below must stay in sync with `mediaKindOf` in
/// src/lib/db.ts. That function decides what the media wall will actually
/// render, so an extension known here but not there produces rows stored as
/// `media_type='video'` that the UI silently refuses to display.
fn derive_media_type(mime: &str, filename: &str) -> &'static str {
    // Extension wins for known media types — Patreon sometimes mis-declares the
    // mimetype (e.g. an .mp4 attachment reported as image/jpeg), which would
    // otherwise bucket a video as an image.
    let ext = filename.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "webm" | "mov" | "m4v" | "mkv" | "avi" => return "video",
        "mp3" | "wav" | "ogg" | "flac" | "m4a" | "aac" => return "audio",
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" => return "image",
        _ => {}
    }
    if mime.starts_with("image/") { "image" }
    else if mime.starts_with("audio/") { "audio" }
    else if mime.starts_with("video/") { "video" }
    else { "file" }
}

#[tauri::command]
pub async fn report_scraped_post_page(app: AppHandle, creator_id: String, page: serde_json::Value, cursor: Option<String>, mode: String, incremental: Option<bool>) -> Result<bool, String> {
    eprintln!("DEBUG: Processing streaming API page for creator {} (mode={}, cursor={:?})...", creator_id, mode, cursor);
    // Counts as forward progress for the stall timeout in `scrape_creator_posts`:
    // a page that is slow to persist is still a page being worked on.
    bump_progress_tick(&app);

    // "quick" was a removed mode (title/date only); treat old checkpoints as "normal".
    let mode = if mode == "quick" { "normal".to_string() } else { mode };
    if !["normal", "full"].contains(&mode.as_str()) {
        return Err(format!("Invalid sync mode: {}", mode));
    }

    let incremental = incremental.unwrap_or(false);
    let conn = open_db(&app)?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut saved = 0;
    // Incremental early-stop is decided per *page*, not per post: we only stop
    // paging once an ENTIRE page is already in the DB. Stopping on the first
    // already-synced post (the old behavior) silently skipped whole date ranges,
    // because Patreon surfaces pinned posts at the top of page 1 — an already-synced
    // pinned post would halt the crawl before it paged back to the genuinely-new
    // posts underneath it. Counting the page lets one such post pass through.
    let mut post_count = 0usize;
    let mut existing_count = 0usize;

    // --- Build media map ---
    // Maps included-item id -> (download_url, filename, mime_type, media_type)
    // Handles both type="media" (images embedded in posts) and type="attachment" (downloadable files).
    let mut media_to_download: Vec<(String, String, String, String, String)> = Vec::new();
    let mut media_map: std::collections::HashMap<String, (String, String, String, String)> = std::collections::HashMap::new();

    if let Some(included) = page.get("included").and_then(|inc| inc.as_array()) {
        for item in included {
            let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let id = item.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
            if id.is_empty() { continue; }

            let (dl_url, filename, mime, mtype) = match item_type {
                "media" => {
                    // Prefer the full-resolution URL. `download_url` is the original
                    // file; when it's absent (e.g. newest posts / gated media) fall back
                    // to image_urls.original (also full-res) BEFORE image_urls.default,
                    // which is only a ~620px display preview and looks blurry enlarged.
                    let url = item.get("attributes")
                        .and_then(|a| {
                            a.get("download_url")
                                .or_else(|| a.get("image_urls").and_then(|u| u.get("original")))
                                .or_else(|| a.get("image_urls").and_then(|u| u.get("url")))
                                .or_else(|| a.get("image_urls").and_then(|u| u.get("default")))
                        })
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string();
                    let fname = url.split('?').next().unwrap_or(&url)
                        .split('/').last().unwrap_or("media");
                    let fname = format!("{}_{}", id, if fname.is_empty() { "media.jpg" } else { fname });
                    let mime = item.get("attributes")
                        .and_then(|a| a.get("mimetype"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("image/jpeg")
                        .to_string();
                    let mtype = derive_media_type(&mime, &fname).to_string();
                    (url, fname, mime, mtype)
                }
                "attachment" => {
                    let url = item.get("attributes")
                        .and_then(|a| a.get("url"))
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string();
                    let api_name = item.get("attributes")
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    let fname = if !api_name.is_empty() {
                        format!("{}_{}", id, api_name)
                    } else {
                        let url_part = url.split('?').next().unwrap_or(&url)
                            .split('/').last().unwrap_or("attachment");
                        format!("{}_{}", id, if url_part.is_empty() { "attachment" } else { url_part })
                    };
                    let mime = item.get("attributes")
                        .and_then(|a| a.get("mimetype"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("application/octet-stream")
                        .to_string();
                    let mtype = derive_media_type(&mime, &fname).to_string();
                    (url, fname, mime, mtype)
                }
                _ => continue,
            };

            if !dl_url.is_empty() {
                media_map.insert(id, (dl_url, filename, mime, mtype));
            }
        }
    }

    // --- Save posts ---
    if let Some(data_array) = page.get("data").and_then(|d| d.as_array()) {
        for post in data_array {
            if post.get("type").and_then(|t| t.as_str()) != Some("post") {
                continue;
            }

            let attrs = match post.get("attributes") {
                Some(a) => a,
                None => continue,
            };

            let title = attrs.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled").to_string();

            let content: String = {
                let legacy = attrs.get("content").and_then(|c| c.as_str()).unwrap_or("");
                if !legacy.is_empty() {
                    legacy.to_string()
                } else if let Some(json_str) = attrs.get("content_json_string").and_then(|c| c.as_str()) {
                    match serde_json::from_str::<serde_json::Value>(json_str) {
                        Ok(doc) => {
                            let html = super::util::prosemirror_to_html(&doc);
                            if !html.is_empty() { html } else { String::new() }
                        }
                        Err(_) => String::new(),
                    }
                } else {
                    String::new()
                }
            };

            let excerpt: String = attrs.get("content_teaser_text")
                .and_then(|t| t.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(200).collect())
                .unwrap_or_else(|| content.chars().take(200).collect());

            let published_at = attrs.get("published_at").and_then(|d| d.as_str()).unwrap_or("").to_string();
            let min_cents: Option<i64> = attrs.get("min_cents_pledged_to_view")
                .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)));
            let url = attrs.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();

            let api_post_id = post.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let post_id = if !api_post_id.is_empty() {
                api_post_id.to_string()
            } else {
                format!("{:x}", stable_hash(&format!("{}:{}", creator_id, title)))
            };

            let mut has_assets = 0;
            if let Some(rels) = post.get("relationships") {
                for rel_key in &["images", "attachments", "media"] {
                    if let Some(rel_data) = rels.get(*rel_key).and_then(|r| r.get("data")) {
                        let items = rel_data.as_array().cloned().unwrap_or_else(|| vec![rel_data.clone()]);
                        for item in items {
                            let r_id = item.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                            if let Some((dl_url, filename, mime_type, media_type)) = media_map.get(&r_id) {
                                has_assets = 1;
                                media_to_download.push((post_id.clone(), dl_url.clone(), filename.clone(), mime_type.clone(), media_type.clone()));
                            }
                        }
                    }
                }
            }

            if incremental {
                post_count += 1;
                let already_exists: bool = conn
                    .query_row("SELECT EXISTS(SELECT 1 FROM posts WHERE id = ?1)", rusqlite::params![post_id], |r| r.get(0))
                    .unwrap_or(false);
                if already_exists {
                    existing_count += 1;
                }
            }

            let result = conn.execute(
                "INSERT INTO posts (id, creator_id, source_key, external_id, title, excerpt, content_raw, content_rendered_html, content_format, source_url, published_at, has_assets, read_state, created_at, updated_at, min_cents_pledged_to_view)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   excerpt = excluded.excerpt,
                   content_raw = CASE WHEN excluded.content_raw != '' THEN excluded.content_raw ELSE content_raw END,
                   content_rendered_html = CASE WHEN excluded.content_rendered_html != '' THEN excluded.content_rendered_html ELSE content_rendered_html END,
                   source_key = excluded.source_key,
                   external_id = excluded.external_id,
                   content_format = excluded.content_format,
                   source_url = excluded.source_url,
                   published_at = excluded.published_at,
                   has_assets = CASE WHEN excluded.has_assets > has_assets THEN excluded.has_assets ELSE has_assets END,
                   updated_at = excluded.updated_at,
                   min_cents_pledged_to_view = COALESCE(excluded.min_cents_pledged_to_view, min_cents_pledged_to_view)",
                rusqlite::params![
                    post_id,
                    creator_id,
                    "patreon",
                    stable_hash(&url).to_string(),
                    title,
                    excerpt,
                    content,
                    content,
                    "html",
                    url,
                    published_at,
                    has_assets,
                    "unread",
                    &now,
                    &now,
                    min_cents
                ],
            );

            match result {
                Ok(_) => saved += 1,
                Err(e) => eprintln!("DEBUG: Failed to save API post '{}': {}", title, e),
            }
        }
    }

    // Stop incremental paging only when the whole page was already synced.
    // (An empty page counts as redundant so a trailing empty page ends the crawl.)
    let hit_existing = incremental && existing_count == post_count;

    eprintln!(
        "DEBUG: Streamed page saved {} posts to database (mode={}, existing {}/{}, stop={})",
        saved, mode, existing_count, post_count, hit_existing
    );

    // Register asset metadata
    if !media_to_download.is_empty() {
        for (post_id, dl_url, filename, mime_type, media_type) in &media_to_download {
            // Dedup on the natural key (post_id, file_name), NOT on the derived id.
            // The id is just a hash of post_id+filename for a compact PK, but a
            // conflict target of `id` is fragile: if the hashing input ever changes
            // (as it did once — it used to hash the token-carrying CDN URL), old and
            // new rows get different ids and stop deduping, leaving duplicate
            // placeholders. A UNIQUE index on (post_id, file_name) (migration v6)
            // makes the conflict target the natural key, so resyncs always update
            // the existing row regardless of what id scheme produced it.
            let asset_id = format!("{:x}", stable_hash(&format!("{}:{}", post_id, filename)));
            let rel_path = format!("images/{}/high_res/{}", creator_id, filename);
            let now = chrono::Utc::now().to_rfc3339();
            let _ = conn.execute(
                "INSERT INTO assets
                 (id, post_id, source_url, local_path, file_name, mime_type, media_type, created_at, updated_at, downloaded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
                 ON CONFLICT(post_id, file_name) DO UPDATE SET
                   source_url = excluded.source_url,
                   mime_type = excluded.mime_type,
                   media_type = excluded.media_type,
                   updated_at = excluded.updated_at",
                rusqlite::params![asset_id, post_id, dl_url, rel_path, filename, mime_type, media_type, now, now],
            );
        }
        eprintln!("DEBUG: Registered {} asset metadata records.", media_to_download.len());
    }

    // --- Checkpoint management ---
    // An incremental stop is a completed sync, not a paused one — no checkpoint to resume from.
    let effective_cursor = if hit_existing { None } else { cursor.clone() };
    match &effective_cursor {
        Some(c) if !c.is_empty() => {
            // More pages to come: upsert checkpoint, accumulating posts_done
            conn.execute(
                "INSERT INTO sync_checkpoints (creator_id, cursor, posts_done, mode, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(creator_id) DO UPDATE SET
                   cursor = excluded.cursor,
                   posts_done = sync_checkpoints.posts_done + excluded.posts_done,
                   mode = excluded.mode",
                rusqlite::params![creator_id, c, saved as i64, mode, now],
            ).map_err(|e| format!("Checkpoint upsert failed: {}", e))?;
            eprintln!("DEBUG: Checkpoint saved for {} (cursor={:?}, mode={})", creator_id, cursor, mode);
        }
        _ => {
            // cursor is None or empty: last page — delete checkpoint (sync complete)
            conn.execute(
                "DELETE FROM sync_checkpoints WHERE creator_id = ?1",
                rusqlite::params![creator_id],
            ).map_err(|e| format!("Checkpoint delete failed: {}", e))?;
            eprintln!("DEBUG: Checkpoint cleared for {} (last page)", creator_id);
        }
    }

    Ok(hit_existing)
}

#[cfg(test)]
mod tests {
    use super::derive_media_type;

    #[test]
    fn extension_beats_a_wrong_mimetype() {
        // Patreon has been observed serving .mp4 attachments as image/jpeg;
        // trusting the mime there would file a video under images.
        assert_eq!(derive_media_type("image/jpeg", "123_clip.mp4"), "video");
        assert_eq!(derive_media_type("application/octet-stream", "123_track.mp3"), "audio");
        assert_eq!(derive_media_type("text/plain", "123_page.png"), "image");
    }

    #[test]
    fn mimetype_is_the_fallback_for_unknown_extensions() {
        assert_eq!(derive_media_type("image/avif", "123_pic.avif"), "image");
        assert_eq!(derive_media_type("audio/opus", "123_voice.opus"), "audio");
        assert_eq!(derive_media_type("video/ogg", "123_reel.ogv"), "video");
    }

    #[test]
    fn anything_else_is_a_plain_file() {
        assert_eq!(derive_media_type("application/pdf", "123_ref.pdf"), "file");
        assert_eq!(derive_media_type("", "123_noext"), "file");
    }

    #[test]
    fn classification_is_case_insensitive() {
        assert_eq!(derive_media_type("", "123_CLIP.MP4"), "video");
        assert_eq!(derive_media_type("", "123_Photo.JPG"), "image");
    }

    // Every extension listed here must also be listed in `mediaKindOf`
    // (src/lib/db.ts), or assets of that type get stored but never rendered.
    // This is the guard for that pairing; update both sides together.
    #[test]
    fn video_extensions_match_the_frontend_list() {
        for ext in ["mp4", "webm", "mov", "m4v", "mkv", "avi"] {
            assert_eq!(derive_media_type("", &format!("1_a.{ext}")), "video", "{ext}");
        }
    }
}
