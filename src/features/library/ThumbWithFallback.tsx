import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { assetUrl, type AssetUrlParts } from "../../lib/assetUrl";

/**
 * An `<img>` that loads the small square thumbnail first, and only falls back
 * to the full-res original if the thumbnail is missing or corrupt.
 *
 * Ported from MediaView's `ThumbImg` pattern: on the first load error, it asks
 * the backend to generate the missing thumbnail (`ensure_thumbnail`), then
 * retries the thumb URL with a cache-buster. On a second failure it falls back
 * to the high-res original — so the grid never shows a broken image.
 *
 * Used by FavoritesView (square grid) and the Workbench filmstrip (square
 * cells), where the square-cropped 512px WebP thumbnail is the right shape.
 * NOT used by ImageGallery, whose justified layout needs true aspect ratios
 * the square thumbs can't provide.
 */
export function ThumbWithFallback({
  imagesDir,
  asset,
  alt,
  className,
  onClick,
}: {
  imagesDir: string;
  asset: AssetUrlParts;
  alt: string;
  className?: string;
  onClick?: () => void;
}) {
  const thumbSrc = assetUrl(imagesDir, asset, "thumb");
  const fallbackSrc = assetUrl(imagesDir, asset) ?? undefined;
  const [currentSrc, setCurrentSrc] = useState<string | null>(thumbSrc);
  const retriedRef = useRef(false);

  const handleError = useCallback(async () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      try {
        await invoke("ensure_thumbnail", { localPath: asset.local_path });
        const sep = thumbSrc?.includes("?") ? "&" : "?";
        setCurrentSrc(`${thumbSrc}${sep}v=${Date.now()}`);
      } catch {
        setCurrentSrc(fallbackSrc ?? null);
      }
    } else if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
    }
  }, [thumbSrc, fallbackSrc, currentSrc, asset.local_path]);

  return (
    <img
      src={currentSrc ?? undefined}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={handleError}
      onClick={onClick}
    />
  );
}
