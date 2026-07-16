import { useEffect, useMemo, useState } from "react";
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
}: WorkbenchViewProps) {
  const t = useTranslation();
  const [imagesDir, setImagesDir] = useState("");
  const [media, setMedia] = useState<Asset[]>([]);
  const [home, setHome] = useState<'workbench' | 'timeline'>('workbench');

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
  useEffect(() => {
    if (selectedCreatorId && !selectedPost && posts.length > 0) onSelectPost(posts[0]);
  }, [selectedCreatorId, posts, selectedPost, onSelectPost]);

  // ← / → flip through the current creator's posts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (posts.length === 0) return;
      const idx = selectedPost ? posts.findIndex(p => p.id === selectedPost.id) : -1;
      const next = e.key === "ArrowRight"
        ? Math.min(posts.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      if (next !== idx && posts[next]) { e.preventDefault(); onSelectPost(posts[next]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [posts, selectedPost, onSelectPost]);

  const creatorName = creators.find(c => c.id === selectedCreatorId)?.name ?? "";

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
          <div className="flex-1 min-h-0 overflow-hidden">
            <ReadingView post={selectedPost} assets={selectedPostAssets} onToggleStar={onToggleStar} />
          </div>
          {selectedCreatorId && posts.length > 0 && (
            <FilmstripDock
              posts={posts}
              selectedPostId={selectedPost?.id ?? null}
              onSelect={onSelectPost}
              thumbFor={thumbFor}
              title={creatorName ? `${creatorName} · ${posts.length}` : String(posts.length)}
              hint={t.workbench.flipHint}
            />
          )}
        </div>
      )}
    </div>
  );
}
