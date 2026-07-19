import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Maximize2, RefreshCw, ImageDown, FileText, Image as ImageIcon } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Creator, Post, Asset } from "../../types/db";
import { getCreatorMedia } from "../../lib/db";
import { ReadingView } from "../library/ReadingView";
import { MediaView } from "../library/MediaView";
import { Button } from "@/components/ui/button";
import { IconRail } from "./IconRail";
import { FilmstripDock } from "./FilmstripDock";
import { TimelineView } from "./TimelineView";
import type { DownloadStatus } from "../downloads/useDownloadJobs";
import { useTranslation } from "../../lib/i18n";

interface WorkbenchViewProps {
  creators: (Creator & { post_count: number })[];
  selectedCreatorId: string | null;
  onSelectCreator: (id: string) => void;
  posts: Post[];
  selectedPost: Post | null;
  selectedPostAssets: Asset[];
  onSelectPost: (post: Post) => void;
  onOpenPost: (creatorId: string, postId: string) => void;
  onToggleStar?: (post: Post, newStarred: boolean) => void;
  onOpenSearch: () => void;
  onOpenFavorites: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onSyncSubscriptions: () => void;
  syncingSubscriptions: boolean;
  downloadStatus: DownloadStatus;
  downloadActiveCount: number;
  settingsErrorCount: number;
  /* Sync + download for the current creator — the Workbench's equivalent of the
     classic post-list toolbar; they live in the dock header. */
  onSyncPosts: () => void;
  onSyncImages: () => Promise<void>;
  isSyncingPosts: boolean;
  isSyncingImages: boolean;
  syncProgress: number;
  syncTotal: number;
  imageProgress: number;
  imageTotal: number;
  /* Sync options, mirroring the classic toolbar: how many posts to fetch,
     new-only, and the sync mode. */
  maxPosts: number;
  onMaxPostsChange: (n: number) => void;
  incrementalSync: boolean;
  onIncrementalSyncChange: (v: boolean) => void;
  syncMode: 'normal' | 'full';
  onSyncModeChange: (m: 'normal' | 'full') => void;
  /* Media grid (shared with the classic layout) — sort order + demo flag. */
  mediaOrder: 'desc' | 'asc';
  onMediaOrderChange: (order: 'desc' | 'asc') => void;
  demoMode: boolean;
}

const IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

/**
 * The Workbench layout: a slim creator rail, a big reading canvas (the existing
 * ReadingView), and a bottom filmstrip of the current creator's posts. Selecting
 * a creator loads its posts (via the parent) and auto-opens the newest; ← → flip
 * through the dock.
 */
export function WorkbenchView({
  creators, selectedCreatorId, onSelectCreator,
  posts, selectedPost, selectedPostAssets, onSelectPost, onOpenPost, onToggleStar,
  onOpenSearch, onOpenFavorites, onOpenDownloads, onOpenSettings,
  onSyncSubscriptions, syncingSubscriptions,
  downloadStatus, downloadActiveCount, settingsErrorCount,
  onSyncPosts, onSyncImages, isSyncingPosts, isSyncingImages,
  syncProgress, syncTotal, imageProgress, imageTotal,
  maxPosts, onMaxPostsChange, incrementalSync, onIncrementalSyncChange,
  syncMode, onSyncModeChange,
  mediaOrder, onMediaOrderChange, demoMode,
}: WorkbenchViewProps) {
  const t = useTranslation();
  const [imagesDir, setImagesDir] = useState("");
  const [media, setMedia] = useState<Asset[]>([]);
  const [home, setHome] = useState<'workbench' | 'timeline'>('workbench');
  const [mode, setMode] = useState<'posts' | 'media'>('posts');
  const [zen, setZen] = useState(false);
  // Portal target in the shared top bar for Media mode's own controls.
  const [mediaSlot, setMediaSlot] = useState<HTMLDivElement | null>(null);
  // Typed freely, committed on blur/Enter — same contract as the classic toolbar.
  const [maxPostsInput, setMaxPostsInput] = useState(String(maxPosts));

  useEffect(() => { setMaxPostsInput(String(maxPosts)); }, [maxPosts]);

  const commitMaxPosts = () => {
    const val = parseInt(maxPostsInput);
    if (!isNaN(val) && val >= 1) onMaxPostsChange(val);
    else setMaxPostsInput(String(maxPosts));
  };

  // Selecting a creator (from the rail) always returns to the Workbench home,
  // on the Posts view.
  const selectCreator = (id: string) => { setHome('workbench'); setMode('posts'); onSelectCreator(id); };

  useEffect(() => {
    invoke<string>("resolve_images_dir").then(setImagesDir).catch(console.error);
  }, []);

  // Downloaded images for the current creator → first image per post = its thumb.
  useEffect(() => {
    if (!selectedCreatorId) { setMedia([]); return; }
    let cancelled = false;
    getCreatorMedia(selectedCreatorId, "desc")
      .then(m => { if (!cancelled) setMedia(m); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [selectedCreatorId]);

  const thumbByPost = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const a of media) {
      if (!a.post_id || map.has(a.post_id)) continue;
      if (a.local_path && IMAGE_RE.test(a.local_path)) map.set(a.post_id, a);
    }
    return map;
  }, [media]);

  const thumbFor = (post: Post): string | null => {
    const a = thumbByPost.get(post.id);
    if (!a || !imagesDir) return null;
    const base = convertFileSrc(`${imagesDir}/${a.local_path.replace(/^images\//, "")}`);
    return a.downloaded_at ? `${base}?v=${encodeURIComponent(a.downloaded_at)}` : base;
  };

  // Auto-open the newest post when a creator is selected but nothing's open yet
  // (e.g. right after switching creator). With no creator, the canvas stays on
  // its empty state rather than surfacing an arbitrary post.
  // The creator_id guard matters: right after a switch, `posts` still holds the
  // PREVIOUS creator's list until the async reload lands — auto-opening from the
  // stale list put the old creator's post on the canvas (always one switch behind).
  useEffect(() => {
    if (selectedCreatorId && !selectedPost && posts.length > 0 && posts[0].creator_id === selectedCreatorId) {
      onSelectPost(posts[0]);
    }
  }, [selectedCreatorId, posts, selectedPost, onSelectPost]);

  // Keyboard: Esc exits Zen, F toggles it, ← / → flip through the creator's posts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The image lightbox is a modal that owns the arrow keys — don't also flip
      // posts underneath it (that swaps the image set and crashes the lightbox).
      if (document.body.hasAttribute("data-lightbox-open")) return;
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape" && zen) { setZen(false); return; }
      if (e.key.toLowerCase() === "f" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && selectedPost) {
        e.preventDefault(); setZen(z => !z); return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (typing || posts.length === 0) return;
      const idx = selectedPost ? posts.findIndex(p => p.id === selectedPost.id) : -1;
      const next = e.key === "ArrowRight"
        ? Math.min(posts.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      if (next !== idx && posts[next]) { e.preventDefault(); onSelectPost(posts[next]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [posts, selectedPost, onSelectPost, zen]);

  const creatorName = creators.find(c => c.id === selectedCreatorId)?.name ?? "";

  // Zen: chrome falls away, the page centers. Esc or the Back chip returns;
  // ← → still flip through posts while reading.
  if (zen && selectedPost) {
    return (
      <div className="flex-1 h-full relative overflow-hidden bg-background">
        <button
          onClick={() => setZen(false)}
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-card/80 backdrop-blur-sm border rounded-full px-3 py-1.5"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t.workbench.zenExit}
        </button>
        <div className="h-full max-w-3xl mx-auto">
          <ReadingView post={selectedPost} assets={selectedPostAssets} onToggleStar={onToggleStar} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <div className="w-[60px] flex-shrink-0 h-full">
        <IconRail
          creators={creators}
          selectedCreatorId={home === 'timeline' ? null : selectedCreatorId}
          onSelectCreator={selectCreator}
          onOpenSearch={onOpenSearch}
          onOpenFavorites={onOpenFavorites}
          onOpenDownloads={onOpenDownloads}
          onOpenSettings={onOpenSettings}
          onOpenTimeline={() => setHome('timeline')}
          onSyncSubscriptions={onSyncSubscriptions}
          syncingSubscriptions={syncingSubscriptions}
          timelineActive={home === 'timeline'}
          downloadStatus={downloadStatus}
          downloadActiveCount={downloadActiveCount}
          settingsErrorCount={settingsErrorCount}
        />
      </div>

      {home === 'timeline' ? (
        <TimelineView onOpenInWorkbench={(post) => { setHome('workbench'); onOpenPost(post.creator_id, post.id); }} />
      ) : (
        <div className="flex-1 flex flex-col min-w-0 h-full">
          {/* Shared top bar — identical chrome in both Posts and Media modes, so
              the bottom strip can stay a pure filmstrip. Media-specific controls
              portal themselves into the slot below. */}
          {selectedCreatorId && (
            <div className="flex items-center gap-2.5 px-3 py-2 border-b flex-wrap flex-shrink-0">
              <div className="flex items-center border rounded overflow-hidden text-[11px] flex-shrink-0">
                <button
                  onClick={() => setMode('posts')}
                  title={t.mediaView.postsTab}
                  className={mode === 'posts'
                    ? "px-2.5 h-6 flex items-center gap-1 bg-secondary text-secondary-foreground font-medium"
                    : "px-2.5 h-6 flex items-center gap-1 text-muted-foreground hover:bg-muted/50 transition-colors"}
                >
                  <FileText className="h-3 w-3" />
                  {t.mediaView.postsTab}
                </button>
                <button
                  onClick={() => setMode('media')}
                  title={t.mediaView.mediaTab}
                  className={mode === 'media'
                    ? "px-2.5 h-6 flex items-center gap-1 bg-secondary text-secondary-foreground font-medium"
                    : "px-2.5 h-6 flex items-center gap-1 text-muted-foreground hover:bg-muted/50 transition-colors"}
                >
                  <ImageIcon className="h-3 w-3" />
                  {t.mediaView.mediaTab}
                </button>
              </div>

              {creatorName && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate flex-shrink-0">
                  {creatorName}{mode === 'posts' ? ' \u00b7 ' + posts.length : ''}
                </span>
              )}

              {/* Media mode's own controls land here (portaled from MediaView) */}
              <div ref={setMediaSlot} className="flex items-center gap-3 flex-wrap" />

              <span className="flex-1" />

              {/* Sync options — hidden mid-sync, shared by both modes */}
              {!isSyncingPosts && !isSyncingImages && (
                <>
                  <input
                    type="number"
                    min={1}
                    value={maxPostsInput}
                    onChange={e => setMaxPostsInput(e.target.value)}
                    onBlur={commitMaxPosts}
                    onKeyDown={e => e.key === 'Enter' && commitMaxPosts()}
                    title={t.postList.maxPostsTooltip}
                    className="h-6 w-12 text-[11px] px-1 border rounded bg-background text-center flex-shrink-0"
                  />
                  <label
                    title={t.postList.onlyNewPostsTooltip}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none flex-shrink-0"
                  >
                    <input
                      type="checkbox"
                      checked={incrementalSync}
                      onChange={e => onIncrementalSyncChange(e.target.checked)}
                      className="h-3 w-3"
                    />
                    {t.postList.onlyNewPosts}
                  </label>
                  <button
                    onClick={() => onSyncModeChange(syncMode === 'normal' ? 'full' : 'normal')}
                    title={syncMode === 'normal' ? t.postList.modeNormalDesc : t.postList.modeFullDesc}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground border rounded-full px-2 py-1 transition-colors flex-shrink-0"
                  >
                    {syncMode === 'normal' ? t.postList.modeNormalBare : t.postList.modeFullBare}
                  </button>
                </>
              )}
              <Button
                variant="default"
                size="xs"
                onClick={onSyncPosts}
                disabled={isSyncingPosts}
                title={t.workbench.syncPosts}
                className="flex-shrink-0"
              >
                <RefreshCw className={isSyncingPosts ? "animate-spin" : ""} />
                {isSyncingPosts
                  ? (syncTotal > 0 ? syncProgress + '/' + syncTotal : String(syncProgress || ""))
                  : t.workbench.syncPosts}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => { void onSyncImages(); }}
                disabled={isSyncingImages}
                title={t.workbench.downloadAssets}
              >
                <ImageDown className={isSyncingImages ? "animate-pulse" : ""} />
                {isSyncingImages
                  ? (imageTotal > 0 ? imageProgress + '/' + imageTotal : String(imageProgress || ""))
                  : t.workbench.downloadAssets}
              </Button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-hidden relative">
            {mode === 'media' && selectedCreatorId ? (
              <MediaView
                creatorId={selectedCreatorId}
                creatorName={creatorName}
                order={mediaOrder}
                onOrderChange={onMediaOrderChange}
                onShowPosts={() => setMode('posts')}
                demoMode={demoMode}
                embedded
                controlsSlot={mediaSlot}
              />
            ) : (
              <>
                {selectedPost && (
                  <button
                    onClick={() => setZen(true)}
                    title={t.workbench.zen + ' \u00b7 F'}
                    className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-card/80 backdrop-blur-sm border rounded-full px-3 py-1.5"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    {t.workbench.zen}
                  </button>
                )}
                <ReadingView post={selectedPost} assets={selectedPostAssets} onToggleStar={onToggleStar} />
              </>
            )}
          </div>

          {/* Bottom: a pure flip strip now — all shared chrome moved up top. */}
          {mode === 'posts' && selectedCreatorId && (
            <FilmstripDock
              posts={posts}
              selectedPostId={selectedPost?.id ?? null}
              onSelect={onSelectPost}
              thumbFor={thumbFor}
              title=""
              hint={posts.length > 0 ? t.workbench.flipHint : undefined}
              emptyText={t.workbench.noPosts}
            />
          )}
        </div>
      )}
    </div>
  );
}
