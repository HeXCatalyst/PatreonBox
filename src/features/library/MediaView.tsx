import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, Download, ArrowDownWideNarrow, ArrowUpWideNarrow, FileText, CheckSquare, Trash2, X, Check, CalendarClock, Star } from "lucide-react";
import { Asset } from "../../types/db";
import { getCreatorMedia, toggleFavoriteAsset } from "../../lib/db";
import { getDemoPosts, getDemoAssets } from "../../lib/demoData";
import { ImageLightbox } from "./ImageLightbox";
import { MediaTimeScrubber } from "./MediaTimeScrubber";
import { useTranslation } from "../../lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;
const SIZE_KEY = "patreonbox-media-size";
const DEFAULT_SIZE = 140;
const GAP = 4;      // grid gap in px
const PAD = 12;     // grid padding in px
const OVERSCAN = 6; // extra rows rendered above/below the viewport (preloads while scrolling)
const FAST_SCROLL_PX = 70; // per-frame scroll jump above which we defer image decode

type Order = "desc" | "asc";

interface MediaViewProps {
  creatorId: string;
  creatorName: string;
  order: Order;
  onOrderChange: (order: Order) => void;
  onShowPosts: () => void;
  demoMode: boolean;
  /** Workbench embeds this view under a shared top bar: hide our own header and
   *  portal the media-specific controls into the slot the parent provides. */
  embedded?: boolean;
  controlsSlot?: HTMLElement | null;
}

/** Aggregate a demo creator's downloaded images across all posts, date-ordered. */
function loadDemoMedia(creatorId: string, order: Order): Asset[] {
  const posts = [...getDemoPosts(creatorId)].sort((a, b) => {
    const cmp = (a.published_at ?? "").localeCompare(b.published_at ?? "");
    return order === "asc" ? cmp : -cmp;
  });
  return posts
    .flatMap(p => getDemoAssets(p.id)
      .filter(a => a.downloaded_at !== null && IMAGE_RE.test(a.file_name))
      .map(a => ({ ...a, published_at: p.published_at })));
}

export function MediaView({ creatorId, creatorName, order, onOrderChange, onShowPosts, demoMode, embedded, controlsSlot }: MediaViewProps) {
  const t = useTranslation();
  const [media, setMedia] = useState<Asset[]>([]);
  const [imagesDir, setImagesDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [size, setSize] = useState<number>(() => {
    const stored = localStorage.getItem(SIZE_KEY);
    return stored ? parseInt(stored, 10) : DEFAULT_SIZE;
  });

  // --- Virtualization state: only rows near the viewport are mounted, so DOM
  // node count and decoded-image memory stay bounded no matter how far you scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [contentW, setContentW] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number | null>(null);
  // Fast-fling handling: while flinging, only cells whose image hasn't decoded
  // yet render a cheap placeholder (first-time full-res decode is the jank).
  // Already-decoded images stay put — they never flicker, and re-mounting a
  // cached image is cheap.
  const [fastScroll, setFastScroll] = useState(false);
  const lastScrollTopRef = useRef(0);
  const fastRef = useRef(false);
  const fastTimerRef = useRef<number | null>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    invoke<string>("resolve_images_dir").then(setImagesDir).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const items = demoMode ? loadDemoMedia(creatorId, order) : await getCreatorMedia(creatorId, order);
        if (!cancelled) setMedia(items);
      } catch (e) {
        console.error("Failed to load creator media", e);
        if (!cancelled) setMedia([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [creatorId, order, demoMode, reloadKey]);

  // Drag-to-select: press on a cell and drag across others to paint a selection.
  // The first cell decides the mode (add vs remove); subsequent cells follow it.
  const paintRef = useRef<{ active: boolean; mode: "add" | "remove" }>({ active: false, mode: "add" });

  const applyPaint = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (paintRef.current.mode === "add") next.add(id); else next.delete(id);
      return next;
    });
  };

  const startPaint = (id: string) => {
    paintRef.current = { active: true, mode: selected.has(id) ? "remove" : "add" };
    applyPaint(id);
  };

  useEffect(() => {
    const up = () => { paintRef.current.active = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); paintRef.current.active = false; };

  // Favourite a single image. Optimistic: flip locally, revert if the write fails.
  const toggleFavorite = async (asset: Asset) => {
    if (demoMode) return;
    const next = asset.favorited_at ? null : new Date().toISOString();
    setMedia(prev => prev.map(m => (m.id === asset.id ? { ...m, favorited_at: next } : m)));
    try {
      await toggleFavoriteAsset(asset.id, next);
    } catch (e) {
      console.error("favorite failed", e);
      setMedia(prev => prev.map(m => (m.id === asset.id ? { ...m, favorited_at: asset.favorited_at ?? null } : m)));
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await invoke("delete_downloaded_assets", { assetIds: ids });
    } catch (e) {
      console.error("delete failed", e);
    }
    setConfirmOpen(false);
    exitSelect();
    setReloadKey(k => k + 1); // deleted images are no longer downloaded → drop from the wall
  };

  // Reset scroll to top when the underlying media changes (new creator / re-sort).
  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    loadedRef.current.clear();
  }, [creatorId, order]);

  // Track the scroll container's size (responsive columns + viewport height).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setContentW(el.clientWidth - PAD * 2);
      setViewportH(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rafRef.current != null) return; // throttle to one update per frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const st = el.scrollTop;
      const delta = Math.abs(st - lastScrollTopRef.current);
      lastScrollTopRef.current = st;
      setScrollTop(st);
      // A large per-frame jump = a fast fling → defer image decode until it eases.
      if (delta > FAST_SCROLL_PX) {
        if (!fastRef.current) { fastRef.current = true; setFastScroll(true); }
        if (fastTimerRef.current != null) window.clearTimeout(fastTimerRef.current);
        fastTimerRef.current = window.setTimeout(() => {
          fastRef.current = false;
          setFastScroll(false);
        }, 70);
      }
    });
  }, []);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    if (fastTimerRef.current != null) window.clearTimeout(fastTimerRef.current);
  }, []);

  const getUrl = useCallback((asset: Asset) => {
    if (!imagesDir) return "";
    const base = convertFileSrc(`${imagesDir}/${asset.local_path.replace(/^images\//, "")}`);
    // Cache-bust by download time so a re-downloaded file (e.g. a de-blurred
    // full-res replacement at the same path) isn't served from WebKit's cache.
    return asset.downloaded_at ? `${base}?v=${encodeURIComponent(asset.downloaded_at)}` : base;
  }, [imagesDir]);

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSize(val);
    localStorage.setItem(SIZE_KEY, String(val));
  };

  // --- Derived grid geometry (matches the old `auto-fill, minmax(size, 1fr)` column count).
  const cols = contentW > 0 ? Math.max(1, Math.floor((contentW + GAP) / (size + GAP))) : 1;
  const cellW = cols > 0 ? (contentW - GAP * (cols - 1)) / cols : size;
  const rowH = cellW + GAP;
  const totalRows = Math.ceil(media.length / cols);
  const totalHeight = totalRows > 0 ? totalRows * rowH - GAP + PAD * 2 : 0;

  const firstRow = rowH > 0 ? Math.floor(scrollTop / rowH) : 0;
  const lastRow = rowH > 0 ? Math.ceil((scrollTop + viewportH) / rowH) : 0;
  const startRow = Math.max(0, firstRow - OVERSCAN);
  const endRow = Math.min(totalRows, lastRow + OVERSCAN);
  const startIdx = startRow * cols;
  const endIdx = Math.min(media.length, endRow * cols);
  const visible = media.slice(startIdx, endIdx);
  const offsetY = PAD + startRow * rowH;

  // The media-specific controls. Rendered in this view's own header normally;
  // when embedded (Workbench), they're portaled into the shared top bar instead
  // so both Posts and Media modes share one row of chrome.
  const rightControls = selectMode ? (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-xs text-muted-foreground tabular-nums">{t.mediaView.selectedCount(selected.size)}</span>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={selected.size === 0}
        className="h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs text-destructive border-destructive/50 hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t.mediaView.deleteSelected}
      </button>
      <button
        onClick={exitSelect}
        className="h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        {t.mediaView.cancel}
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-3 flex-shrink-0">
      <button
        onClick={() => setWheelOpen(true)}
        className="h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        title={t.mediaView.jumpToMonth}
      >
        <CalendarClock className="h-3.5 w-3.5" />
        {t.mediaView.jumpToMonth}
      </button>
      <button
        onClick={() => setSelectMode(true)}
        className="h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <CheckSquare className="h-3.5 w-3.5" />
        {t.mediaView.select}
      </button>
      <button
        onClick={() => onOrderChange(order === "desc" ? "asc" : "desc")}
        className="h-7 px-2.5 flex items-center gap-1.5 border rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        title={order === "desc" ? t.mediaView.newestFirst : t.mediaView.oldestFirst}
      >
        {order === "desc"
          ? <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          : <ArrowUpWideNarrow className="h-3.5 w-3.5" />}
        {order === "desc" ? t.mediaView.newestFirst : t.mediaView.oldestFirst}
      </button>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t.imageGallery.small}</span>
        <input
          type="range" min="80" max="400" step="8"
          value={size}
          onChange={handleSizeChange}
          className="w-20 h-1 accent-primary cursor-pointer"
        />
        <span className="text-xs text-muted-foreground">{t.imageGallery.large}</span>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      {embedded
        ? (controlsSlot ? createPortal(rightControls, controlsSlot) : null)
        : (
      /* Header: tab toggle + count (left), sort + size (right) */
      <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-7 flex items-center border rounded text-xs bg-background overflow-hidden flex-shrink-0">
            <button
              onClick={onShowPosts}
              className="px-3 h-full flex items-center gap-1 text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              {t.mediaView.postsTab}
            </button>
            <button
              className="px-3 h-full flex items-center gap-1 bg-secondary text-secondary-foreground font-medium"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {t.mediaView.mediaTab}
            </button>
          </div>
          <h2 className="font-semibold truncate min-w-0">{creatorName}</h2>
          {!loading && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {t.mediaView.count(media.length)}
            </span>
          )}
        </div>

        {rightControls}
      </div>
        )}

      {/* Grid — virtualized: only rows near the viewport are in the DOM.
          Wrapped in a relative box so the time scrubber can overlay the strip. */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="media-scroll absolute inset-0 overflow-y-auto" onScroll={handleScroll}>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t.mediaView.loading}</div>
        ) : media.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t.mediaView.empty}</div>
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: offsetY,
                left: PAD,
                right: PAD,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: `${GAP}px`,
              }}
            >
              {visible.map((asset, i) => {
                const realIdx = startIdx + i;
                const isSelected = selected.has(asset.id);
                return (
                  <div
                    key={asset.id}
                    className={`relative group bg-muted/20 rounded ${isSelected ? "ring-2 ring-primary" : ""} ${selectMode ? "select-none" : ""}`}
                    style={{ aspectRatio: "1" }}
                    onMouseDown={selectMode ? (e) => { e.preventDefault(); startPaint(asset.id); } : undefined}
                    onMouseEnter={selectMode ? () => { if (paintRef.current.active) applyPaint(asset.id); } : undefined}
                  >
                    {fastScroll && !loadedRef.current.has(asset.id) ? (
                      // Only defer images that haven't decoded yet — already-loaded
                      // ones stay shown so they never flicker during a fling.
                      <div className="w-full h-full rounded bg-muted/40" />
                    ) : (
                      <img
                        src={getUrl(asset)}
                        alt={asset.file_name}
                        className={`w-full h-full object-cover rounded cursor-pointer ${isSelected ? "opacity-70" : ""}`}
                        decoding="async"
                        draggable={false}
                        onLoad={() => loadedRef.current.add(asset.id)}
                        onClick={() => { if (!selectMode) setLightboxIndex(realIdx); }}
                      />
                    )}
                    {selectMode ? (
                      <div
                        className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center pointer-events-none ${isSelected ? "bg-primary text-primary-foreground" : "bg-black/40 border border-white/60"}`}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5" />}
                      </div>
                    ) : (
                      <>
                      <button
                        className={`absolute top-1.5 right-1.5 rounded-full p-1 transition-opacity bg-black/50 hover:bg-black/70 ${asset.favorited_at ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                        title={asset.favorited_at ? t.mediaView.unfavorite : t.mediaView.favorite}
                        onClick={e => { e.stopPropagation(); void toggleFavorite(asset); }}
                      >
                        <Star className={`h-3 w-3 ${asset.favorited_at ? "fill-star text-star" : "text-white"}`} />
                      </button>
                      <button
                        className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-black/70 rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t.imageGallery.saveToDownloads}
                        onClick={e => { e.stopPropagation(); invoke("save_asset_to_downloads", { localPath: asset.local_path }).catch(console.error); }}
                      >
                        <Download className="h-3 w-3 text-white" />
                      </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
        {!loading && media.length > 0 && (
          <MediaTimeScrubber
            media={media}
            scrollRef={scrollRef}
            scrollTop={scrollTop}
            rowH={rowH}
            cols={cols}
            canScrub={totalHeight > viewportH + 40}
            wheelOpen={wheelOpen}
            onCloseWheel={() => setWheelOpen(false)}
          />
        )}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={media}
          initialIndex={lightboxIndex}
          imagesDir={imagesDir}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.mediaView.deleteConfirmTitle(selected.size)}</DialogTitle>
            <DialogDescription>{t.mediaView.deleteConfirmDesc}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={handleDeleteSelected}>{t.mediaView.deleteSelected}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
