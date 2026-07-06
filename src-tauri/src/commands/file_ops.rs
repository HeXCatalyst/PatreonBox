use tauri::{AppHandle, Manager};
use super::util::open_db;
use std::fs;
use sha2::{Sha256, Digest};
use std::io::Read;
use super::settings::AppSettingsState;

/// The directory that currently holds all downloaded images: the user's
/// `custom_images_dir` setting if one has been migrated to, otherwise the
/// default `{app_data_dir}/images`.
pub fn images_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let state = app.state::<AppSettingsState>();
    let custom = state.0.read().map_err(|e| e.to_string())?.custom_images_dir.clone();
    match custom {
        Some(p) => Ok(std::path::PathBuf::from(p)),
        None => Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("images")),
    }
}

/// Resolves an `assets.local_path` value (e.g. `images/{creator_id}/high_res/{file}`)
/// to a full filesystem path under the current images directory. The `images/`
/// prefix is stripped before joining, since `images_dir()` already points at the
/// images root itself (whether that's the default location or a custom one).
pub fn asset_full_path(app: &AppHandle, local_path: &str) -> Result<std::path::PathBuf, String> {
    let rel = local_path.strip_prefix("images/").unwrap_or(local_path);
    Ok(images_dir(app)?.join(rel))
}

#[derive(serde::Serialize)]
pub struct FileMetadata {
    pub size: u64,
    pub checksum: Option<String>,
}

#[tauri::command]
pub fn resolve_app_data_dir(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn resolve_images_dir(app: AppHandle) -> Result<String, String> {
    Ok(images_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_asset_dir(app: AppHandle, creator_id: String, post_id: String) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let asset_dir = app_data_dir.join("assets").join(creator_id).join(post_id);

    fs::create_dir_all(&asset_dir).map_err(|e| e.to_string())?;

    Ok(asset_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_file_checksum(file_path: String) -> Result<String, String> {
    let mut file = fs::File::open(file_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 1024];

    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

#[tauri::command]
pub fn read_file_metadata(file_path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;

    Ok(FileMetadata {
        size: metadata.len(),
        checksum: None,
    })
}

#[tauri::command]
pub fn copy_imported_file(source_path: String, dest_path: String) -> Result<FileMetadata, String> {
    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    let metadata = fs::metadata(&dest_path).map_err(|e| e.to_string())?;
    let checksum = get_file_checksum(dest_path).ok();

    Ok(FileMetadata {
        size: metadata.len(),
        checksum,
    })
}

/// Copy a downloaded asset to the user's Downloads folder.
/// Returns the destination path on success.
#[tauri::command]
pub fn save_asset_to_downloads(app: AppHandle, local_path: String) -> Result<String, String> {
    super::image_migration::check_not_migrating(&app)?;
    let src = asset_full_path(&app, &local_path)?;

    let file_name = src.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image.jpg")
        .to_string();

    let downloads_dir = app.path().download_dir()
        .map_err(|e| e.to_string())?;

    // Avoid overwriting an existing file with the same name
    let mut dest = downloads_dir.join(&file_name);
    if dest.exists() {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        for i in 1..=999 {
            dest = downloads_dir.join(format!("{}_{}.{}", stem, i, ext));
            if !dest.exists() { break; }
        }
        if dest.exists() {
            return Err(format!("Downloads folder already contains 999+ copies of {}", file_name));
        }
    }

    fs::copy(&src, &dest).map_err(|e| format!("Failed to copy to Downloads: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_creator_data(app: AppHandle, creator_id: String) -> Result<(), String> {
    super::image_migration::check_not_migrating(&app)?;
    // Delete all scraped posts (assets and post_tags cascade via FK ON DELETE CASCADE).
    // Also clear the sync checkpoint so the UI resets to a clean "Sync" button
    // rather than showing a stale "继续 N/..." from the previous session.
    // The creators row is intentionally kept so the creator stays in the sidebar
    // and can be re-synced without re-adding.
    let conn = open_db(&app)?;
    conn.execute(
        "DELETE FROM posts WHERE creator_id = ?1",
        rusqlite::params![creator_id],
    ).map_err(|e| format!("DB error: {}", e))?;
    conn.execute(
        "DELETE FROM sync_checkpoints WHERE creator_id = ?1",
        rusqlite::params![creator_id],
    ).map_err(|e| format!("DB error clearing checkpoint: {}", e))?;

    // Remove the images directory for this creator if it exists.
    // File-delete failure is non-fatal: DB is already clean, so the app won't
    // reference these files again. Orphaned files only waste disk space.
    let creator_images_dir = images_dir(&app)?.join(&creator_id);
    if creator_images_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&creator_images_dir) {
            eprintln!("WARN: Could not remove image dir for creator {}: {}", creator_id, e);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_creator(app: AppHandle, creator_id: String) -> Result<(), String> {
    super::image_migration::check_not_migrating(&app)?;
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM posts WHERE creator_id = ?1",
        rusqlite::params![creator_id],
    ).map_err(|e| format!("DB error deleting posts: {}", e))?;
    tx.execute(
        "DELETE FROM sync_checkpoints WHERE creator_id = ?1",
        rusqlite::params![creator_id],
    ).map_err(|e| format!("DB error deleting checkpoint: {}", e))?;
    tx.execute(
        "DELETE FROM creators WHERE id = ?1",
        rusqlite::params![creator_id],
    ).map_err(|e| format!("DB error deleting creator: {}", e))?;
    tx.commit().map_err(|e| e.to_string())?;

    let creator_images_dir = images_dir(&app)?.join(&creator_id);
    if creator_images_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&creator_images_dir) {
            eprintln!("WARN: Could not remove image dir for creator {}: {}", creator_id, e);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_asset_in_system(app: AppHandle, local_path: String) -> Result<(), String> {
    super::image_migration::check_not_migrating(&app)?;
    let full_path = asset_full_path(&app, &local_path)?;
    tauri_plugin_opener::open_path(
        full_path.to_str().unwrap_or(""),
        None::<&str>,
    )
    .map_err(|e| format!("Failed to open file: {}", e))
}

/// Copies the bundled DisplayMode/ stock photos onto disk under
/// images_dir()/__demo__/{creator_id}/high_res/{filename}, so Demo Mode's
/// fictional assets (see src/lib/demoData.ts) resolve through the exact
/// same image-URL-resolution path real assets use. Idempotent: skips any
/// file that's already present, safe to call every time Demo Mode is
/// switched on.
#[tauri::command]
pub fn ensure_demo_assets_on_disk(app: AppHandle) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let images_root = images_dir(&app)?;

    // (bundled filename, demo creator id) — must match the same mapping
    // used for each asset's local_path in src/lib/demoData.ts.
    let files: [(&str, &str); 8] = [
        ("ltapsah-mountain-wolf-7229583.jpg", "__demo_creator_1__"),
        ("pexels-dropshado-30662151.jpg", "__demo_creator_1__"),
        ("pexels-robert-schwarz-1488822070-31839964.jpg", "__demo_creator_1__"),
        ("pexels-sonneblom-10528689.jpg", "__demo_creator_1__"),
        ("pexels-alex-ning-523843601-33650553.jpg", "__demo_creator_2__"),
        ("pexels-glen-mc-call-1137859051-30447248.jpg", "__demo_creator_2__"),
        ("pexels-sefa-demirtas-2152709769-32366529.jpg", "__demo_creator_2__"),
        ("pexels-zenith-3341173-14854864.jpg", "__demo_creator_2__"),
    ];

    for (filename, creator_id) in files {
        let src = resource_dir.join("DisplayMode").join(filename);
        let dest_dir = images_root.join("__demo__").join(creator_id).join("high_res");
        std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        let dest = dest_dir.join(filename);
        if !dest.exists() {
            // Copy to a temp file in the same directory, then rename atomically —
            // so an interrupted copy (disk full, killed mid-write) never leaves a
            // truncated file at `dest` that a later idempotent call would mistake
            // for "already copied" and permanently skip.
            let tmp_dest = dest_dir.join(format!("{}.tmp", filename));
            std::fs::copy(&src, &tmp_dest)
                .map_err(|e| format!("Failed to copy demo asset {}: {}", filename, e))?;
            std::fs::rename(&tmp_dest, &dest)
                .map_err(|e| format!("Failed to finalize demo asset {}: {}", filename, e))?;
        }
    }

    Ok(())
}
