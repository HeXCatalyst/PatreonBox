import { invoke } from "@tauri-apps/api/core";
import { Asset } from "../../types/db";
import { Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Info, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../../lib/i18n";
import { assetUrl, useImagesDir } from "../../lib/assetUrl";
import { isVideoFile } from "../../lib/media";

interface ImageLightboxProps {
  images: Asset[];       // downloaded image assets for the current post
  initialIndex: number;  // index of the image that was clicked
  onClose: () => void;
  onSaveSuccess?: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose, onSaveSuccess }: ImageLightboxProps) {
  const t = useTranslation();
  const imagesDir = useImagesDir();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showProps, setShowProps] = useState(false);
  // WKWebView disables the HTML5 element-fullscreen API (that's why the native
  // video controls show PiP but no fullscreen button), so drive the Tauri window
  // into fullscreen ourselves and let the video fill the viewport.
  const [videoFull, setVideoFull] = useState(false);
  const videoFullRef = useRef(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  // The wheel handler is bound to window once, so it reads the live zoom/pan off
  // refs rather than closing over stale state.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  const current = images[currentIndex];
  const hasMultiple = images.length > 1;
  const isVideo = isVideoFile(current?.file_name ?? "");
  const sizeLabel = current?.byte_size
    ? current.byte_size < 1024 * 1024
      ? `${Math.round(current.byte_size / 1024)} KB`
      : `${(current.byte_size / (1024 * 1024)).toFixed(1)} MB`
    : null;

  // Reset zoom/pan/size when navigating images
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNaturalSize(null);
    setIsDragging(false);
  }, [currentIndex]);

  const setWindowFullscreen = async (on: boolean) => {
    setVideoFull(on);
    videoFullRef.current = on;
    try { await getCurrentWindow().setFullscreen(on); } catch { /* not fatal */ }
  };

  // Never leave the window stuck in fullscreen when the lightbox unmounts.
  useEffect(() => () => {
    if (videoFullRef.current) getCurrentWindow().setFullscreen(false).catch(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (videoFullRef.current) { void setWindowFullscreen(false); } else { onClose(); } return; }
      if (e.key === "ArrowLeft") setCurrentIndex(i => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setCurrentIndex(i => (i + 1) % images.length);
      if (e.key === "+" || e.key === "=") setZoom(z => Math.min(4, Math.round(z * 1.25 * 100) / 100));
      if (e.key === "-") setZoom(z => Math.max(0.25, Math.round(z / 1.25 * 100) / 100));
      if (e.key === "0") { setZoom(1); setPan({ x: 0, y: 0 }); }
      if (e.key === "i" || e.key === "I") setShowProps(p => !p);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, images.length]);

  // Mouse wheel to zoom, anchored on the cursor: the point under the pointer
  // stays put as the image scales, instead of everything zooming toward the
  // image's centre.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const img = imgRef.current;
      const oldZoom = zoomRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = Math.min(4, Math.max(0.25, Math.round(oldZoom * factor * 100) / 100));
      if (newZoom === oldZoom) return; // clamped — nothing to do

      // Keep the content point under the cursor fixed. transformOrigin is the
      // image centre, so a scale by s = newZoom/oldZoom grows the box about its
      // centre; translating by (0.5 − f)·size·(s − 1) puts the cursor's point
      // back where it was. f is the cursor's position within the image box,
      // clamped so zooming while hovering the dark margin anchors to the nearest
      // edge rather than flinging the image away.
      if (img) {
        const rect = img.getBoundingClientRect();
        const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        const s = newZoom / oldZoom;
        const prev = panRef.current;
        setPan({
          x: prev.x + (0.5 - fx) * rect.width * (s - 1),
          y: prev.y + (0.5 - fy) * rect.height * (s - 1),
        });
      }
      setZoom(newZoom);
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);

  // Flag this modal so parent global key handlers (e.g. the Workbench's ← →
  // post-flip) stand down while the lightbox owns the arrow keys — otherwise the
  // post changes underneath, the image set swaps, and the index goes out of range.
  useEffect(() => {
    document.body.setAttribute("data-lightbox-open", "1");
    return () => document.body.removeAttribute("data-lightbox-open");
  }, []);

  // Belt-and-suspenders: if the underlying image set ever shrinks, keep the index
  // in range so `current` never becomes undefined.
  useEffect(() => {
    if (images.length > 0 && currentIndex > images.length - 1) setCurrentIndex(images.length - 1);
  }, [images.length, currentIndex]);

  const getUrl = (asset: Asset) => assetUrl(imagesDir, asset) ?? undefined;

  const handleOverlayMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.stopPropagation();
    setPan({
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    });
  };

  const handleOverlayMouseUp = () => {
    if (isDragging) setIsDragging(false);
  };

  const handleImageMouseDown = (e: React.MouseEvent) => {
    // Panning is allowed at any zoom level — the restore button resets position.
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onMouseMove={handleOverlayMouseMove}
      onMouseUp={handleOverlayMouseUp}
      onMouseLeave={handleOverlayMouseUp}
    >
      {/* Top bar: counter (left) + zoom controls + info + close (right) */}
      <div
        className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 z-10"
        onClick={e => e.stopPropagation()}
      >
        {hasMultiple ? (
          <span className="text-xs text-white/70 font-mono bg-black/40 rounded px-2 py-1">
            {currentIndex + 1} / {images.length}
          </span>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1">
          {isVideo ? (
            /* Video: element-fullscreen is unavailable in this webview, so this
               toggles the app window into fullscreen and fills it. */
            <button
              className="bg-black/40 hover:bg-black/60 rounded-full w-7 h-7 flex items-center justify-center text-white/70 hover:text-white transition-colors"
              title={videoFull ? t.lightbox.exitFullscreen : t.lightbox.fullscreen}
              onClick={() => void setWindowFullscreen(!videoFull)}
            >
              {videoFull ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          ) : (
          <>
          {/* Zoom Out */}
          <button
            className="bg-black/40 hover:bg-black/60 rounded-full w-7 h-7 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title={t.lightbox.zoomOut}
            onClick={() => setZoom(z => Math.max(0.25, Math.round(z / 1.25 * 100) / 100))}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>

          {/* Zoom % — click to reset */}
          <button
            className="min-w-[3.5rem] h-7 px-2 bg-black/40 hover:bg-black/60 rounded text-xs text-white/70 hover:text-white font-mono transition-colors"
            title={t.lightbox.resetZoom}
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          >
            {Math.round(zoom * 100)}%
          </button>

          {/* Zoom In */}
          <button
            className="bg-black/40 hover:bg-black/60 rounded-full w-7 h-7 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title={t.lightbox.zoomIn}
            onClick={() => setZoom(z => Math.min(4, Math.round(z * 1.25 * 100) / 100))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>

          {/* Restore — only shown when zoom or pan has changed */}
          {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
            <button
              className="bg-black/40 hover:bg-black/60 rounded-full w-7 h-7 flex items-center justify-center text-white/70 hover:text-white transition-colors"
              title={t.lightbox.restoreZoom}
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}

          </>
          )}

          <div className="w-px h-4 bg-white/20 mx-1" />

          {/* Properties toggle */}
          <button
            className={`rounded-full w-7 h-7 flex items-center justify-center transition-colors ${
              showProps ? "bg-black/60 text-white" : "bg-black/40 hover:bg-black/60 text-white/70 hover:text-white"
            }`}
            title={t.lightbox.properties}
            onClick={() => setShowProps(p => !p)}
          >
            <Info className="h-3.5 w-3.5" />
          </button>

          {/* Close */}
          <button
            className="bg-red-500/90 hover:bg-red-500 rounded-full w-8 h-8 flex items-center justify-center text-white transition-colors ml-1 shadow-lg"
            title={t.lightbox.close}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Properties panel */}
      {showProps && (
        <div
          className="absolute top-14 right-4 z-10 bg-black/75 rounded-lg p-3 text-xs font-mono text-white/60 space-y-1"
          style={{ minWidth: "12rem", maxWidth: "20rem" }}
          onClick={e => e.stopPropagation()}
        >
          <div className="text-white/80 font-medium break-all">{current.file_name}</div>
          {naturalSize && <div>{naturalSize.w} × {naturalSize.h} px</div>}
          {sizeLabel && <div>{sizeLabel}</div>}
          {current.mime_type && <div>{current.mime_type}</div>}
          {current.published_at && (
            <div>{t.lightbox.publishedAt(new Date(current.published_at).toLocaleString())}</div>
          )}
          {current.downloaded_at && (
            <div>{t.lightbox.downloadedAt(new Date(current.downloaded_at).toLocaleString())}</div>
          )}
        </div>
      )}

      {/* Prev arrow */}
      {hasMultiple && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          onClick={e => { e.stopPropagation(); setCurrentIndex(i => (i - 1 + images.length) % images.length); }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Video plays inline with native controls (no zoom/pan). */}
      {isVideo ? (
      <video
        key={currentIndex}
        src={getUrl(current)}
        controls
        autoPlay
        playsInline
        className={videoFull ? "w-screen h-screen bg-black" : "max-w-[90vw] max-h-[85vh] rounded shadow-2xl bg-black"}
        onClick={e => e.stopPropagation()}
        onDoubleClick={() => void setWindowFullscreen(!videoFull)}
      />
      ) : (
      /* Image — pan with drag when zoomed in */
      <img
        key={currentIndex}
        ref={imgRef}
        src={getUrl(current)}
        alt={current.file_name}
        className="max-w-[90vw] max-h-[85vh] object-contain rounded shadow-2xl select-none"
        draggable={false}
        style={{
          // Only apply a transform when actually zoomed/panned. An always-on transform
          // forces the image onto its own compositing layer, which makes large animated
          // GIFs repaint the whole layer every frame and stutter. Omitting it in the
          // default view lets GIFs animate on the normal paint path.
          transform: (zoom !== 1 || pan.x !== 0 || pan.y !== 0)
            ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
            : undefined,
          transformOrigin: "center center",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        onLoad={e => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onMouseDown={handleImageMouseDown}
        onClick={e => e.stopPropagation()}
      />
      )}

      {/* Next arrow */}
      {hasMultiple && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          onClick={e => { e.stopPropagation(); setCurrentIndex(i => (i + 1) % images.length); }}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Bottom bar: filename + size (left) + download button (right) */}
      <div
        className="absolute bottom-0 inset-x-0 flex items-center justify-between px-4 py-3 z-10"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-xs text-white/70 font-mono truncate bg-black/40 rounded px-2 py-1">
          {current.file_name}{sizeLabel ? ` · ${sizeLabel}` : ""}
        </span>
        <button
          className="ml-4 flex-shrink-0 bg-black/40 hover:bg-black/60 rounded px-3 py-1.5 text-xs text-white/70 hover:text-white transition-colors flex items-center gap-1.5"
          onClick={async () => {
            await invoke("save_asset_to_downloads", { localPath: current.local_path });
            onSaveSuccess?.();
          }}
        >
          <Download className="h-3 w-3" />
          {t.lightbox.saveToDownloads}
        </button>
      </div>
    </div>
  );
}
