use tauri::{AppHandle, Manager};
use super::util::{stable_hash, close_window, open_db, build_http_client};

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

#[tauri::command]
pub async fn report_scraped_posts_progress(app: AppHandle, current: i32, total: i32) -> Result<(), String> {
    use tauri::Emitter;
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

    // Serialize start cursor as a JS literal: null or "cursor_value"
    let start_cursor_js = match &resume_cursor {
        Some(c) => serde_json::to_string(c).unwrap_or_else(|_| "null".to_string()),
        None => "null".to_string(),
    };

    let init_script = format!(r#"
        window.addEventListener('DOMContentLoaded', () => {{
            console.log('Post Scraper: DOMContentLoaded');

            const originalFetch = window.fetch;
            let hasIntercepted = false;
            const CREATOR_ID = "{}";
            const MAX_POSTS = {};
            const SYNC_MODE = "{}";
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
    "#, creator_id, limit, mode, start_cursor_js, incremental);


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

    // Poll the Mutex until report_scraped_posts_raw fills it
    for i in 0..120 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let posts_opt = {
            let state = app.state::<ScrapedPostsRawState>();
            let mut data = state.0.lock().map_err(|e| e.to_string())?;
            data.take()
        };

        if let Some(json_pages) = posts_opt {
            eprintln!("DEBUG: Poll {}: Got {} JSON pages. Closing scraper window.", i, json_pages.len());

            close_window(&app, "post-scraper");

            let posts_after = super::sync_history::creator_post_count(&app, &creator_id);
            super::sync_history::finish_run(&app, &run_id, "success", 1, (posts_after - posts_before).max(0), None);

            // Emit sync-complete so frontend can automatically refresh the post list
            use tauri::Emitter;
            let _ = app.emit("sync-complete", serde_json::json!({ "creator_id": creator_id }));

            return Ok(1);
        }
    }

    close_window(&app, "post-scraper");

    let msg = "Post API scraping timed out after 120 seconds.".to_string();
    super::sync_history::finish_run(&app, &run_id, "failed", 1, 0, Some(msg.clone()));
    Err(msg)
}

fn derive_media_type(mime: &str) -> &'static str {
    if mime.starts_with("image/") { "image" }
    else if mime.starts_with("audio/") { "audio" }
    else if mime.starts_with("video/") { "video" }
    else { "file" }
}

#[tauri::command]
pub async fn report_scraped_post_page(app: AppHandle, creator_id: String, page: serde_json::Value, cursor: Option<String>, mode: String, incremental: Option<bool>) -> Result<bool, String> {
    eprintln!("DEBUG: Processing streaming API page for creator {} (mode={}, cursor={:?})...", creator_id, mode, cursor);

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
                    let mtype = derive_media_type(&mime).to_string();
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
                    let mtype = derive_media_type(&mime).to_string();
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

#[derive(serde::Serialize)]
pub struct DownloadSummary {
    pub success: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn download_creator_images(app: AppHandle, creator_id: String, enabled_types: Option<Vec<String>>) -> Result<DownloadSummary, String> {
    super::image_migration::check_not_migrating(&app)?;
    use tauri::Emitter;

    // Clone the Arc so we own it across awaits without holding a State borrow
    let cancel_flag = app.state::<ImageDownloadCancelFlag>().0.clone();
    // Reset: a fresh call always starts from the beginning of the pending list
    cancel_flag.store(false, std::sync::atomic::Ordering::Release);

    // All asset-type toggles disabled: nothing to download
    if let Some(ref types) = enabled_types {
        if types.is_empty() {
            return Ok(DownloadSummary { success: 0, failed: 0 });
        }
    }

    // Collect pending assets synchronously — rusqlite::Connection is !Send, so we must
    // drop it before any .await point.
    struct PendingAsset {
        id: String,
        source_url: String,
        local_path: String,
    }

    let pending: Vec<PendingAsset> = {
        let conn = open_db(&app)?;

        // None → no filter (download all); Some(types) → restrict to those media_type values.
        // IS NULL guard: assets synced before this feature have NULL media_type and are treated
        // as images to remain downloadable under any type filter.
        let type_filter = match &enabled_types {
            None => String::new(),
            Some(types) => {
                let placeholders: Vec<String> = (2..=types.len() + 1)
                    .map(|i| format!("?{}", i))
                    .collect();
                format!(
                    "AND (assets.media_type IN ({}) OR assets.media_type IS NULL)",
                    placeholders.join(", ")
                )
            }
        };

        let sql = format!(
            "SELECT assets.id, assets.source_url, assets.local_path
             FROM assets
             JOIN posts ON assets.post_id = posts.id
             WHERE posts.creator_id = ?1
               AND assets.downloaded_at IS NULL
               AND assets.source_url IS NOT NULL
               {}
             ORDER BY assets.created_at ASC",
            type_filter
        );

        let mut params: Vec<rusqlite::types::Value> =
            vec![rusqlite::types::Value::Text(creator_id.clone())];
        if let Some(types) = &enabled_types {
            params.extend(types.iter().map(|t| rusqlite::types::Value::Text(t.clone())));
        }

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("DB prepare error: {}", e))?;

        let rows = stmt
            .query_map(rusqlite::params_from_iter(params), |row| {
                Ok(PendingAsset {
                    id: row.get(0)?,
                    source_url: row.get(1)?,
                    local_path: row.get(2)?,
                })
            })
            .map_err(|e| format!("DB query error: {}", e))?;

        rows.filter_map(|r| r.ok()).collect()
        // conn and stmt dropped here
    };

    let total = pending.len();
    let _ = app.emit("image-download-progress", serde_json::json!({
        "current": 0usize,
        "total": total,
        "creator_id": &creator_id
    }));

    if total == 0 {
        return Ok(DownloadSummary { success: 0, failed: 0 });
    }

    let client = build_http_client(&app);

    let mut current = 0usize;
    let mut failed = 0usize;

    for asset in &pending {
        // Check if download was cancelled or paused
        if cancel_flag.load(std::sync::atomic::Ordering::Acquire) {
            eprintln!("DEBUG: Image download cancelled/paused at {}/{}", current, total);
            break;
        }

        // Check if an image-directory migration has started since this loop began.
        // Migration snapshots the file list once at its start; any file this loop
        // writes after that snapshot would be silently destroyed by migration's
        // final `remove_dir_all(&source)`. Stop cleanly rather than race it.
        if super::image_migration::check_not_migrating(&app).is_err() {
            eprintln!("DEBUG: Image download stopped — migration started at {}/{}", current, total);
            break;
        }

        let dest = super::file_ops::asset_full_path(&app, &asset.local_path)?;

        // Ensure parent directory exists
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).unwrap_or_default();
        }

        // File already on disk (e.g. pre-migration): mark downloaded, skip re-download
        if dest.exists() {
            let now = chrono::Utc::now().to_rfc3339();
            let file_size = std::fs::metadata(&dest).map(|m| m.len() as i64).ok();
            // Open a fresh connection for this update (no .await held across it)
            if let Ok(conn) = open_db(&app) {
                let _ = conn.execute(
                    "UPDATE assets SET downloaded_at = ?1, byte_size = ?2 WHERE id = ?3",
                    rusqlite::params![now, file_size, asset.id],
                );
            }
            current += 1;
            let _ = app.emit("image-download-progress", serde_json::json!({
                "current": current,
                "total": total,
                "creator_id": &creator_id
            }));
            continue;
        }

        // Download file
        match client.get(&asset.source_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.bytes().await {
                    Ok(bytes) => {
                        let file_size = bytes.len() as i64;
                        if let Err(e) = std::fs::write(&dest, &bytes) {
                            eprintln!("Failed to write {}: {}", dest.display(), e);
                            failed += 1;
                        } else {
                            let now = chrono::Utc::now().to_rfc3339();
                            // Open a fresh connection for this update (no .await held across it)
                            if let Ok(conn) = open_db(&app) {
                                let _ = conn.execute(
                                    "UPDATE assets SET downloaded_at = ?1, byte_size = ?2 WHERE id = ?3",
                                    rusqlite::params![now, file_size, asset.id],
                                );
                            }
                            current += 1;
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed reading bytes for {}: {}", asset.local_path, e);
                        failed += 1;
                    }
                }
            }
            Ok(resp) => {
                eprintln!("HTTP {} for {}", resp.status(), asset.source_url);
                failed += 1;
            }
            Err(e) => {
                eprintln!("GET failed for {}: {}", asset.source_url, e);
                failed += 1;
            }
        }

        let _ = app.emit("image-download-progress", serde_json::json!({
            "current": current,
            "total": total,
            "creator_id": &creator_id
        }));

        // Configurable delay to avoid CDN rate-limiting
        let (delay_enabled, delay_ms, jitter_enabled, jitter_ms) = {
            let state = app.state::<super::settings::AppSettingsState>();
            let s = state.0.read().unwrap_or_else(|e| e.into_inner());
            (s.image_download_delay_enabled, s.image_download_delay_ms,
             s.image_download_jitter_enabled, s.image_download_jitter_ms)
        };
        if delay_enabled {
            let jitter = if jitter_enabled { fastrand::u32(0..jitter_ms.max(1)) } else { 0 };
            tokio::time::sleep(std::time::Duration::from_millis((delay_ms + jitter) as u64)).await;
        }
    }

    Ok(DownloadSummary { success: current, failed })
}
