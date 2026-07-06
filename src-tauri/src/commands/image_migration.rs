use tauri::{AppHandle, Manager};
use std::sync::atomic::{AtomicBool, Ordering};

/// Process-wide flag: true while an image-directory migration is running.
/// Every command that touches files under the images directory must check
/// this via `check_not_migrating` before doing any I/O.
pub struct ImageMigrationLock(pub AtomicBool);

pub fn check_not_migrating(app: &AppHandle) -> Result<(), String> {
    let lock = app.state::<ImageMigrationLock>();
    if lock.0.load(Ordering::SeqCst) {
        return Err("Image migration is in progress".to_string());
    }
    Ok(())
}

/// Holds the migration lock for as long as it's alive, and releases it when
/// dropped — on every exit path (success, early return, or panic unwind) —
/// so a bug in the migration logic below can never leave the app permanently
/// locked. The only way to construct one is `acquire`, which performs the
/// compare-and-swap itself, so "lock claimed" and "guard exists" can never
/// drift apart even if a future edit inserts fallible code around it.
pub struct MigrationLockGuard<'a> {
    lock: &'a AtomicBool,
}

impl<'a> MigrationLockGuard<'a> {
    pub fn acquire(lock: &'a AtomicBool) -> Result<Self, String> {
        lock.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Image migration already in progress".to_string())?;
        Ok(Self { lock })
    }
}

impl<'a> Drop for MigrationLockGuard<'a> {
    fn drop(&mut self) {
        self.lock.store(false, Ordering::SeqCst);
    }
}

use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};
use std::io::{Read, Write};
use tauri::Emitter;

fn dir_total_size(path: &Path) -> u64 {
    if !path.exists() { return 0; }
    std::fs::read_dir(path).ok()
        .map(|entries| entries.filter_map(|e| e.ok())
            .map(|e| {
                let p = e.path();
                if p.is_dir() { dir_total_size(&p) } else { std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0) }
            }).sum())
        .unwrap_or(0)
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Streams `src` to `dst`, feeding every chunk into a SHA-256 hasher as it
/// goes. Returns the source file's digest. Exactly one read of `src`.
fn copy_and_hash(src: &Path, dst: &Path) -> Result<String, String> {
    let mut src_file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut dst_file = std::fs::File::create(dst).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = src_file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
        dst_file.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Recursively lists every regular file under `root`, as paths relative to `root`.
fn list_files_recursive(root: &Path) -> Result<Vec<PathBuf>, String> {
    fn walk(base: &Path, current: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in std::fs::read_dir(current).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out)?;
            } else {
                out.push(path.strip_prefix(base).map_err(|e| e.to_string())?.to_path_buf());
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    if root.exists() {
        walk(root, root, &mut out)?;
    }
    Ok(out)
}

/// Best-effort canonicalization for a path that may not exist yet: canonicalize
/// as much of the path as actually exists on disk, then re-append the
/// non-existent tail components unchanged. Used to detect nesting between
/// `source` (which always exists) and `target` (which may not, if the user
/// is about to have it created for them).
fn best_effort_canonicalize(path: &Path) -> PathBuf {
    if let Ok(c) = std::fs::canonicalize(path) {
        return c;
    }
    match path.parent() {
        Some(parent) if parent != path => {
            best_effort_canonicalize(parent).join(path.file_name().unwrap_or_default())
        }
        _ => path.to_path_buf(),
    }
}

/// Copies every file from the current images directory to `target_dir`,
/// verifies each one (size or hash, per settings.migration_verify_mode),
/// then deletes the originals only once every file has been verified.
/// On any failure: deletes whatever was already copied into `target_dir`,
/// leaves the source completely untouched, and returns an error.
#[tauri::command]
pub async fn migrate_images_dir(app: AppHandle, target_dir: Option<String>) -> Result<(), String> {
    let is_restore_to_default = target_dir.is_none();
    let target_dir = match target_dir {
        Some(t) => t,
        None => {
            let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            app_data_dir.join("images").to_string_lossy().to_string()
        }
    };
    let target = PathBuf::from(&target_dir);
    let source = super::file_ops::images_dir(&app)?;

    // --- Pre-checks: read-only, touch nothing on disk yet ---
    if !source.exists() {
        return Err("Cannot access the current images directory — if it's on an external drive, reconnect it and try again.".to_string());
    }

    if target.exists() {
        let has_entries = std::fs::read_dir(&target)
            .map_err(|e| format!("Cannot read target directory: {}", e))?
            .next().is_some();
        if has_entries {
            return Err("Target folder must be empty".to_string());
        }
    }

    // Reject a target that is nested inside the source, or that the source is
    // nested inside — either way, deleting the source at the end of a
    // successful migration would also delete (part of) the just-copied
    // target, or vice versa. Canonicalize both first since `target` may not
    // exist yet (symlinks / relative components could otherwise defeat a
    // plain string prefix check).
    let source_canon = best_effort_canonicalize(&source);
    let target_canon = best_effort_canonicalize(&target);
    if target_canon.starts_with(&source_canon) || source_canon.starts_with(&target_canon) {
        return Err("Target folder cannot be inside, or contain, the current images folder".to_string());
    }

    // --- Now safe to create the target directory if it doesn't exist yet ---
    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| format!("Cannot create target directory: {}", e))?;
    }

    let total_bytes = dir_total_size(&source);

    let available = fs4::available_space(&target)
        .map_err(|e| format!("Cannot check free disk space: {}", e))?;
    if available < total_bytes {
        return Err(format!(
            "Not enough free space at destination: need {} bytes, have {} bytes",
            total_bytes, available
        ));
    }

    // --- Acquire the lock; guaranteed to release on every exit path below ---
    let lock_state = app.state::<ImageMigrationLock>();
    let _guard = MigrationLockGuard::acquire(&lock_state.0)?;

    let verify_mode = {
        let settings_state = app.state::<super::settings::AppSettingsState>();
        let guard = settings_state.0.read().map_err(|e| e.to_string())?;
        guard.migration_verify_mode.clone()
    };

    let files = list_files_recursive(&source)?;
    let mut copied_bytes: u64 = 0;
    let phase = if verify_mode == "hash" { "verifying" } else { "copying" };

    for rel in &files {
        let src_path = source.join(rel);
        let dst_path = target.join(rel);

        // Every fallible per-file operation is routed through this closure so
        // that *any* error — mkdir, metadata read, copy, hash, or size/hash
        // mismatch — hits the single rollback branch below, instead of some
        // of them bypassing it via an early `?` return out of the whole
        // function (which would leave a half-copied, no-longer-empty
        // `target` on disk with nothing cleaned up).
        let file_result: Result<u64, String> = (|| {
            if let Some(parent) = dst_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let src_len = std::fs::metadata(&src_path).map_err(|e| e.to_string())?.len();

            if verify_mode == "hash" {
                let src_hash = copy_and_hash(&src_path, &dst_path)?;
                let dst_hash = hash_file(&dst_path)?;
                if dst_hash != src_hash {
                    return Err(format!("Hash mismatch after copying {}", rel.display()));
                }
            } else {
                let copied_len = std::fs::copy(&src_path, &dst_path)
                    .map_err(|e| format!("Failed to copy {}: {}", rel.display(), e))?;
                if copied_len != src_len {
                    return Err(format!("Size mismatch after copying {}", rel.display()));
                }
            }
            Ok(src_len)
        })();

        let src_len = match file_result {
            Ok(len) => len,
            Err(msg) => {
                let _ = std::fs::remove_dir_all(&target);
                return Err(msg);
            }
        };

        copied_bytes += src_len;
        let _ = app.emit("image-migration-progress", serde_json::json!({
            "current_bytes": copied_bytes,
            "total_bytes": total_bytes,
            "phase": phase
        }));
    }

    // --- Success: delete originals, persist the new setting ---
    if source.exists() {
        std::fs::remove_dir_all(&source)
            .map_err(|e| format!("Copy succeeded but failed to remove old files: {}", e))?;
    }

    {
        let settings_state = app.state::<super::settings::AppSettingsState>();
        let mut settings = settings_state.0.write().map_err(|e| e.to_string())?;
        settings.custom_images_dir = if is_restore_to_default { None } else { Some(target_dir.clone()) };
        let json = serde_json::to_string_pretty(&*settings).map_err(|e| e.to_string())?;
        let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("settings.json");
        std::fs::write(&path, json).map_err(|e| e.to_string())?;
    }

    let _ = app.emit("image-migration-progress", serde_json::json!({
        "current_bytes": total_bytes,
        "total_bytes": total_bytes,
        "phase": "done"
    }));

    Ok(())
}
