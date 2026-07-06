use tauri::{AppHandle, Manager};
use super::util::{stable_hash, close_window, open_db};

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct ScrapedCreatorData {
    pub name: String,
    pub url: String,
    pub external_id: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: String,
    #[serde(rename = "subscriptionType")]
    pub subscription_type: Option<String>,
}

/// Shared state to pass scraped data from the scraper webview to the main window
pub struct ScrapedSubscriptionsState(pub std::sync::Mutex<Option<Vec<ScrapedCreatorData>>>);

#[tauri::command]
pub async fn scrape_subscriptions(app: AppHandle) -> Result<Vec<ScrapedCreatorData>, String> {
    use tauri::{WebviewWindowBuilder, WebviewUrl};

    eprintln!("DEBUG: scrape_subscriptions command called from React");

    // Clear any previous scrape results
    {
        let state = app.state::<ScrapedSubscriptionsState>();
        let mut data = state.0.lock().map_err(|e| e.to_string())?;
        *data = None;
    }

    // Close existing scraper window if it exists
    close_window(&app, "subscription-scraper");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // This init_script runs inside the webview and has access to __TAURI_INTERNALS__
    let init_script = r#"
        // Extract the creator slug from a Patreon URL robustly.
        // Handles /creator, /c/creator, /cw/creator, /creator/posts, /c/creator/about, etc.
        // /c/ and /cw/ are routing prefixes — the slug is the NEXT segment, not 'c'/'cw'.
        function patreonSlug(href) {
            try {
                const parts = new URL(href).pathname.split('/').filter(Boolean);
                const PREFIXES = ['c', 'cw'];
                const slug = PREFIXES.includes(parts[0]) ? (parts[1] || '') : (parts[0] || '');
                return slug.toLowerCase();
            } catch(e) { return ''; }
        }

        // --- Shared state: persists across ALL API responses ---
        const tierMap = {};    // slug (lowercase) -> 'free' | 'paid'
        const campaignCache = {}; // campaign id -> slug (lowercase)

        function processMembershipJson(json) {
            try {
                const items = (json && json.data) ? (Array.isArray(json.data) ? json.data : [json.data]) : [];
                const included = (json && json.included) ? json.included : [];
                const all = [...items, ...included];

                // Phase 1: accumulate campaign id -> slug into persistent cache
                all.forEach(function(item) {
                    if (item && item.type === 'campaign' && item.id &&
                        item.attributes && item.attributes.url) {
                        const slug = patreonSlug(item.attributes.url);
                        if (slug) campaignCache[item.id] = slug;
                    }
                });

                // Phase 2: match member/pledge items against accumulated campaign cache
                // Handle both v2 field (currently_entitled_amount_cents) and v1 (amount_cents)
                all.forEach(function(item) {
                    if (!item || !item.attributes) return;
                    const cents = item.attributes.currently_entitled_amount_cents != null
                        ? item.attributes.currently_entitled_amount_cents
                        : item.attributes.amount_cents;
                    if (cents === undefined || cents === null) return;
                    const campaignId = item.relationships &&
                        item.relationships.campaign &&
                        item.relationships.campaign.data &&
                        item.relationships.campaign.data.id;
                    if (!campaignId) return;
                    const slug = campaignCache[campaignId];
                    if (!slug) return;
                    tierMap[slug] = (cents > 0) ? 'paid' : 'free';
                });

                if (Object.keys(tierMap).length > 0) {
                    console.log('TierMap updated:', JSON.stringify(tierMap));
                }
            } catch(e) {
                console.error('processMembershipJson error:', e);
            }
        }

        // --- Passive fetch intercept: catches organic API calls made by the page ---
        const _origFetch = window.fetch;
        window.fetch = function(...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            const promise = _origFetch.apply(this, args);
            if (url.includes('patreon.com') && (
                url.includes('member') || url.includes('pledge') ||
                url.includes('/api/') || url.includes('/v1/') || url.includes('/v2/')
            )) {
                promise.then(function(resp) { return resp.clone().json(); })
                       .then(function(json) { processMembershipJson(json); })
                       .catch(function() {});
            }
            return promise;
        };

        // paidSlugs: slugs confirmed as paid from the pledges API.
        // Separate from tierMap so we know "we tried the API and got paid results".
        const paidSlugs = new Set();

        // --- Active API fetch: directly requests pledge/membership data ---
        // Tries the memberships endpoint first (returns free + paid), then pledges (paid only).
        // Patreon's internal REST API works with session cookies; no OAuth token needed.
        async function fetchPledgeData() {
            const candidates = [
                // Try memberships first — returns ALL memberships including $0 free tier
                '/api/current_user/memberships?include=campaign&fields[campaign]=url,name&fields[membership]=currently_entitled_amount_cents,patron_status&page[count]=200',
                // Fallback: pledges endpoint — paid subscriptions only
                '/api/pledges?include=campaign&fields[campaign]=url,name&fields[pledge]=amount_cents,status&page[count]=200',
            ];
            for (const path of candidates) {
                try {
                    const resp = await _origFetch('https://www.patreon.com' + path, { credentials: 'include' });
                    if (!resp.ok) { console.log('API not OK:', path, resp.status); continue; }
                    const json = await resp.json();
                    if (json && json.data && Array.isArray(json.data) && json.data.length > 0) {
                        console.log('API success:', path, 'items:', json.data.length);
                        processMembershipJson(json);
                        // Track paid slugs separately for fallback free-tier inference
                        Object.entries(tierMap).forEach(function([slug, tier]) {
                            if (tier === 'paid') paidSlugs.add(slug);
                        });
                        return true;
                    }
                    console.log('API returned empty data:', path);
                } catch(e) { console.log('API error:', path, e.message); }
            }
            console.log('No membership API endpoint succeeded');
            return false;
        }

        // --- DOM scrape: runs after 8 seconds to allow page + API calls to settle ---
        window.addEventListener('DOMContentLoaded', async () => {
            console.log('Patreon Subscription Scraper: DOMContentLoaded');

            // Attempt direct API fetch first (gives us authoritative tier + subscriber list)
            try { await fetchPledgeData(); } catch(e) { console.error('fetchPledgeData threw:', e); }

            setTimeout(() => {
                try {
                    const creators = [];
                    const links = document.querySelectorAll('a');
                    const ignored = ['/home', '/settings', '/checkout', '/policy', '/collection', '/memberships', '/login', '/logout', '/messages', '/notifications', 'support.patreon.com', '/search', '/explore', '/for-you'];

                    links.forEach(link => {
                        const img = link.querySelector('img');
                        if (img && link.innerText.trim().length > 0) {
                            const name = link.innerText.trim().split('\n')[0];
                            const url = link.href;
                            if (!ignored.some(p => url.includes(p))) {
                                const slug = patreonSlug(url);
                                if (!slug) return; // skip links with no meaningful slug

                                // Canonicalize to the plain /slug form. Patreon links the same
                                // creator as /slug, /cw/slug, /c/slug interchangeably; storing the
                                // raw href would make the dedup treat those as different creators.
                                const canonicalUrl = 'https://www.patreon.com/' + slug;

                                // Determine tier:
                                // 1. If tierMap has an entry → API gave us explicit data ('free'/'paid')
                                // 2. If API ran and returned paid data, anyone NOT in paidSlugs = free
                                //    (because: if you were paying, you'd be in paidSlugs)
                                // 3. Otherwise null (unknown / API unavailable)
                                let subscriptionType = tierMap[slug] || null;
                                if (subscriptionType === null && paidSlugs.size > 0) {
                                    subscriptionType = 'free';
                                }

                                // Use the real Patreon campaign numeric ID if the API gave us one,
                                // otherwise fall back to a URL-derived token.  The slug→campaignId
                                // inverse map is built here from the campaignCache we already have.
                                const slugToCampaignId = {};
                                Object.entries(campaignCache).forEach(function([cid, s]) {
                                    slugToCampaignId[s] = cid;
                                });
                                const campaignId = slugToCampaignId[slug] || btoa(canonicalUrl).substring(0, 15);

                                creators.push({
                                    name: name,
                                    url: canonicalUrl,
                                    external_id: campaignId,
                                    avatarUrl: img.src,
                                    subscriptionType: subscriptionType
                                });
                            }
                        }
                    });

                    // Deduplicate by URL
                    const unique = [...new Map(creators.map(item => [item.url, item])).values()];

                    console.log('Found ' + unique.length + ' creators, tierMap keys: ' + Object.keys(tierMap).length);
                    window.__TAURI_INTERNALS__.invoke('report_scraped_subscriptions', { creators: unique });
                } catch(e) {
                    console.error('Scraping error', e);
                }
            }, 8000);
        });
    "#;

    let builder = WebviewWindowBuilder::new(
        &app,
        "subscription-scraper",
        WebviewUrl::External("https://www.patreon.com/home".parse().unwrap())
    );

    let _window = builder
        .title("Syncing Subscriptions...")
        .visible(!super::settings::scraper_windows_hidden(&app))
        .inner_size(800.0, 600.0)
        .initialization_script(init_script)
        .build()
        .map_err(|e| e.to_string())?;

    eprintln!("DEBUG: Scraper window created. Waiting for init_script to send data via invoke...");

    // Poll the Mutex state until report_scraped_subscriptions fills it
    for i in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let creators_opt = {
            let state = app.state::<ScrapedSubscriptionsState>();
            let mut data = state.0.lock().map_err(|e| e.to_string())?;
            data.take() // Take and immediately drop the guard
        };

        if let Some(creators) = creators_opt {
            let count = creators.len();
            eprintln!("DEBUG: Poll {}: Got {} creators! Writing to file + returning.", i, count);

            // BACKUP: Write to file so frontend can read it even if invoke return fails
            let json = serde_json::to_string(&creators).unwrap_or_default();
            let backup_path = app.path().app_data_dir()
                .map(|d| d.join("patreon_scraped.json"))
                .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/patreon_scraped.json"));
            let _ = std::fs::write(&backup_path, &json);
            eprintln!("DEBUG: Wrote {} bytes to {:?}", json.len(), backup_path);

            // Close the scraper window (mutex already dropped)
            close_window(&app, "subscription-scraper");

            return Ok(creators);
        }

        eprintln!("DEBUG: Poll {}: No data yet, waiting...", i);
    }

    // Timeout — close the window
    close_window(&app, "subscription-scraper");

    Err("Scraping timed out after 30 seconds. Please try again.".to_string())
}

#[tauri::command]
pub async fn report_scraped_subscriptions(app: AppHandle, creators: Vec<ScrapedCreatorData>) -> Result<(), String> {
    eprintln!("Scraped {} subscriptions! Storing in state...", creators.len());

    // Close the scraper window
    close_window(&app, "subscription-scraper");

    // Store in managed state instead of emitting events
    let state = app.state::<ScrapedSubscriptionsState>();
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    *data = Some(creators);

    Ok(())
}

/// Frontend calls this to retrieve the scraped data (polling approach)
#[tauri::command]
pub async fn get_scraped_subscriptions(app: AppHandle) -> Result<Option<Vec<ScrapedCreatorData>>, String> {
    let state = app.state::<ScrapedSubscriptionsState>();
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    // Take the data out (returns None on subsequent calls until new scrape)
    Ok(data.take())
}

#[tauri::command]
pub async fn read_scraped_file(app: AppHandle) -> Result<String, String> {
    eprintln!("DEBUG: read_scraped_file called");
    let scraped_path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("patreon_scraped.json");
    std::fs::read_to_string(&scraped_path)
        .map_err(|e| format!("Failed to read scraped file: {}", e))
}

/// Normalize a Patreon creator URL to a canonical plain-slug form so /slug,
/// /c/slug, /cw/slug and case/trailing-slash variants all map to one value.
/// `/c/` and `/cw/` are routing prefixes — the slug is the next segment.
/// Falls back to the trimmed, lowercased input if no slug can be extracted.
fn patreon_canonical_url(raw: &str) -> String {
    let fallback = raw.trim_end_matches('/').to_lowercase();
    let parsed = match url::Url::parse(raw) {
        Ok(u) => u,
        Err(_) => return fallback,
    };
    let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    let slug = match segments.first() {
        Some(&first) if first == "c" || first == "cw" => segments.get(1).copied(),
        Some(&first) => Some(first),
        None => None,
    };
    match slug {
        Some(s) if !s.is_empty() => format!("https://www.patreon.com/{}", s.to_lowercase()),
        _ => fallback,
    }
}

#[tauri::command]
pub async fn save_scraped_to_db(app: AppHandle) -> Result<usize, String> {
    eprintln!("DEBUG: save_scraped_to_db called");

    let scraped_path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("patreon_scraped.json");
    let json_str = std::fs::read_to_string(&scraped_path)
        .map_err(|e| format!("Failed to read scraped file: {}", e))?;

    let creators: Vec<ScrapedCreatorData> = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    eprintln!("DEBUG: Read {} creators from file", creators.len());

    let conn = open_db(&app)?;

    // Map every existing Patreon creator to its canonical slug URL so a scraped
    // creator matches its existing row regardless of which URL form (/slug,
    // /cw/slug, /c/slug, case variants) either side uses. Ordered pinned-then-
    // oldest so that if legacy duplicates still exist for one slug, the "real"
    // (pinned / original) row wins and the empty twin isn't the one updated.
    let mut existing_by_canon: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, profile_url FROM creators
             WHERE source_key = 'patreon' AND profile_url IS NOT NULL
             ORDER BY is_pinned DESC, created_at ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (id, url) = row;
            existing_by_canon.entry(patreon_canonical_url(&url)).or_insert(id);
        }
    }

    // Dedup the scraped list by canonical URL (two scraped entries for the same
    // creator under different URL forms collapse to one).
    let mut seen = std::collections::HashSet::new();
    let unique_creators: Vec<&ScrapedCreatorData> = creators.iter()
        .filter(|c| seen.insert(patreon_canonical_url(&c.url)))
        .collect();

    eprintln!("DEBUG: After canonical dedup: {} unique creators", unique_creators.len());

    let mut saved_count = 0;
    let now = chrono::Utc::now().to_rfc3339();
    let mut synced_ids: Vec<String> = Vec::new();

    for creator in &unique_creators {
        // Reuse the existing row's id when this creator is already known (matched
        // by canonical slug), else derive a stable id from the canonical URL.
        let canon = patreon_canonical_url(&creator.url);
        let id = existing_by_canon.get(&canon).cloned()
            .unwrap_or_else(|| format!("{:x}", stable_hash(&canon)));
        synced_ids.push(id.clone());

        let result = conn.execute(
            "INSERT INTO creators (id, source_key, external_id, name, profile_url, avatar_path,
                                   description, last_synced_at, created_at, updated_at,
                                   is_subscribed, subscription_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11)
             ON CONFLICT(id) DO UPDATE SET
               external_id       = excluded.external_id,
               name              = excluded.name,
               profile_url       = excluded.profile_url,
               avatar_path       = excluded.avatar_path,
               last_synced_at    = excluded.last_synced_at,
               updated_at        = excluded.updated_at,
               is_subscribed     = 1,
               subscription_type = excluded.subscription_type",
            rusqlite::params![
                id,
                "patreon",
                creator.external_id,
                creator.name,
                canon,
                creator.avatar_url,
                "",
                &now,
                &now,
                &now,
                creator.subscription_type
            ],
        );

        match result {
            Ok(_) => saved_count += 1,
            Err(e) => eprintln!("DEBUG: Failed to save creator '{}': {}", creator.name, e),
        }
    }

    // Mark creators absent from this sync as unsubscribed
    if !synced_ids.is_empty() {
        let placeholders: String = synced_ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!(
            "UPDATE creators SET is_subscribed = 0 WHERE source_key = 'patreon' AND id NOT IN ({})",
            placeholders
        );
        if let Err(e) = conn.execute(&query, rusqlite::params_from_iter(synced_ids.iter())) {
            eprintln!("DEBUG: Failed to mark unsubscribed: {}", e);
        }
    }

    eprintln!("DEBUG: Saved {} creators to database", saved_count);
    Ok(saved_count)
}

#[tauri::command]
pub fn set_creator_pinned(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let conn = open_db(&app)?;
    if pinned {
        conn.execute(
            "UPDATE creators SET is_pinned = 1,
             pin_order = COALESCE((SELECT MAX(pin_order) FROM creators WHERE is_pinned = 1), 0) + 1
             WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE creators SET is_pinned = 0, pin_order = 0 WHERE id = ?1",
            rusqlite::params![id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_pinned_creators(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let conn = open_db(&app)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE creators SET pin_order = ?1 WHERE id = ?2",
            rusqlite::params![i as i64 + 1, id],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
