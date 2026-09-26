import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Maximize2, RefreshCw, ImageDown, FileText, Image as ImageIcon } from "lucide-react";
import { Creator, Post, Asset } from "../../types/db";
import { useImagesDir } from "../../lib/assetUrl";
import { getFirstImagePerPost, getPostIndex, type PostIndexRow, type PostsFilterOptions } from "../../lib/db";
import { getDemoPosts } from "../../lib/demoData";
import { ReadingView } from "../library/ReadingView";
import { MediaView } from "../library/MediaView";
import { Button } from "@/components/ui/button";
import { IconRail } from "./IconRail";
import { FilmstripDock, type FilmstripPost } from "./FilmstripDock";
import { TimelineView } from "./TimelineView";
import type { DownloadStatus } from "../downloads/useDownloadJobs";
import { useTranslation } from "../../lib/i18n";
import { useSyncProgress } from "../library/progress";

interface WorkbenchViewProps {
  creators: (Creator & { post_count: number })[];
  selectedCreatorId: string | null;
  onSelectCreator: (id: string) => void;
  /** The list query, shared with the classic layout so both show the same set. */
  postsFilter: PostsFilterOptions;
  /** Bumped when the posts change underneath (sync finished, demo flip). */
  reloadToken: number;
  selectedPost: Post | null;
  selectedPostAssets: Asset[];
  /** Open a post by id: the filmstrip only carries ids (P1-5), and the canvas
   * fetches that one post instead of the whole list. */
  onSelectPostById: (postId: string) => void;
  onOpenPost: (creatorId: string, postId: string) => void;
  onToggleStar?: (post: Post, newStarred: boolean) => void;
  onOpenSearch: () => void;
  onOpenFavorites: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
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


/**
 * The Workbench layout: a slim creator rail, a big reading canvas (the existing
 * ReadingView), and a bottom filmstrip of the current creator's posts. Selecting
 * a creator loads its posts (via the parent) and auto-opens the newest; ← → flip
 * through the dock.
 */
export function WorkbenchView({
  creators, selectedCreatorId, onSelectCreator,
  postsFilter, reloadToken,
  selectedPost, selectedPostAssets, onSelectPostById, onOpenPost, onToggleStar,
  onOpenSearch, onOpenFavorites, onOpenDownloads, onOpenSettings, onOpenNotifications,
  onSyncSubscriptions, syncingSubscriptions,
  downloadStatus, downloadActiveCount, settingsErrorCount,
  onSyncPosts, onSyncImages, isSyncingPosts, isSyncingImages,
  imageProgress, imageTotal,
  maxPosts, onMaxPostsChange, incrementalSync, onIncrementalSyncChange,
  syncMode, onSyncModeChange,
  mediaOrder, onMediaOrderChange, demoMode,
}: WorkbenchViewProps) {
  const t = useTranslation();
  const imagesDir = useImagesDir();
  // The sync counter comes straight from the progress store rather than through
  // the library root's state — see PostList for the reasoning.
  const { current: syncProgress, total: syncTotal } = useSyncProgress();
  const [media, setMedia] = useState<Asset[]>([]);
  // The filmstrip's model: one row per post, id/title/creator_id only (P1-5).
  // The root used to hand the workbench the full post array — every column of
  // every post the creator has — for a strip that renders a title and a thumb.
  const [postIndex, setPostIndex] = useState<PostIndexRow[]>([]);
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
  // on the Posts view. Stable identity so a re-render of the workbench doesn't
  // invalidate the memoized rail.
  const selectCreator = useCallback((id: string) => {
    setHome('workbench');
    setMode('posts');
    onSelectCreator(id);
  }, [onSelectCreator]);

  const openTimeline = useCallback(() => setHome('timeline'), []);

  // The filmstrip index for the current query. Demo mode builds it from the demo
  // dataset (no DB behind it); otherwise it is one lightweight query — the same
  // filter the classic list uses, so both layouts agree on the set.
  useEffect(() => {
    if (!selectedCreatorId) { setPostIndex([]); return; }
    if (demoMode) {
      setPostIndex(getDemoPosts(
        postsFilter.starred ? undefined : selectedCreatorId,
        !!postsFilter.starred,
      ).map(p => ({ id: p.id, title: p.title, creator_id: p.creator_id })));
      return;
    }
    let cancelled = false;
    getPostIndex(postsFilter)
      .then(index => { if (!cancelled) setPostIndex(index); })
      .catch(console.error);
    return () => { cancelled = true; };
    // The filter is a stable identity per query, so this refetches exactly when
    // the query changes — plus the reload token for changes that leave the query
    // alone (a sync bringing in new posts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCreatorId, postsFilter, reloadToken, demoMode]);

  // First image per post = the filmstrip thumbnail. P1-2: previously fetched
  // every media row for the creator (thousands) into JS just to keep one per
  // post; now the SQL ROW_NUMBER() partition does the filtering, returning one
  // row per post.
  useEffect(() => {
    if (!selectedCreatorId) { setMedia([]); return; }
    let cancelled = false;
    getFirstImagePerPost(selectedCreatorId)
      .then(m => { if (!cancelled) setMedia(m); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [selectedCreatorId]);

  const thumbByPost = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const a of media) {
      if (!a.post_id || map.has(a.post_id)) continue;
      map.set(a.post_id, a);
    }
    return map;
  }, [media]);

  // Stable identity is what lets a memoized filmstrip cell skip: the map only
  // changes when the creator's media does, so a selection change re-renders the
  // two cells whose highlight moved instead of every cell in the strip.
  const thumbFor = useCallback(
    (post: { id: string }): Asset | null => thumbByPost.get(post.id) ?? null,
    [thumbByPost],
  );

  // The dock's select callback takes the row it was given; the root wants an id.
  // Memoized so the dock and its cells keep their identity across re-renders.
  const selectFromStrip = useCallback(
    (post: FilmstripPost) => onSelectPostById(post.id),
    [onSelectPostById],
  );

  // Auto-open the newest post when a creator is selected but nothing's open yet
  // (e.g. right after switching creator). With no creator, the canvas stays on
  // its empty state rather than surfacing an arbitrary post.
  // The creator_id guard matters: right after a switch, the index still holds the
  // PREVIOUS creator's posts until the async reload lands — auto-opening from the
  // stale list put the old creator's post on the canvas (always one switch behind).
  useEffect(() => {
    if (selectedCreatorId && !selectedPost && postIndex.length > 0 && postIndex[0].creator_id === selectedCreatorId) {
      onSelectPostById(postIndex[0].id);
    }
  }, [selectedCreatorId, postIndex, selectedPost, onSelectPostById]);

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
      if (typing || postIndex.length === 0) return;
      const idx = selectedPost ? postIndex.findIndex(p => p.id === selectedPost.id) : -1;
      const next = e.key === "ArrowRight"
        ? Math.min(postIndex.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      if (next !== idx && postIndex[next]) { e.preventDefault(); onSelectPostById(postIndex[next].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [postIndex, selectedPost, onSelectPostById, zen]);

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
          onOpenNotifications={onOpenNotifications}
          onOpenTimeline={openTimeline}
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
                  {creatorName}{mode === 'posts' ? ' \u00b7 ' + postIndex.length : ''}
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
              posts={postIndex}
              selectedPostId={selectedPost?.id ?? null}
              onSelect={selectFromStrip}
              thumbFor={thumbFor}
              imagesDir={imagesDir}
              title=""
              hint={postIndex.length > 0 ? t.workbench.flipHint : undefined}
              emptyText={t.workbench.noPosts}
            />
          )}
        </div>
      )}
    </div>
  );
}
