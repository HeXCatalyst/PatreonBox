import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Maximize2, RefreshCw, ImageDown } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Creator, Post, Asset } from "../../types/db";
import { getCreatorMedia } from "../../lib/db";
import { ReadingView } from "../library/ReadingView";
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
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
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
  onOpenSearch, onOpenDownloads, onOpenSettings,
  downloadStatus, downloadActiveCount, settingsErrorCount,
  onSyncPosts, onSyncImages, isSyncingPosts, isSyncingImages,
  syncProgress, syncTotal, imageProgress, imageTotal,
}: WorkbenchViewProps) {
  const t = useTranslation();
  const [imagesDir, setImagesDir] = useState("");
  const [media, setMedia] = useState<Asset[]>([]);
  const [home, setHome] = useState<'workbench' | 'timeline'>('workbench');
  const [zen, setZen] = useState(false);

  // Selecting a creator (from the rail) always returns to the Workbench home.
  const selectCreator = (id: string) => { setHome('workbench'); onSelectCreator(id); };

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
          onOpenDownloads={onOpenDownloads}
          onOpenSettings={onOpenSettings}
          onOpenTimeline={() => setHome('timeline')}
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
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {selectedPost && (
              <button
                onClick={() => setZen(true)}
                title={`${t.workbench.zen} · F`}
                className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-card/80 backdrop-blur-sm border rounded-full px-3 py-1.5"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                {t.workbench.zen}
              </button>
            )}
            <ReadingView post={selectedPost} assets={selectedPostAssets} onToggleStar={onToggleStar} />
          </div>
          {/* Shown whenever a creator is picked — even with zero posts, so its
              Sync button is reachable for a freshly-added creator. */}
          {selectedCreatorId && (
            <FilmstripDock
              posts={posts}
              selectedPostId={selectedPost?.id ?? null}
              onSelect={onSelectPost}
              thumbFor={thumbFor}
              title={creatorName ? `${creatorName} · ${posts.length}` : String(posts.length)}
              hint={posts.length > 0 ? t.workbench.flipHint : undefined}
              emptyText={t.workbench.noPosts}
              actions={
                <>
                  <button
                    onClick={onSyncPosts}
                    disabled={isSyncingPosts}
                    title={t.workbench.syncPosts}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60 border rounded-full px-2.5 py-1 transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${isSyncingPosts ? "animate-spin" : ""}`} />
                    {isSyncingPosts
                      ? (syncTotal > 0 ? `${syncProgress}/${syncTotal}` : String(syncProgress || ""))
                      : t.workbench.syncPosts}
                  </button>
                  <button
                    onClick={() => { void onSyncImages(); }}
                    disabled={isSyncingImages}
                    title={t.workbench.downloadAssets}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60 border rounded-full px-2.5 py-1 transition-colors"
                  >
                    <ImageDown className={`h-3 w-3 ${isSyncingImages ? "animate-pulse" : ""}`} />
                    {isSyncingImages
                      ? (imageTotal > 0 ? `${imageProgress}/${imageTotal}` : String(imageProgress || ""))
                      : t.workbench.downloadAssets}
                  </button>
                </>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
