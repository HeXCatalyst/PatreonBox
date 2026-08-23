import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, Download, ArrowDownWideNarrow, ArrowUpWideNarrow, FileText, CheckSquare, Trash2, X, Check, CalendarClock, Star, Play, Music } from "lucide-react";
import { Asset } from "../../types/db";
import { getCreatorMedia, toggleFavoriteAsset } from "../../lib/db";
import { mediaKindOf, isImageFile, ALL_MEDIA_KINDS, type MediaKind } from "../../lib/media";
import { getDemoPosts, getDemoAssets } from "../../lib/demoData";
import { ImageLightbox } from "./ImageLightbox";
import { MediaTimeScrubber } from "./MediaTimeScrubber";
import { useTranslation } from "../../lib/i18n";
import { assetUrl, useImagesDir } from "../../lib/assetUrl";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const SIZE_KEY = "patreonbox-media-size";
const DEFAULT_SIZE = 140;
const GAP = 4;      // grid gap in px
const PAD = 12;     // grid padding in px
const OVERSCAN = 6; // extra rows rendered above/below the viewport (preloads while scrolling)
const FAST_SCROLL_PX = 70; // per-frame scroll jump above which we defer image decode
// Idle prefetch: while the main thread is idle (not flinging), pull thumb URLs
// just beyond the OVERSCAN window into WebKit's memory cache via a detached
// `new Image()`. On HDD the ~12ms seek per file is the jank source; doing this
// work in idle windows overlaps the seek with the user viewing current rows, so
// the next scroll into that region hits memory instead of disk. Deduped + skipped
// during fling (fastScroll===true → no idle, and would contend for the head).
const PREFETCH_ROWS = 8;
const PREFETCH_MAX_PER_FRAME = 4; // bound per idle tick so we reschedule & stay responsive

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
      .filter(a => a.downloaded_at !== null && isImageFile(a.file_name))
      .map(a => ({ ...a, published_at: p.published_at })));
}

/** 网格 cell 图像，带懒生成缩略图。缩略图加载失败时，调用 ensure_thumbnail
 *  （缺失则生成文件）然后重试一次。二次失败回退到 high-res 原图，确保网格
 *  永不显示破图。 */
function ThumbImg({
  src, fallbackSrc, localPath, alt, isSelected, loadedRef, assetId, onLoaded, onOpen,
}: {
  src: string;
  fallbackSrc?: string;
  localPath: string;
  alt: string;
  isSelected: boolean;
  loadedRef: MutableRefObject<Set<string>>;
  assetId: string;
  onLoaded: () => void;
  onOpen: () => void;
}) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const retriedRef = useRef(false);

  const handleError = async () => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      try {
        // 缺失则生成；忽略返回值（文件现已有或仍无）
        await invoke("ensure_thumbnail", { localPath });
        // 加 cache-buster 破 webview 缓存，重试失败 URL
        setCurrentSrc(`${src}${src.includes("?") ? "&" : "?"}v=${Date.now()}`);
      } catch {
        // 生成失败——回退原图
        if (fallbackSrc) setCurrentSrc(fallbackSrc);
      }
    } else if (fallbackSrc && currentSrc !== fallbackSrc) {
      // 二次失败（重试的缩略图也 404）——用原图
      setCurrentSrc(fallbackSrc);
    }
  };

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`w-full h-full object-cover rounded cursor-pointer ${isSelected ? "opacity-70" : ""}`}
      decoding="async"
      draggable={false}
      onLoad={() => { loadedRef.current.add(assetId); onLoaded(); }}
      onError={handleError}
      onClick={onOpen}
    />
  );
}

export function MediaView({ creatorId, creatorName, order, onOrderChange, onShowPosts, demoMode, embedded, controlsSlot }: MediaViewProps) {
  const t = useTranslation();
  const imagesDir = useImagesDir();
  const [media, setMedia] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [wheelOpen, setWheelOpen] = useState(false);
  // Which media kinds to show — 'all' or a single kind.
  const [kindFilter, setKindFilter] = useState<'all' | MediaKind>('all');
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

  // Idle prefetch bookkeeping. scrollDirRef is +1 / -1, updated in the scroll
  // handler (cheap; no extra state). prefetchedRef dedupes so each URL is
  // fetched at most once per creator/order session.
  const scrollDirRef = useRef<1 | -1>(1);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const idleHandleRef = useRef<number | null>(null);

  // Top-of-grid thumbnail load progress bar. Driven purely by ref + rAF-batched
  // DOM mutation — no setState — so a hundred simultaneous decodes don't
  // re-render this heavy grid component. `imageCellIds` lists the image assets
  // currently in the visible window (excludes video/audio cells); `barRef` is
  // the fill div whose width we mutate.
  const barRef = useRef<HTMLDivElement | null>(null);
  const pendingProgressRafRef = useRef<number | null>(null);
  const imageCellIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const kinds: MediaKind[] = kindFilter === 'all' ? ALL_MEDIA_KINDS : [kindFilter];
        const items = demoMode ? loadDemoMedia(creatorId, order) : await getCreatorMedia(creatorId, order, kinds);
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
  }, [creatorId, order, demoMode, reloadKey, kindFilter]);

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
    prefetchedRef.current.clear();
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
      const prev = lastScrollTopRef.current;
      const delta = Math.abs(st - prev);
      if (st !== prev) scrollDirRef.current = st > prev ? 1 : -1;
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
    if (pendingProgressRafRef.current != null) cancelAnimationFrame(pendingProgressRafRef.current);
  }, []);

  const getUrl = useCallback((asset: Asset) => assetUrl(imagesDir, asset, "thumb"), [imagesDir]);

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

  // --- Thumbnail load progress bar. Tracks only the image cells currently in
  // the visible window (video/audio cells don't go through ThumbImg). The set
  // is recomputed each render from `visible`; markProgress() — called by each
  // ThumbImg onLoad — coalesces into a single rAF that mutates the bar width
  // directly. No setState, so a burst of decodes doesn't re-render this grid.
  const imageCellIds = visible.filter(a => mediaKindOf(a.file_name) === "image").map(a => a.id);
  imageCellIdsRef.current = new Set(imageCellIds);

  const markProgress = useCallback(() => {
    if (pendingProgressRafRef.current != null) return; // already queued
    pendingProgressRafRef.current = requestAnimationFrame(() => {
      pendingProgressRafRef.current = null;
      const bar = barRef.current;
      if (!bar) return;
      const total = imageCellIdsRef.current.size;
      let loaded = 0;
      const set = loadedRef.current;
      imageCellIdsRef.current.forEach(id => { if (set.has(id)) loaded++; });
      const pct = total === 0 ? 0 : (loaded / total) * 100;
      bar.style.width = `${pct}%`;
      bar.style.opacity = loaded >= total ? "0" : "1";
    });
  }, []);

  // Refresh the progress bar whenever the visible window changes (scroll,
  // resize, size slider, creator switch). onLoad fires handle per-image, but
  // scrolling to a fresh region recomputes imageCellIds without any new onLoad
  // firing for already-cached images — this effect covers that gap.
  useEffect(() => { markProgress(); }, [imageCellIds, markProgress]);

  // --- Idle prefetch: schedule on any geometry / fling-state change. The
  // callback runs while idle, fetches a bounded batch of thumb URLs beyond the
  // OVERSCAN window (in the scroll direction) via detached `new Image()`, then
  // reschedules itself if idle time remains. Deduped by URL; no-op if flinging
  // (no idle, and would contend for the HDD head).
  useEffect(() => {
    if (media.length === 0 || rowH <= 0 || cols <= 0) return;
    if (fastScroll) return; // don't contend with active fling
    if (!imagesDir) return; // getUrl returns null until dir resolves

    let cancelled = false;
    const scheduleIdle: () => void = () => {
      if (cancelled) return;
      const run = (deadline: IdleDeadline) => {
        idleHandleRef.current = null;
        if (cancelled || fastRef.current) return; // unmounted or fling started — bail
        let budget = PREFETCH_MAX_PER_FRAME;
        const dir = scrollDirRef.current;
        // Prefetch beyond the OVERSCAN window in the scroll direction. Forward
        // (dir=+1) is the common case; reverse still works symmetrically.
        const baseRow = dir === 1 ? endRow : startRow;
        for (let r = 1; r <= PREFETCH_ROWS && budget > 0; r++) {
          const row = dir === 1 ? baseRow + r : baseRow - r;
          if (row < 0 || row >= totalRows) break;
          const rowStart = row * cols;
          const rowEnd = Math.min(media.length, rowStart + cols);
          for (let i = rowStart; i < rowEnd && budget > 0; i++) {
            const asset = media[i];
            if (!asset) continue;
            const url = getUrl(asset);
            if (!url) continue;
            if (prefetchedRef.current.has(url)) continue;
            prefetchedRef.current.add(url);
            budget--;
            const img = new Image();
            img.src = url; // fetch into WebKit memory cache; not attached to DOM
          }
        }
        // Nothing prefetched this tick → all candidates already in cache; stop.
        if (budget === PREFETCH_MAX_PER_FRAME) return;
        // Still idle and not flinging → chain another idle tick to continue.
        if (deadline.timeRemaining() > 0 && !fastRef.current && !cancelled) {
          scheduleIdle();
        }
      };
      // requestIdleCallback with a 500ms timeout so a quiet scroll still warms
      // the cache reasonably soon; falls back to setTimeout on older webviews.
      if (typeof window.requestIdleCallback === "function") {
        idleHandleRef.current = window.requestIdleCallback(run, { timeout: 500 });
      } else {
        idleHandleRef.current = window.setTimeout(() => run({
          didTimeout: false,
          timeRemaining: () => 5,
        }) as unknown as void, 50) as unknown as number;
      }
    };
    scheduleIdle();
    return () => {
      cancelled = true;
      if (idleHandleRef.current != null) {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(idleHandleRef.current as number);
        } else {
          window.clearTimeout(idleHandleRef.current);
        }
        idleHandleRef.current = null;
      }
    };
  }, [media, cols, rowH, totalRows, startRow, endRow, fastScroll, imagesDir, getUrl]);

  // The media-specific controls. Rendered in this view's own header normally;
  // when embedded (Workbench), they're portaled into the shared top bar instead
  // so both Posts and Media modes share one row of chrome.
  const rightControls = selectMode ? (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-xs text-muted-foreground tabular-nums">{t.mediaView.selectedCount(selected.size)}</span>
      <ToolbarButton
        onClick={() => setConfirmOpen(true)}
        disabled={selected.size === 0}
        tone="danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t.mediaView.deleteSelected}
      </ToolbarButton>
      <ToolbarButton onClick={exitSelect}>
        <X className="h-3.5 w-3.5" />
        {t.mediaView.cancel}
      </ToolbarButton>
    </div>
  ) : (
    <div className="flex items-center gap-3 flex-shrink-0">
      <div className="h-7 flex items-center border rounded text-xs overflow-hidden flex-shrink-0">
        {(['all', 'image', 'video', 'audio'] as const).map(k => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className={`px-2.5 h-full transition-colors ${kindFilter === k ? "bg-secondary text-secondary-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"}`}
          >
            {t.mediaView.kindName(k)}
          </button>
        ))}
      </div>
      <ToolbarButton onClick={() => setWheelOpen(true)} title={t.mediaView.jumpToMonth}>
        <CalendarClock className="h-3.5 w-3.5" />
        {t.mediaView.jumpToMonth}
      </ToolbarButton>
      <ToolbarButton onClick={() => setSelectMode(true)}>
        <CheckSquare className="h-3.5 w-3.5" />
        {t.mediaView.select}
      </ToolbarButton>
      <ToolbarButton
        onClick={() => onOrderChange(order === "desc" ? "asc" : "desc")}
        title={order === "desc" ? t.mediaView.newestFirst : t.mediaView.oldestFirst}
      >
        {order === "desc"
          ? <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          : <ArrowUpWideNarrow className="h-3.5 w-3.5" />}
        {order === "desc" ? t.mediaView.newestFirst : t.mediaView.oldestFirst}
      </ToolbarButton>
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

      {/* Thumbnail load progress: thin bar under the header. Three states:
          - loading (DB query): indeterminate — a 1/3-width segment slides
            left→right (reuses the existing sync-indeterminate keyframe).
          - fastScroll (fling): same indeterminate slide — images are deferred
            to placeholders during fling so loadedRef doesn't grow; a determinate
            bar would sit at 0% (invisible). The sliding segment signals "loading".
          - otherwise: determinate bar, width/opacity via ref, fills as images
            onLoad, fades out at 100%.
          Using translateX (not opacity pulse) for indeterminate so it never
          visually conflicts with the determinate bar's width growth on switch. */}
      {(loading || media.length > 0) && (
        <div className="h-0.5 w-full bg-muted/30 overflow-hidden">
          {loading || fastScroll ? (
            <div
              className="h-full w-1/3 bg-primary"
              style={{ animation: "sync-indeterminate 1.1s ease-in-out infinite" }}
            />
          ) : (
            <div
              ref={barRef}
              className="h-full bg-primary transition-[width,opacity] duration-150 ease-out"
              style={{ width: "0%", opacity: 1 }}
            />
          )}
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
                    {(() => {
                      const url = getUrl(asset);
                      // The images dir resolves a tick after first paint. Render
                      // the same placeholder the fling path uses rather than an
                      // empty src, which the webview would resolve against the
                      // page URL and request in a loop across every visible cell.
                      if (url === null) return <div className="w-full h-full rounded bg-muted/40" />;
                      const kind = mediaKindOf(asset.file_name);
                      if (kind === "video") {
                        // Poster frame via <video preload="metadata"> (first frame),
                        // with a play badge; click opens the lightbox player.
                        return (
                          <div className={`relative w-full h-full rounded overflow-hidden cursor-pointer bg-black ${isSelected ? "opacity-70" : ""}`}
                            onClick={() => { if (!selectMode) setLightboxIndex(realIdx); }}>
                            <video
                              src={`${url}#t=0.1`}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover pointer-events-none"
                            />
                            <div className="absolute inset-0 grid place-items-center pointer-events-none">
                              <span className="h-9 w-9 rounded-full bg-black/55 border border-white/25 grid place-items-center">
                                <Play className="h-4 w-4 text-white fill-white" />
                              </span>
                            </div>
                          </div>
                        );
                      }
                      if (kind === "audio") {
                        return (
                          <div className={`relative w-full h-full rounded overflow-hidden cursor-pointer bg-muted/40 grid place-items-center ${isSelected ? "opacity-70" : ""}`}
                            onClick={() => { if (!selectMode) setLightboxIndex(realIdx); }}>
                            <Music className="h-8 w-8 text-muted-foreground" />
                            <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
                              <div className="text-[10px] text-white truncate">{asset.file_name}</div>
                            </div>
                          </div>
                        );
                      }
                      return fastScroll && !loadedRef.current.has(asset.id) ? (
                        // Only defer images that haven't decoded yet — already-loaded
                        // ones stay shown so they never flicker during a fling.
                        <div className="w-full h-full rounded bg-muted/40" />
                      ) : (
                        <ThumbImg
                          src={url}
                          fallbackSrc={assetUrl(imagesDir, asset, "high") ?? undefined}
                          localPath={asset.local_path}
                          alt={asset.file_name}
                          isSelected={isSelected}
                          loadedRef={loadedRef}
                          assetId={asset.id}
                          onLoaded={markProgress}
                          onOpen={() => { if (!selectMode) setLightboxIndex(realIdx); }}
                        />
                      );
                    })()}
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
