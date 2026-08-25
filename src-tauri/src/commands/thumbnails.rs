use std::path::PathBuf;

/// 派生 asset 的缩略图路径。非图像 asset 返回 None（本约定只覆盖图像；
/// 视频用 <video> poster，音频无缩略图）。
///
/// 约定（见 spec D3）：`images/{creator}/high_res/{file}` →
/// `images/{creator}/thumb/{stem}.webp`，{stem} 是原文件名去掉扩展名。
/// 缩略图位于与 high_res/ 同级的 thumb/ 子目录，确保两者一起迁移、一起删除。
pub fn thumb_path(images_dir: &std::path::Path, local_path: &str) -> Option<PathBuf> {
    // local_path 形如 "images/{creator}/high_res/{file}.{ext}"
    let rel = local_path.strip_prefix("images/")?;
    let mut parts: Vec<&str> = rel.split('/').collect();
    if parts.len() < 3 { return None; }
    // parts = [creator, "high_res", file]
    if parts[1] != "high_res" { return None; }
    let file = parts[2];
    let stem = file.rsplit_once('.').map(|(s, _)| s)?;
    let ext = file.rsplit_once('.').map(|(_, e)| e)?;
    if !is_image_ext(ext) { return None; }
    parts[1] = "thumb";
    let thumb_name = format!("{}.webp", stem);
    parts[2] = &thumb_name;
    // 去掉 "images/" 前缀后拼到 images_dir
    let thumb_rel = parts.join("/");
    Some(images_dir.join(thumb_rel))
}

/// 缩略图系统处理的图像扩展名判断。需与 `mediaKindOf`（src/lib/media.ts）
/// 的 IMAGE_RE 和 `derive_media_type`（src-tauri/src/commands/scraping.rs）保持同步。
pub fn is_image_filename(file_name: &str) -> bool {
    file_name.rsplit_once('.').map(|(_, e)| is_image_ext(e)).unwrap_or(false)
}

fn is_image_ext(ext: &str) -> bool {
    matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp")
}

use image::imageops::FilterType;
use image::GenericImageView;

/// 缩略图边长。单级（见 spec D2）：覆盖 80–400 CSS px 网格 cell 区间；
/// 更大的原图在 lightbox（走 high_res 路径）里更清晰。
const THUMB_SIZE: u32 = 512;

/// 解码 `src`，居中裁切为正方形，resize 到 512×512，编码 WebP q80，写入 `dst`。
/// 自动创建父目录。错误返回（不 panic），调用方可记日志后继续——缩略图失败
/// 永不阻塞下载或网格（前端回退到原图）。
pub fn generate_thumb(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("decode {}: {}", src.display(), e))?;
    let (w, h) = img.dimensions();
    // 居中裁切到较小边（正方形 cover，对应 aspectRatio:1 + object-cover 的网格 cell）
    let side = w.min(h);
    let x = (w - side) / 2;
    let y = (h - side) / 2;
    let cropped = img.crop_imm(x, y, side, side);
    let resized = cropped.resize_exact(THUMB_SIZE, THUMB_SIZE, FilterType::Lanczos3);
    // 创建 thumb/ 目录，首次为新建的 creator 目录创建
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    // 先写临时文件再 rename，避免编码中途崩溃留下半截 .webp 被懒加载误当真缩略图
    let tmp_dst = dst.with_extension("webp.tmp");
    // 用 webp crate 做有损 q80 编码。`image` 自带的 WebP 编码器仅支持无损
    // （image-webp encoder.rs:12），无法满足 spec D1 的有损 q80 存储预期。
    let bytes = webp::Encoder::from_image(&resized)
        .map_err(|e| format!("encode {}: {}", tmp_dst.display(), e))?
        .encode(80.0);
    std::fs::write(&tmp_dst, &*bytes)
        .map_err(|e| format!("encode {}: {}", tmp_dst.display(), e))?;
    // 若 rename 失败，清理 .webp.tmp 半成品，避免遗留被懒加载误当真缩略图。
    if let Err(e) = std::fs::rename(&tmp_dst, dst) {
        let _ = std::fs::remove_file(&tmp_dst);
        return Err(format!("rename: {}", e));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_path_png() {
        let dir = PathBuf::from("/imgs");
        let got = thumb_path(&dir, "images/abc/high_res/sample_001.png");
        assert_eq!(got, Some(PathBuf::from("/imgs/abc/thumb/sample_001.webp")));
    }

    #[test]
    fn thumb_path_jpeg() {
        let dir = PathBuf::from("/imgs");
        let got = thumb_path(&dir, "images/abc/high_res/pic.JPEG");
        assert_eq!(got, Some(PathBuf::from("/imgs/abc/thumb/pic.webp")));
    }

    #[test]
    fn thumb_path_webp_source() {
        // .webp 原图是合法图像源；缩略图同样是 .webp
        let dir = PathBuf::from("/imgs");
        let got = thumb_path(&dir, "images/abc/high_res/foo.webp");
        assert_eq!(got, Some(PathBuf::from("/imgs/abc/thumb/foo.webp")));
    }

    #[test]
    fn thumb_path_strips_images_prefix() {
        // 镜像 asset_full_path：去掉 "images/" 前缀，images_dir 是根
        let dir = PathBuf::from("/imgs");
        let got = thumb_path(&dir, "images/abc/high_res/x.png").unwrap();
        assert!(got.starts_with("/imgs/abc/thumb/"));
        assert!(!got.starts_with("/imgs/images/")); // 不会出现 images/images/
    }

    #[test]
    fn thumb_path_rejects_non_image() {
        let dir = PathBuf::from("/imgs");
        assert_eq!(thumb_path(&dir, "images/abc/high_res/clip.mp4"), None);
        assert_eq!(thumb_path(&dir, "images/abc/high_res/song.mp3"), None);
        assert_eq!(thumb_path(&dir, "images/abc/high_res/noext"), None);
    }

    #[test]
    fn thumb_path_rejects_wrong_layout() {
        let dir = PathBuf::from("/imgs");
        // 不在 high_res/ 下
        assert_eq!(thumb_path(&dir, "images/abc/low_res/x.png"), None);
        // 缺 creator 段
        assert_eq!(thumb_path(&dir, "images/high_res/x.png"), None);
        // 无 images/ 前缀
        assert_eq!(thumb_path(&dir, "abc/high_res/x.png"), None);
    }

    #[test]
    fn is_image_filename_cases() {
        assert!(is_image_filename("a.png"));
        assert!(is_image_filename("A.PNG"));
        assert!(is_image_filename("foo.bar.JPEG"));
        assert!(!is_image_filename("foo.mp4"));
        assert!(!is_image_filename("noext"));
    }

    use std::io::Write;
    use image::{ImageBuffer, Rgba, GenericImageView};

    fn make_test_png(path: &std::path::Path, w: u32, h: u32) {
        // 纯红 255,0,0,255 图像，指定尺寸
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |_, _| Rgba([255, 0, 0, 255]));
        img.save(path).unwrap();
    }

    #[test]
    fn generate_thumb_creates_512_webp() {
        let tmp = std::env::temp_dir().join(format!("thumb_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        let src = tmp.join("orig.png");
        let dst = tmp.join("thumb").join("orig.webp"); // thumb/ 子目录还不存在
        make_test_png(&src, 1000, 800);
        assert!(!dst.exists());

        generate_thumb(&src, &dst).expect("生成应成功");

        assert!(dst.exists(), "缩略图文件应被创建");
        // 重新解码验证是合法的 512x512 图像
        let decoded = image::open(&dst).expect("缩略图应是合法图像");
        assert_eq!(decoded.dimensions(), (512, 512));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn generate_thumb_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!("thumb_idem_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        let src = tmp.join("orig.png");
        let dst = tmp.join("out.webp");
        make_test_png(&src, 600, 400);

        generate_thumb(&src, &dst).unwrap();
        let size1 = std::fs::metadata(&dst).unwrap().len();
        generate_thumb(&src, &dst).unwrap(); // 覆盖
        let size2 = std::fs::metadata(&dst).unwrap().len();
        assert_eq!(size1, size2, "第二次调用产出相同字节");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn generate_thumb_center_crops_non_square() {
        // 800x200 源 → 200x200 居中裁切 → 放大到 512x512。验证输出是正方形 512 且为合法 webp
        let tmp = std::env::temp_dir().join(format!("thumb_crop_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        let src = tmp.join("wide.png");
        let dst = tmp.join("out.webp");
        make_test_png(&src, 800, 200);

        generate_thumb(&src, &dst).unwrap();
        let decoded = image::open(&dst).unwrap();
        assert_eq!(decoded.dimensions(), (512, 512));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn generate_thumb_corrupt_source_returns_err() {
        let tmp = std::env::temp_dir().join(format!("thumb_bad_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        let src = tmp.join("bad.png");
        let dst = tmp.join("out.webp");
        let mut f = std::fs::File::create(&src).unwrap();
        f.write_all(b"not a png").unwrap();

        let res = generate_thumb(&src, &dst);
        assert!(res.is_err(), "损坏源必须返回错误，不能 panic");
        assert!(!dst.exists(), "失败时无半成品输出");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

use tauri::{AppHandle, Emitter};
use super::file_ops::images_dir;

/// 返回缩略图的 local_path 风格字符串（即带 `images/` 前缀，与 DB 存原图一致），
/// 文件不存在时生成。非图像 asset 返回 `Ok(None)`——前端据此跳到原图。
///
/// 幂等：缩略图已存在则不做任何工作。生成失败返回 Err，前端回退原图，
/// 而非在缺失文件上空转。
#[tauri::command]
pub fn ensure_thumbnail(app: AppHandle, local_path: String) -> Result<Option<String>, String> {
    super::image_migration::check_not_migrating(&app)?;
    // 非图像 asset 直接拒绝：视频/音频无缩略图
    let file_name = local_path.rsplit('/').next().unwrap_or("");
    if !is_image_filename(file_name) {
        return Ok(None);
    }
    let images_root = images_dir(&app)?;
    let thumb = thumb_path(&images_root, &local_path)
        .ok_or_else(|| format!("无法派生缩略图路径: {}", local_path))?;
    if !thumb.exists() {
        // 从同一 local_path 派生原图路径
        let rel = local_path.strip_prefix("images/").unwrap_or(&local_path);
        let src = images_root.join(rel);
        if !src.exists() {
            return Err(format!("原图未找到: {}", src.display()));
        }
        generate_thumb(&src, &thumb)?;
    }
    // 返回 local_path 风格字符串，前端可直接喂给 buildAssetUrl
    // 重建：images/{creator}/thumb/{stem}.webp
    let rel = thumb.strip_prefix(&images_root)
        .map_err(|e| format!("缩略图不在 images_dir 下: {}", e))?;
    Ok(Some(format!("images/{}", rel.to_string_lossy())))
}

use super::util::open_db;

/// 遍历每个已下载的图像 asset，缺失则生成缩略图。跑在后台线程（沿用
/// image_migration 的 spawn 模式）；发送 `thumbnail-backfill-progress` 事件，
///     带字段 `{done, total, failed}`。可重跑——已存在的缩略图跳过。失败计数并发送，
/// 永不中止运行（单个损坏文件不应阻塞整个库的回填）。
#[tauri::command]
pub fn backfill_thumbnails(app: AppHandle) -> Result<(), String> {
    super::image_migration::check_not_migrating(&app)?;
    let app2 = app.clone();
    std::thread::spawn(move || {
        let conn = match open_db(&app2) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("ERROR: backfill_thumbnails open_db: {}", e);
                let _ = app2.emit("thumbnail-backfill-progress", serde_json::json!({ "done": 0, "total": 0, "failed": 0, "finished": true, "error": e }));
                return;
            }
        };
        // 先收集任务：在数千行上做文件 IO 时持有 DB 连接会阻塞其他读请求
        let rows: Vec<(String, String)> = match conn.prepare(
            "SELECT id, local_path FROM assets
             WHERE downloaded_at IS NOT NULL AND media_type = 'image'"
        ) {
            Ok(mut stmt) => stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .ok()
                .map(|iter| iter.filter_map(|x| x.ok()).collect())
                .unwrap_or_default(),
            Err(e) => {
                eprintln!("ERROR: backfill_thumbnails query: {}", e);
                let _ = app2.emit("thumbnail-backfill-progress", serde_json::json!({ "done": 0, "total": 0, "failed": 0, "finished": true, "error": e.to_string() }));
                return;
            }
        };
        drop(conn);

        let total = rows.len();
        let images_root = match images_dir(&app2) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("ERROR: backfill_thumbnails images_dir: {}", e);
                return;
            }
        };
        let mut done = 0usize;
        let mut failed = 0usize;
        for (id, local_path) in &rows {
            if let Some(thumb) = thumb_path(&images_root, local_path) {
                if thumb.exists() { done += 1; continue; }
                let rel = local_path.strip_prefix("images/").unwrap_or(local_path.as_str());
                let src = images_root.join(rel);
                if src.exists() {
                    if let Err(e) = generate_thumb(&src, &thumb) {
                        eprintln!("WARN: 回填缩略图 asset {}: {}", id, e);
                        failed += 1;
                    }
                }
                // 原图缺失（DB 孤儿行）——跳过，不计为失败
            }
            done += 1;
            if done % 25 == 0 {
                let _ = app2.emit("thumbnail-backfill-progress", serde_json::json!({ "done": done, "total": total, "failed": failed }));
            }
        }
        let _ = app2.emit("thumbnail-backfill-progress", serde_json::json!({ "done": done, "total": total, "failed": failed, "finished": true }));
    });
    Ok(())
}
