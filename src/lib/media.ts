/**
 * How the app decides what an asset *is*.
 *
 * Classification is by filename extension, not by the mimetype Patreon reports:
 * that mimetype is unreliable upstream (an .mp4 attachment has been seen served
 * as image/jpeg), and trusting it files videos under images.
 *
 * ⚠️ These lists must stay in sync with `derive_media_type` in
 * src-tauri/src/commands/scraping.rs. The two run at different times over the
 * same files — Rust decides `assets.media_type` at scrape time, this decides
 * what actually gets rendered — and when they disagree the failure is silent:
 * `.avi` was once listed only on the Rust side, so those assets were stored as
 * media_type='video' and then never appeared in the media wall or its filter.
 */

const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac)$/i;

export type MediaKind = 'image' | 'video' | 'audio';

/** Every kind the media wall knows how to render. */
export const ALL_MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio'];

/** Classify an asset by filename extension. `null` = not renderable media. */
export function mediaKindOf(fileName: string): MediaKind | null {
  if (IMAGE_RE.test(fileName)) return 'image';
  if (VIDEO_RE.test(fileName)) return 'video';
  if (AUDIO_RE.test(fileName)) return 'audio';
  return null;
}

export const isImageFile = (fileName: string) => mediaKindOf(fileName) === 'image';
export const isVideoFile = (fileName: string) => mediaKindOf(fileName) === 'video';

/**
 * Classify with the reported mimetype as a fallback, for the post reader's
 * attachment buckets. The extension still wins; the mimetype only gets a say
 * when the extension is unrecognised, which is how an audio file with an
 * unusual extension still lands under "audio" rather than "other files".
 */
export function mediaKindOfAsset(asset: { file_name: string; mime_type?: string | null }): MediaKind | null {
  const byName = mediaKindOf(asset.file_name);
  if (byName) return byName;
  const mime = asset.mime_type ?? '';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return null;
}
