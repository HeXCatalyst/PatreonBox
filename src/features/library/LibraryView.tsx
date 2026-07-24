import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useTranslation } from "../../lib/i18n";
import {
  getCreators,
  getPosts,
  getPostAssets,
  toggleStarPost,
  getDistinctTiersForCreator,
} from "../../lib/db";
import type { Creator, Post, Asset, SyncCheckpoint } from "../../types/db";
import { Sidebar } from "./Sidebar";
import { PostList } from "./PostList";
import { ReadingView } from "./ReadingView";
import { MediaView } from "./MediaView";
import { SettingsView } from "../settings/SettingsView";
import { DownloadsView } from "../downloads/DownloadsView";
import { SearchView, type SearchResult } from "../search/SearchView";
import { WorkbenchView } from "../workbench/WorkbenchView";
import { PerfHudGate } from "../dev/PerfHud";
import { FavoritesView } from "../favorites/FavoritesView";
import { CommandPalette, type PaletteCommand } from "../command/CommandPalette";
import { applyTheme } from "../../lib/theme";
import { useDownloadJobs, type DownloadStatus } from "../downloads/useDownloadJobs";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useUnseenSyncFailures } from "./hooks/useUnseenSyncFailures";
import { loadSettings } from "../../lib/settings";
import { DEMO_CREATORS, getDemoPosts, getDemoAssets } from "../../lib/demoData";
import type { AppSettings } from "../../types/settings";
import { DEFAULT_SETTINGS } from "../../types/settings";
import { SettingsProvider, useSettings } from "../settings/SettingsContext";
import { ResizeDivider } from "./ResizeDivider";
import type { DatePreset } from "./FilterPanel";

const MAX_ERROR_LENGTH = 80;

// The props below are grouped by feature so this interface stays navigable and
// so a whole concern can be added or removed as one unit. Field names inside
// each group match the flat names the render body already uses, so LibraryPanes
// just destructures each group back to locals — the JSX that forwards to
// Sidebar / PostList / WorkbenchView / MediaView is unchanged.

/** Fetching a creator's posts: progress, the toolbar's mode/count, and the
 *  pause/resume/cancel actions that drive it. */
interface PostSyncProps {
  syncingPosts: boolean;
  syncingCreatorId: string | null;
  syncProgress: number;
  syncTotal: number;
  maxPosts: number;
  syncMode: 'normal' | 'full';
  incrementalSync: boolean;
  postCheckpoint: SyncCheckpoint | null;
  onSyncPosts: () => void;
  onPausePosts: () => void;
  onCancelPosts: () => void;
  onResumePosts: () => void;
  onSyncModeChange: (m: 'normal' | 'full') => void;
  onIncrementalSyncChange: (v: boolean) => void;
  onMaxPostsChange: (n: number) => void;
}

/** Downloading a creator's images/attachments — the legacy per-creator image
 *  sync (distinct from the global Downloads queue). */
interface ImageDownloadProps {
  syncingImagesCreatorId: string | null;
  imageProgress: number;
  imageTotal: number;
  isImagesPaused: boolean;
  imagesDoneCount: number;
  imageFailedCount: number;
  onSyncImages: (enabledTypes?: string[]) => Promise<void>;
  onPauseImages: () => void;
  onCancelImages: () => void;
}

/** The post-list filter bar: tier and date range. */
interface FilterProps {
  tierFilter: number | null;
  datePreset: DatePreset;
  dateFrom: string | null;
  dateTo: string | null;
  distinctTiers: number[];
  onTierChange: (v: number | null) => void;
  onDatePresetChange: (preset: DatePreset) => void;
  onDateRangeChange: (from: string | null, to: string | null) => void;
}

/** Syncing the subscribed-creator list from Patreon (the sidebar's refresh). */
interface SubscriptionSyncProps {
  syncingSubscriptions: boolean;
  subscriptionSyncStatus: string;
  onSyncSubscriptions: () => void;
}

/** Rail/sidebar chrome: the buttons that open other top-level views, plus the
 *  badges those buttons carry. */
interface NavProps {
  onOpenSettings: () => void;
  onOpenDownloads: () => void;
  onOpenSearch: () => void;
  onOpenFavorites: () => void;
  downloadActiveCount: number;
  downloadStatus: DownloadStatus;
  settingsErrorCount: number;
}

interface LibraryPanesProps {
  // Core library data + selection, needed by every layout — genuinely
  // cross-cutting, so left flat rather than forced into a group.
  creators: (Creator & { post_count: number })[];
  posts: Post[];
  selectedCreatorId: string | null;
  selectedPost: Post | null;
  selectedPostAssets: Asset[];
  creatorTab: 'posts' | 'media';
  mediaOrder: 'desc' | 'asc';
  searchQuery: string;
  showStarred: boolean;
  clearingCreatorId: string | null;
  onCreatorTabChange: (tab: 'posts' | 'media') => void;
  onMediaOrderChange: (order: 'desc' | 'asc') => void;
  onSearch: (q: string) => void;
  onSelectCreator: (id: string | null) => void;
  onCreatorsUpdated: () => void;
  onDeleteCreator: (id: string) => Promise<void>;
  onSelectStarred: () => void;
  onSelectPost: (post: Post) => void;
  onOpenPost: (creatorId: string, postId: string) => void;
  onClearData: () => Promise<void>;
  onToggleStar: (post: Post, newStarred: boolean) => void;
  // Feature-grouped props.
  postSync: PostSyncProps;
  imageDownload: ImageDownloadProps;
  filters: FilterProps;
  subscriptions: SubscriptionSyncProps;
  nav: NavProps;
}

function LibraryPanes({
  creators, posts, selectedCreatorId, selectedPost, selectedPostAssets,
  creatorTab, mediaOrder, searchQuery, showStarred, clearingCreatorId,
  onCreatorTabChange, onMediaOrderChange, onSearch, onSelectCreator,
  onCreatorsUpdated, onDeleteCreator, onSelectStarred, onSelectPost, onOpenPost,
  onClearData, onToggleStar,
  postSync, imageDownload, filters, subscriptions, nav,
}: LibraryPanesProps) {
  // Spread the feature groups back to flat locals. The grouping is for the
  // interface and the call site; the render body below keeps reading the
  // individual values, so it doesn't change.
  const {
    syncingPosts, syncingCreatorId, syncProgress, syncTotal, maxPosts, syncMode,
    incrementalSync, postCheckpoint, onSyncPosts, onPausePosts, onCancelPosts,
    onResumePosts, onSyncModeChange, onIncrementalSyncChange, onMaxPostsChange,
  } = postSync;
  const {
    syncingImagesCreatorId, imageProgress, imageTotal, isImagesPaused,
    imagesDoneCount, imageFailedCount, onSyncImages, onPauseImages, onCancelImages,
  } = imageDownload;
  const {
    tierFilter, datePreset, dateFrom, dateTo, distinctTiers,
    onTierChange, onDatePresetChange, onDateRangeChange,
  } = filters;
  const { syncingSubscriptions, subscriptionSyncStatus, onSyncSubscriptions } = subscriptions;
  const {
    onOpenSettings, onOpenDownloads, onOpenSearch, onOpenFavorites,
    downloadActiveCount, downloadStatus, settingsErrorCount,
  } = nav;

  const { settings, updateSettings } = useSettings();
  const [sidebarWidth, setSidebarWidth] = useState(settings.sidebar_width);
  const [postListWidth, setPostListWidth] = useState(settings.post_list_width);

  useEffect(() => {
    setSidebarWidth(settings.sidebar_width);
    setPostListWidth(settings.post_list_width);
  }, [settings.sidebar_width, settings.post_list_width]);

  // Workbench layout: a rail + reading canvas + filmstrip dock replaces the
  // classic three panes. Everything else (settings/downloads/search views) is
  // handled a level up in LibraryView, so this only swaps the library body.
  if (settings.layout_mode === 'workbench') {
    return (
      <WorkbenchView
        creators={creators}
        selectedCreatorId={selectedCreatorId}
        onSelectCreator={onSelectCreator}
        posts={posts}
        selectedPost={selectedPost}
        selectedPostAssets={selectedPostAssets}
        onSelectPost={onSelectPost}
        onOpenPost={onOpenPost}
        onToggleStar={onToggleStar}
        onOpenSearch={onOpenSearch}
        onOpenFavorites={onOpenFavorites}
        onOpenDownloads={onOpenDownloads}
        onOpenSettings={onOpenSettings}
        onSyncSubscriptions={onSyncSubscriptions}
        syncingSubscriptions={syncingSubscriptions}
        downloadStatus={downloadStatus}
        downloadActiveCount={downloadActiveCount}
        settingsErrorCount={settingsErrorCount}
        onSyncPosts={onSyncPosts}
        onSyncImages={async () => {
          const dat = settings.downloadAssetTypes;
          const enabledTypes: string[] = [];
          if (dat?.images !== false) enabledTypes.push("image");
          if (dat?.audio !== false) enabledTypes.push("audio");
          if (dat?.attachments !== false) { enabledTypes.push("file"); enabledTypes.push("video"); }
          await onSyncImages(enabledTypes);
        }}
        isSyncingPosts={syncingPosts && selectedCreatorId === syncingCreatorId}
        isSyncingImages={syncingImagesCreatorId != null && syncingImagesCreatorId === selectedCreatorId}
        syncProgress={syncProgress}
        syncTotal={syncTotal}
        imageProgress={imageProgress}
        imageTotal={imageTotal}
        maxPosts={maxPosts}
        onMaxPostsChange={onMaxPostsChange}
        incrementalSync={incrementalSync}
        onIncrementalSyncChange={onIncrementalSyncChange}
        syncMode={syncMode}
        onSyncModeChange={onSyncModeChange}
        mediaOrder={mediaOrder}
        onMediaOrderChange={onMediaOrderChange}
        demoMode={settings.demo_mode}
      />
    );
  }

  return (
    <>
      <div style={{ width: sidebarWidth, flexShrink: 0 }} className="h-full">
        <Sidebar
          creators={creators}
          selectedCreatorId={selectedCreatorId}
          onSelectCreator={onSelectCreator}
          onCreatorsUpdated={onCreatorsUpdated}
          onDeleteCreator={onDeleteCreator}
          onOpenSettings={onOpenSettings}
          onOpenDownloads={onOpenDownloads}
          onOpenSearch={onOpenSearch}
          downloadActiveCount={downloadActiveCount}
          downloadStatus={downloadStatus}
          settingsErrorCount={settingsErrorCount}
          showStarred={showStarred}
          onSelectStarred={onSelectStarred}
          syncingSubscriptions={syncingSubscriptions}
          subscriptionSyncStatus={subscriptionSyncStatus}
          onSyncSubscriptions={onSyncSubscriptions}
          demoMode={settings.demo_mode}
        />
      </div>
      <ResizeDivider
        currentWidth={sidebarWidth}
        min={160}
        max={400}
        onDrag={setSidebarWidth}
        onCommit={w => updateSettings({ sidebar_width: w })}
      />
      {creatorTab === 'media' && selectedCreatorId ? (
        <MediaView
          creatorId={selectedCreatorId}
          creatorName={creators.find(c => c.id === selectedCreatorId)?.name ?? ''}
          order={mediaOrder}
          onOrderChange={onMediaOrderChange}
          onShowPosts={() => onCreatorTabChange('posts')}
          demoMode={settings.demo_mode}
        />
      ) : (
      <>
      <div style={{ width: postListWidth, flexShrink: 0 }} className="h-full">
        <PostList
          posts={posts}
          searchQuery={searchQuery}
          selectedPostId={selectedPost?.id || null}
          selectedCreator={creators.find(c => c.id === selectedCreatorId)}
          onShowMedia={() => onCreatorTabChange('media')}
          isSyncingPosts={syncingPosts && selectedCreatorId === syncingCreatorId}
          syncProgress={syncProgress}
          syncTotal={syncTotal}
          maxPosts={maxPosts}
          onMaxPostsChange={onMaxPostsChange}
          onSearch={onSearch}
          onSelectPost={onSelectPost}
          onSyncPosts={onSyncPosts}
          onClearData={onClearData}
          isClearingData={clearingCreatorId === selectedCreatorId}
          onSyncImages={async () => {
            const dat = settings.downloadAssetTypes;
            const enabledTypes: string[] = [];
            if (dat?.images !== false) enabledTypes.push("image");
            if (dat?.audio !== false) enabledTypes.push("audio");
            if (dat?.attachments !== false) { enabledTypes.push("file"); enabledTypes.push("video"); }
            await onSyncImages(enabledTypes);
          }}
          isSyncingImages={syncingImagesCreatorId != null && syncingImagesCreatorId === selectedCreatorId}
          imageProgress={imageProgress}
          imageTotal={imageTotal}
          syncMode={syncMode}
          onSyncModeChange={onSyncModeChange}
          incrementalSync={incrementalSync}
          onIncrementalSyncChange={onIncrementalSyncChange}
          onPausePosts={onPausePosts}
          onCancelPosts={onCancelPosts}
          onResumePosts={onResumePosts}
          onPauseImages={onPauseImages}
          onCancelImages={onCancelImages}
          postCheckpoint={postCheckpoint}
          isImagesPaused={isImagesPaused}
          imagesDoneCount={imagesDoneCount}
          imageFailedCount={imageFailedCount}
          showStarred={showStarred}
          onToggleStar={onToggleStar}
          tierFilter={tierFilter}
          datePreset={datePreset}
          dateFrom={dateFrom}
          dateTo={dateTo}
          distinctTiers={distinctTiers}
          onTierChange={onTierChange}
          onDatePresetChange={onDatePresetChange}
          onDateRangeChange={onDateRangeChange}
        />
      </div>
      <ResizeDivider
        currentWidth={postListWidth}
        min={240}
        max={560}
        onDrag={setPostListWidth}
        onCommit={w => updateSettings({ post_list_width: w })}
      />
      <ReadingView
        post={selectedPost}
        assets={selectedPostAssets}
        onToggleStar={onToggleStar}
      />
      </>
      )}
    </>
  );
}

export function LibraryView() {
  const [view, setView] = useState<'library' | 'settings' | 'downloads' | 'search' | 'favorites'>('library');
  const [settingsInitialSection, setSettingsInitialSection] = useState<'account' | 'history'>('account');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { jobs: downloadJobs, activeCount: downloadActiveCount, status: downloadStatus, paused: downloadsPaused, refresh: refreshDownloads } = useDownloadJobs();
  const { unseenFailures } = useUnseenSyncFailures();
  // A search result to open: remembered until the target creator's posts load,
  // then resolved to the actual Post (the creator-change effect clears any prior
  // selection first, so we can't set the post synchronously here).
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [initialSettings, setInitialSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [creators, setCreators] = useState<(Creator & { post_count: number })[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);
  const [creatorTab, setCreatorTab] = useState<'posts' | 'media'>('posts');
  const [mediaOrder, setMediaOrder] = useState<'desc' | 'asc'>('desc');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [selectedPostAssets, setSelectedPostAssets] = useState<Asset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const t = useTranslation();
  const [syncingPosts, setSyncingPosts] = useState(false);
  const [syncingCreatorId, setSyncingCreatorId] = useState<string | null>(null);
  const [syncingSubscriptions, setSyncingSubscriptions] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [migratingImages, setMigratingImages] = useState(false);
  const [subscriptionSyncStatus, setSubscriptionSyncStatus] = useState<string>("");
  const [clearingCreatorId, setClearingCreatorId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [maxPosts, setMaxPosts] = useState(9999);
  const [syncingImagesCreatorId, setSyncingImagesCreatorId] = useState<string | null>(null);
  const [imageProgress, setImageProgress] = useState(0);
  const [imageTotal, setImageTotal] = useState(0);
  const [syncMode, setSyncMode] = useState<'normal' | 'full'>('normal');
  const [incrementalSync, setIncrementalSync] = useState(false);
  const [postCheckpoint, setPostCheckpoint] = useState<SyncCheckpoint | null>(null);
  const [isImagesPaused, setIsImagesPaused] = useState(false);
  const [imagesDoneCount, setImagesDoneCount] = useState(0);
  const [imageFailedCount, setImageFailedCount] = useState(0);
  const isImagesPausedRef = useRef(false);
  const prevCreatorIdRef = useRef<string | null>(null);
  const demoModeInitialRender = useRef(true);
  // Always mirrors the current demoMode value, so async load functions can
  // re-check it after an await resolves — a plain closure over `demoMode`
  // would still see whatever value was current when the function *started*,
  // even if the mode changed while a real DB query was in flight (this is
  // exactly what let React StrictMode's mount double-invoke slip a stale
  // real-data fetch past the demoModeInitialRender guard below).
  const demoModeRef = useRef(demoMode);
  demoModeRef.current = demoMode;
  const [showStarred, setShowStarred] = useState(false);
  const [tierFilter, setTierFilter] = useState<number | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [distinctTiers, setDistinctTiers] = useState<number[]>([]);

  useEffect(() => {
    async function init() {
      try {
        const settings = await loadSettings();
        setInitialSettings(settings);
        setDemoMode(settings.demo_mode);
        setMaxPosts(settings.default_max_posts);
        setSyncMode(settings.default_sync_mode as 'normal' | 'full');
        // Apply theme + color theme immediately so there's no flash
        applyTheme(settings.theme, settings.color_theme);
        if (settings.demo_mode) {
          setCreators(DEMO_CREATORS);
        } else {
          await loadCreators();
          const account = await invoke('get_account_info');
          if (account === null) {
            setView('settings');
          }
        }
      } catch (err) {
        console.error("Failed to initialize database", err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  useTauriEvents({
    "patreon-logged-in": async () => {
      console.log("Login detected. Reloading creators...");
      await loadCreators();
      handleSyncSubscriptions();
    },
    "sync-progress": (payload: { current: number; total: number }) => {
      setSyncProgress(payload.current);
      if (payload.total > 0) {
        setSyncTotal(payload.total);
      }
    },
    "sync-complete": async (payload: { creator_id: string }) => {
      if (demoMode) return;
      console.log("Sync complete event received. Refreshing posts...");
      await loadCreators();
      await loadPosts();
      if (selectedCreatorId) {
        getDistinctTiersForCreator(selectedCreatorId).then(setDistinctTiers).catch(console.error);
      }
      // Refresh checkpoint — deleted on natural completion, may exist on pause
      // Note: Tauri command params must be camelCase (creatorId), but event payload
      // fields come back as snake_case (creator_id) matching how Rust serialized them.
      const cp = await invoke<SyncCheckpoint | null>('get_sync_checkpoint', { creatorId: payload.creator_id });
      setPostCheckpoint(cp);
    },
    "image-download-progress": (payload: { current: number; total: number; creator_id: string }) => {
      setImageProgress(payload.current);
      if (payload.total > 0) setImageTotal(payload.total);
    },
    "image-migration-active": (active: boolean) => {
      setMigratingImages(active);
    },
    "demo-mode-changed": (active: boolean) => {
      setDemoMode(active);
    },
  });

  useEffect(() => {
    if (demoModeInitialRender.current) {
      demoModeInitialRender.current = false;
      return;
    }
    setSelectedCreatorId(null);
    setSelectedPost(null);
    loadCreators();
    loadPosts();
  }, [demoMode]);

  useEffect(() => {
    if (!loading) {
      loadPosts().catch(console.error);
      setSelectedPost(null);
    }
  }, [selectedCreatorId, searchQuery, loading, showStarred, tierFilter, dateFrom, dateTo]);

  useEffect(() => {
    setTierFilter(null);
    setDatePreset('all');
    setDateFrom(null);
    setDateTo(null);
  }, [selectedCreatorId]);

  useEffect(() => {
    if (!selectedCreatorId) { setDistinctTiers([]); return; }
    getDistinctTiersForCreator(selectedCreatorId).then(setDistinctTiers).catch(console.error);
  }, [selectedCreatorId]);

  // Fetch sync checkpoint when creator changes
  useEffect(() => {
    if (selectedCreatorId) {
      invoke<SyncCheckpoint | null>('get_sync_checkpoint', { creatorId: selectedCreatorId })
        .then(cp => setPostCheckpoint(cp))
        .catch(console.error);
    } else {
      setPostCheckpoint(null);
    }
  }, [selectedCreatorId]);

  useEffect(() => {
    if (selectedPost) {
      loadAssets(selectedPost.id);
    } else {
      setSelectedPostAssets([]);
    }
  }, [selectedPost]);

  // When the download queue drains, refresh the open post's assets so freshly
  // downloaded images/videos flip from "Not downloaded" to playable/viewable
  // without needing to re-open the post.
  const prevDownloadStatusRef = useRef<typeof downloadStatus>(downloadStatus);
  useEffect(() => {
    if (prevDownloadStatusRef.current === "downloading" && downloadStatus === "idle" && selectedPost) {
      loadAssets(selectedPost.id);
    }
    prevDownloadStatusRef.current = downloadStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadStatus]);

  const handleDeleteCreator = async (id: string) => {
    if (demoMode) return;
    try {
      // Cancel any in-flight image download for this creator before deleting.
      if (syncingImagesCreatorId === id) {
        await invoke('cancel_image_download').catch(() => {});
        setSyncingImagesCreatorId(null);
        setImageProgress(0);
        setImageTotal(0);
        setImagesDoneCount(0);
        setImageFailedCount(0);
        isImagesPausedRef.current = false;
        setIsImagesPaused(false);
      }
      await invoke("delete_creator", { creatorId: id });
      if (selectedCreatorId === id) {
        setSelectedCreatorId(null);
        setSelectedPost(null);
        setImageFailedCount(0);
      }
      await loadCreators();
    } catch (e) {
      console.error("Failed to delete creator:", e);
      throw e;
    }
  };

  const handleTierChange = (v: number | null) => setTierFilter(v);
  const handleDatePresetChange = (preset: DatePreset) => setDatePreset(preset);
  const handleDateRangeChange = (from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
  };

  const handleClearData = async () => {
    if (demoMode || !selectedCreatorId || clearingCreatorId) return;
    setClearingCreatorId(selectedCreatorId);
    try {
      await invoke("clear_creator_data", { creatorId: selectedCreatorId });
      setSelectedPost(null);
      setPostCheckpoint(null);
      await loadPosts();
      await loadCreators();
    } catch (e) {
      console.error("Failed to clear creator data:", e);
      throw e;
    } finally {
      setClearingCreatorId(null);
    }
  };

  // handleSyncImages must be defined before handleSyncPosts (Full mode auto-trigger)
  const handleSyncImages = async (enabledTypes?: string[]) => {
    if (demoMode || !selectedCreatorId || migratingImages) return;
    // Enqueue into the global download manager; progress shows on the Downloads page.
    try {
      await invoke<number>('start_downloads', {
        creatorId: selectedCreatorId,
        assetIds: null,
        enabledTypes: enabledTypes ?? null,
        // Scope the download to the same newest-N posts the toolbar's count
        // targets, so "10" means 10 for downloading too — not the whole archive.
        maxPosts: maxPosts,
      });
      await refreshDownloads();
    } catch (e) {
      console.error('Failed to start downloads:', e);
    }
  };

  // Fresh sync and resume-from-checkpoint are the same run with three
  // differences, so they share one body: resume seeds progress from the
  // checkpoint, and takes its mode + cursor from it instead of the current UI
  // state. A fresh sync also forwards the incremental toggle, which resume
  // deliberately doesn't — resuming continues an existing crawl, where flipping
  // incremental mid-stream has no meaning.
  const runSyncPosts = async (checkpoint: SyncCheckpoint | null) => {
    if (demoMode || !selectedCreatorId || syncingPosts) return;
    const creator = creators.find(c => c.id === selectedCreatorId);
    if (!creator?.profile_url) return;

    setSyncingPosts(true);
    setSyncingCreatorId(selectedCreatorId);
    setSyncProgress(checkpoint ? checkpoint.posts_done : 0);
    setSyncTotal(0);
    try {
      await invoke<number>('scrape_creator_posts', {
        creatorUrl: creator.profile_url,
        creatorId: creator.id,
        maxPosts: maxPosts,
        mode: checkpoint ? checkpoint.mode : syncMode,
        resumeCursor: checkpoint ? checkpoint.cursor : null,
        // Only a fresh sync carries the toggle; resume leaves it unset (false).
        ...(checkpoint ? {} : { incremental: incrementalSync }),
      });
      await loadPosts();
      await loadCreators();
      // Full mode: always auto-trigger images after sync batch completes.
      // Don't gate on checkpoint: with small maxPosts a checkpoint always exists, but
      // user still expects the current batch's images to download automatically.
      if (syncMode === 'full') {
        await handleSyncImages();
      }
    } catch (e) {
      console.error(checkpoint ? 'Failed to resume posts:' : 'Failed to sync posts:', e);
    } finally {
      setSyncingPosts(false);
      setSyncingCreatorId(null);
      setSyncProgress(0);
      setSyncTotal(0);
    }
  };

  const handleSyncPosts = () => runSyncPosts(null);

  const handlePausePosts = async () => {
    await invoke('close_post_sync_window');
    // scrape_creator_posts unblocks and emits sync-complete, which refreshes the checkpoint
  };

  const handleCancelPosts = async () => {
    if (demoMode || !selectedCreatorId) return;
    // Clear DB first so sync-complete handler finds nothing
    await invoke('clear_sync_checkpoint', { creatorId: selectedCreatorId });
    setPostCheckpoint(null);
    // Only close the window if a sync is actively running — avoid writing stale signal
    // into ScrapedPostsRawState when no polling loop is active (e.g., paused state)
    if (syncingPosts) {
      await invoke('close_post_sync_window');
    }
  };

  const handleResumePosts = () => {
    if (!postCheckpoint) return;
    return runSyncPosts(postCheckpoint);
  };

  const handlePauseImages = async () => {
    // Capture progress synchronously before the finally block resets it
    isImagesPausedRef.current = true;
    setImagesDoneCount(imageProgress);
    setIsImagesPaused(true);
    await invoke('cancel_image_download');
  };

  const handleCancelImages = async () => {
    isImagesPausedRef.current = false;
    setIsImagesPaused(false);
    setImagesDoneCount(0);
    await invoke('cancel_image_download');
  };

  const handleSelectCreator = (id: string | null) => {
    setSelectedCreatorId(id);
    setCreatorTab('posts');
    setSearchQuery("");
    setShowStarred(false);
    setImageFailedCount(0);
  };

  // "Starred" now opens the unified Favorites page (starred posts + favourited
  // images) rather than filtering the classic post list in place.
  const handleSelectStarred = () => {
    setShowStarred(false);
    setSelectedPost(null);
    setView('favorites');
  };

  const handleToggleStar = async (post: Post, newStarred: boolean) => {
    if (demoMode) return;
    try {
      await toggleStarPost(post.id, newStarred);
    } catch (e) {
      console.error('Failed to toggle star:', e);
      return;
    }
    const updated = { ...post, is_starred: newStarred ? 1 : 0 };
    setPosts(prev => showStarred && !newStarred
      ? prev.filter(p => p.id !== post.id)
      : prev.map(p => p.id === post.id ? updated : p)
    );
    if (selectedPost?.id === post.id) setSelectedPost(updated);
  };

  async function loadCreators() {
    if (demoModeRef.current) {
      setCreators(DEMO_CREATORS);
      return;
    }
    const data = await getCreators();
    if (demoModeRef.current) return; // mode flipped to demo while this was in flight — discard stale real data
    setCreators(data);
  }

  const handleSyncSubscriptions = async () => {
    if (demoMode) return;
    if (syncingSubscriptions) return;
    setSyncingSubscriptions(true);
    setSubscriptionSyncStatus(t.sidebar.statusScraping);
    try {
      try {
        await invoke("scrape_subscriptions");
      } catch (e) {
        setSubscriptionSyncStatus(t.sidebar.statusScrapeError);
      }
      setSubscriptionSyncStatus(t.sidebar.statusSaving);
      try {
        const count = await invoke<number>("save_scraped_to_db");
        setSubscriptionSyncStatus(t.sidebar.statusSynced(count));
        await loadCreators();
        emit("subscriptions-synced");
      } catch (e: any) {
        setSubscriptionSyncStatus(t.sidebar.statusDbError(String(e).substring(0, MAX_ERROR_LENGTH)));
      }
    } catch (e: any) {
      setSubscriptionSyncStatus(t.sidebar.statusError(String(e).substring(0, MAX_ERROR_LENGTH)));
    } finally {
      setSyncingSubscriptions(false);
      setTimeout(() => setSubscriptionSyncStatus(""), 8000);
    }
  };

  async function loadPosts() {
    const creatorChanged = prevCreatorIdRef.current !== selectedCreatorId;
    prevCreatorIdRef.current = selectedCreatorId;
    const effectiveTierFilter = creatorChanged ? null : tierFilter;
    const effectiveDateFrom = creatorChanged ? null : dateFrom;
    const effectiveDateTo = creatorChanged ? null : dateTo;
    if (demoModeRef.current) {
      setPosts(getDemoPosts(showStarred ? undefined : (selectedCreatorId ?? undefined), showStarred));
      return;
    }
    const data = showStarred
      ? await getPosts(undefined, searchQuery, true)
      : await getPosts(selectedCreatorId ?? undefined, searchQuery, false, effectiveTierFilter, effectiveDateFrom, effectiveDateTo);
    if (demoModeRef.current) return;
    setPosts(data);
  }

  async function loadAssets(postId: string) {
    if (demoModeRef.current) {
      setSelectedPostAssets(getDemoAssets(postId));
      return;
    }
    const data = await getPostAssets(postId);
    if (demoModeRef.current) return;
    setSelectedPostAssets(data);
  }

  // Once a search result's creator is selected and its posts have loaded, open
  // the specific post it pointed at.
  useEffect(() => {
    if (!pendingPostId) return;
    const post = posts.find(p => p.id === pendingPostId);
    if (post) {
      setSelectedPost(post);
      setPendingPostId(null);
    }
  }, [posts, pendingPostId]);

  // Navigate to a specific post: select its creator and remember the post id;
  // the resolver effect above opens it once that creator's posts have loaded.
  const handleOpenPost = (creatorId: string, postId: string) => {
    setShowStarred(false);
    setSearchQuery("");
    setSelectedCreatorId(creatorId);
    setPendingPostId(postId);
    setView('library');
  };

  const handleOpenSearchResult = (result: SearchResult) => handleOpenPost(result.creator_id, result.post_id);

  const handleOpenSettings = () => {
    // Land directly on Sync History when there are unseen sync failures.
    setSettingsInitialSection(unseenFailures > 0 ? 'history' : 'account');
    setView('settings');
  };

  // ⌘K / Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const paletteCommands: PaletteCommand[] = [
    { id: 'sync-all', label: t.commandPalette.cmdSyncAll, run: () => handleSyncSubscriptions() },
    { id: 'search', label: t.commandPalette.cmdSearch, run: () => setView('search') },
    { id: 'downloads', label: t.commandPalette.cmdDownloads, run: () => setView('downloads') },
    { id: 'settings', label: t.commandPalette.cmdSettings, run: handleOpenSettings },
  ];

  const handlePaletteSelectCreator = (id: string) => {
    setShowStarred(false);
    setSearchQuery("");
    setSelectedCreatorId(id);
    setView('library');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <p>Loading library...</p>
      </div>
    );
  }

  return (
    <SettingsProvider initial={initialSettings}>
      <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
        <PerfHudGate />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          creators={creators}
          commands={paletteCommands}
          onSelectCreator={handlePaletteSelectCreator}
          onOpenPost={handleOpenSearchResult}
        />
        {syncingSubscriptions && (
          <div className="w-full bg-blue-600 text-white text-sm text-center py-1.5 flex-shrink-0">
            {t.sidebar.syncBannerWarning}
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
        {view === 'favorites' ? (
          <FavoritesView
            onClose={() => setView('library')}
            onOpenPost={handleOpenPost}
          />
        ) : view === 'settings' ? (
          <SettingsView onClose={() => setView('library')} initialSection={settingsInitialSection} />
        ) : view === 'downloads' ? (
          <DownloadsView
            jobs={downloadJobs}
            paused={downloadsPaused}
            onRefresh={refreshDownloads}
            onClose={() => setView('library')}
            creatorName={(id) => creators.find(c => c.id === id)?.name ?? id}
          />
        ) : view === 'search' ? (
          <SearchView
            onClose={() => setView('library')}
            onOpenResult={handleOpenSearchResult}
          />
        ) : (
          <LibraryPanes
            creators={creators}
            posts={posts}
            selectedCreatorId={selectedCreatorId}
            selectedPost={selectedPost}
            selectedPostAssets={selectedPostAssets}
            creatorTab={creatorTab}
            mediaOrder={mediaOrder}
            searchQuery={searchQuery}
            showStarred={showStarred}
            clearingCreatorId={clearingCreatorId}
            onCreatorTabChange={setCreatorTab}
            onMediaOrderChange={setMediaOrder}
            onSearch={setSearchQuery}
            onSelectCreator={handleSelectCreator}
            onCreatorsUpdated={loadCreators}
            onDeleteCreator={handleDeleteCreator}
            onSelectStarred={handleSelectStarred}
            onSelectPost={setSelectedPost}
            onOpenPost={handleOpenPost}
            onClearData={handleClearData}
            onToggleStar={handleToggleStar}
            postSync={{
              syncingPosts, syncingCreatorId, syncProgress, syncTotal, maxPosts,
              syncMode, incrementalSync, postCheckpoint,
              onSyncPosts: handleSyncPosts,
              onPausePosts: handlePausePosts,
              onCancelPosts: handleCancelPosts,
              onResumePosts: handleResumePosts,
              onSyncModeChange: setSyncMode,
              onIncrementalSyncChange: setIncrementalSync,
              onMaxPostsChange: setMaxPosts,
            }}
            imageDownload={{
              syncingImagesCreatorId, imageProgress, imageTotal, isImagesPaused,
              imagesDoneCount, imageFailedCount,
              onSyncImages: handleSyncImages,
              onPauseImages: handlePauseImages,
              onCancelImages: handleCancelImages,
            }}
            filters={{
              tierFilter, datePreset, dateFrom, dateTo, distinctTiers,
              onTierChange: handleTierChange,
              onDatePresetChange: handleDatePresetChange,
              onDateRangeChange: handleDateRangeChange,
            }}
            subscriptions={{
              syncingSubscriptions, subscriptionSyncStatus,
              onSyncSubscriptions: handleSyncSubscriptions,
            }}
            nav={{
              onOpenSettings: handleOpenSettings,
              onOpenDownloads: () => setView('downloads'),
              onOpenSearch: () => setView('search'),
              onOpenFavorites: handleSelectStarred,
              downloadActiveCount,
              downloadStatus,
              settingsErrorCount: unseenFailures,
            }}
          />
        )}
        </div>
      </div>
    </SettingsProvider>
  );
}
