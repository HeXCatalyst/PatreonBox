import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

/**
 * Turning a stored asset into something the webview can load takes two pieces of
 * knowledge that are easy to get subtly wrong, so they live here rather than in
 * each view that renders media:
 *
 *  - `assets.local_path` is stored with an `images/` prefix, but it's relative to
 *    the images directory, which *is* that root. The prefix has to come off
 *    before joining, or every path gains a phantom `images/images/` segment.
 *  - A re-downloaded file keeps its path (e.g. a de-blurred full-res replacement
 *    overwriting a preview), so WebKit's disk cache will happily serve the old
 *    bytes. The download timestamp is appended as a cache-buster.
 */

let imagesDirPromise: Promise<string> | null = null;
const subscribers = new Set<(dir: string) => void>();

/**
 * The active images directory, resolved once and shared. Every media view used
 * to `invoke("resolve_images_dir")` on its own mount, so opening the Workbench
 * in media mode fired the same IPC call several times over for one value.
 */
export function getImagesDir(): Promise<string> {
  if (!imagesDirPromise) {
    imagesDirPromise = invoke<string>("resolve_images_dir").catch(err => {
      // Don't cache a rejection: a transient failure would otherwise wedge every
      // later caller on the same dead promise for the rest of the session.
      imagesDirPromise = null;
      throw err;
    });
  }
  return imagesDirPromise;
}

/**
 * Drop the cached directory and push the new one to everything on screen.
 *
 * This is not optional bookkeeping: `migrate_images_dir` relocates the whole
 * image store at runtime, so without this the cache would keep handing out the
 * pre-migration path and every thumbnail would break until the app restarted.
 * (Before the cache existed each view re-resolved on mount, which hid the
 * problem by accident.)
 */
export function invalidateImagesDir(): void {
  imagesDirPromise = null;
  getImagesDir()
    .then(dir => subscribers.forEach(fn => fn(dir)))
    .catch(console.error);
}

/**
 * The images directory, or `""` until it resolves. Components should treat `""`
 * as "not known yet" and render a placeholder rather than an empty `src` —
 * `<img src="">` re-requests the current page.
 */
export function useImagesDir(): string {
  const [dir, setDir] = useState("");
  useEffect(() => {
    let cancelled = false;
    const apply = (d: string) => { if (!cancelled) setDir(d); };
    getImagesDir().then(apply).catch(console.error);
    subscribers.add(apply);
    return () => { cancelled = true; subscribers.delete(apply); };
  }, []);
  return dir;
}

/** The subset of an asset row needed to build its URL. */
export interface AssetUrlParts {
  local_path: string;
  downloaded_at?: string | null;
}

/**
 * Build the webview URL for a downloaded asset, or `null` if `imagesDir` isn't
 * known yet. Returning null rather than an empty string is deliberate: it makes
 * the "not ready" case impossible to pass to `src=` by accident.
 */
export function assetUrl(imagesDir: string, asset: AssetUrlParts): string | null {
  if (!imagesDir) return null;
  return buildAssetUrl(imagesDir, asset.local_path, asset.downloaded_at);
}

/** Path-and-version form, for callers that don't have a whole asset row. */
export function buildAssetUrl(
  imagesDir: string,
  localPath: string,
  version?: string | null,
): string {
  const base = convertFileSrc(`${imagesDir}/${localPath.replace(/^images\//, "")}`);
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}
