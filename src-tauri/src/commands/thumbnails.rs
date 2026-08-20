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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_path_png() {
        let dir = PathBuf::from("/imgs");
        let got = thumb_path(&dir, "images/abc/high_res/578472802_1.png");
        assert_eq!(got, Some(PathBuf::from("/imgs/abc/thumb/578472802_1.webp")));
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
}
