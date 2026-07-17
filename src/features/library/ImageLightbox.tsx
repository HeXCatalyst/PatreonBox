import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Asset } from "../../types/db";
import { Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Info, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";

interface ImageLightboxProps {
  images: Asset[];       // downloaded image assets for the current post
  initialIndex: number;  // index of the image that was clicked
  imagesDir: string;    // used to build the local file URL
  onClose: () => void;
  onSaveSuccess?: () => void;
}

export function ImageLightbox({ images, initialIndex, imagesDir, onClose, onSaveSuccess }: ImageLightboxProps) {
  const t = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  const current = images[currentIndex];
  const hasMultiple = images.length > 1;
  const sizeLabel = current.byte_size
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
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

  // Mouse wheel to zoom
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(z => Math.min(4, Math.max(0.25, Math.round(z * factor * 100) / 100)));
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);

  const getUrl = (asset: Asset) => {
    const base = convertFileSrc(`${imagesDir}/${asset.local_path.replace(/^images\//, "")}`);
    // Cache-bust by download time so a re-downloaded file (e.g. a de-blurred
    // full-res replacement at the same path) isn't served from WebKit's cache.
    return asset.downloaded_at ? `${base}?v=${encodeURIComponent(asset.downloaded_at)}` : base;
  };

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

      {/* Image — pan with drag when zoomed in */}
      <img
        key={currentIndex}
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
