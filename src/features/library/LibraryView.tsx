import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { translations } from "../../lib/i18n";
import {
  getCreators,
  getPostsPage,
  getPostById,
  getPostAssets,
  toggleStarPost,
  getDistinctTiersForCreator,
  getPostIdsForComments,
  getAllPostIdsMissingComments,
  type PostsFilterOptions,
} from "../../lib/db";
import type { Creator, Post, Asset, SyncCheckpoint } from "../../types/db";
import { Sidebar } from "./Sidebar";
import { PostList, POSTS_PER_PAGE } from "./PostList";
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
import { useDownloadSummary } from "../downloads/useDownloadSummary";
import { type DownloadStatus } from "../downloads/useDownloadJobs";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useUnseenSyncFailures } from "./hooks/useUnseenSyncFailures";
import { loadSettings } from "../../lib/settings";
import { DEMO_CREATORS, getDemoPosts, getDemoAssets } from "../../lib/demoData";
import type { AppSettings } from "../../types/settings";
import { DEFAULT_SETTINGS } from "../../types/settings";
import { SettingsProvider, useSettings } from "../settings/SettingsContext";
import { useNotify } from "../notifications/NotificationContext";
import { ToastStack } from "../notifications/ToastStack";
import { NotificationCenter } from "../notifications/NotificationCenter";
import type { NotifyAction } from "../notifications/store";
import { ResizeDivider } from "./ResizeDivider";
import type { DatePreset } from "./FilterPanel";
import { CommentBackfillBanner } from "./CommentBackfillBanner";
import {
  beginSyncProgress,
  clearCommentBackfillProgress,
  endSyncProgress,
  setCommentBackfillProgress,
  updateSyncProgress,
} from "./progress";

const MAX_ERROR_LENGTH = 80;
/** Error text long enough to be a stack trace is useless in a notification card. */
const MAX_NOTIFY_DETAIL = 160;

function errorDetail(e: unknown): string {
  return String(e).slice(0, MAX_NOTIFY_DETAIL);
}

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
  onOpenNotifications: () => void;
  downloadActiveCount: number;
  downloadStatus: DownloadStatus;
  settingsErrorCount: number;
}

interface LibraryPanesProps {
  // Core library data + selection, needed by every layout — genuinely
  // cross-cutting, so left flat rather than forced into a group.
  creators: (Creator & { post_count: number })[];
  /** The classic list's current page (P1-5). The workbench queries its own
   * filmstrip index from `postsFilter` instead. */
  posts: Post[];
  postsTotal: number;
  page: number;
  onPageChange: (page: number) => void;
  /** Which posts the list is looking at — the workbench runs the same filter for
   * its filmstrip index, so both layouts agree on the set by construction. */
  postsFilter: PostsFilterOptions;
  /** Bumped to refresh the workbench index without changing the query (sync
   * finished, demo mode flipped). */
  reloadToken: number;
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
  /** Open a post by id — the workbench filmstrip and keyboard navigation only
   * hold ids (P1-5). */
  onSelectPostById: (postId: string) => void;
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
  creators, posts, postsTotal, page, onPageChange, postsFilter, reloadToken,
  selectedCreatorId, selectedPost, selectedPostAssets,
  creatorTab, mediaOrder, searchQuery, showStarred, clearingCreatorId,
  onCreatorTabChange, onMediaOrderChange, onSearch, onSelectCreator,
  onCreatorsUpdated, onDeleteCreator, onSelectStarred, onSelectPost, onSelectPostById, onOpenPost,
  onClearData, onToggleStar,
  postSync, imageDownload, filters, subscriptions, nav,
}: LibraryPanesProps) {
  // Spread the feature groups back to flat locals. The grouping is for the
  // interface and the call site; the render body below keeps reading the
  // individual values, so it doesn't change.
  const {
    syncingPosts, syncingCreatorId, maxPosts, syncMode,
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
    onOpenSettings, onOpenDownloads, onOpenSearch, onOpenFavorites, onOpenNotifications,
    downloadActiveCount, downloadStatus, settingsErrorCount,
  } = nav;

  const { settings, updateSettings } = useSettings();
  const [sidebarWidth, setSidebarWidth] = useState(settings.sidebar_width);
  const [postListWidth, setPostListWidth] = useState(settings.post_list_width);
  // P2-11: handed to the dividers so a drag resizes the pane by direct DOM
  // write instead of one setState per mousemove (see ResizeDivider).
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const postListPaneRef = useRef<HTMLDivElement | null>(null);

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
        postsFilter={postsFilter}
        reloadToken={reloadToken}
        selectedPost={selectedPost}
        selectedPostAssets={selectedPostAssets}
        onSelectPostById={onSelectPostById}
        onOpenPost={onOpenPost}
        onToggleStar={onToggleStar}
        onOpenSearch={onOpenSearch}
        onOpenFavorites={onOpenFavorites}
        onOpenDownloads={onOpenDownloads}
        onOpenSettings={onOpenSettings}
        onOpenNotifications={onOpenNotifications}
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
      <div ref={sidebarPaneRef} style={{ width: sidebarWidth, flexShrink: 0 }} className="h-full">
        <Sidebar
          creators={creators}
          selectedCreatorId={selectedCreatorId}
          onSelectCreator={onSelectCreator}
          onCreatorsUpdated={onCreatorsUpdated}
          onDeleteCreator={onDeleteCreator}
          onOpenSettings={onOpenSettings}
          onOpenDownloads={onOpenDownloads}
          onOpenSearch={onOpenSearch}
          onOpenNotifications={onOpenNotifications}
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
        paneRef={sidebarPaneRef}
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
      <div ref={postListPaneRef} style={{ width: postListWidth, flexShrink: 0 }} className="h-full">
        <PostList
          posts={posts}
          totalPosts={postsTotal}
          page={page}
          onPageChange={onPageChange}
          searchQuery={searchQuery}
          selectedPostId={selectedPost?.id || null}
          selectedCreator={creators.find(c => c.id === selectedCreatorId)}
          onShowMedia={() => onCreatorTabChange('media')}
          isSyncingPosts={syncingPosts && selectedCreatorId === syncingCreatorId}
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
        paneRef={postListPaneRef}
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
  // P0-3: the root subscribes only to the lightweight {activeCount, status}
  // summary, not the full per-job list. Progress events update a ref (no
  // re-render) and only a status/activeCount transition commits state — so the
  // ~66/sec progress storm no longer re-renders the whole app tree when the
  // Downloads page isn't even open. The full reactive list lives in
  // DownloadsView (mounted only while open).
  const { activeCount: downloadActiveCount, status: downloadStatus } = useDownloadSummary();
  const { unseenFailures } = useUnseenSyncFailures();
  const [initialSettings, setInitialSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [creators, setCreators] = useState<(Creator & { post_count: number })[]>([]);
  // P1-5: the classic list holds only the current page (`pagePosts`) plus the
  // total for the pager — the JS-side array is no longer the whole creator. The
  // workbench's filmstrip is a separate, much lighter query owned by
  // WorkbenchView itself (id/title/creator_id per post). A single full `posts`
  // array served both, so every creator switch, filter change and settled search
  // pulled the creator's entire post history over IPC.
  const [pagePosts, setPagePosts] = useState<Post[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [page, setPage] = useState(1);
  // Bumped by events that must refresh the list as it stands (a finished sync, a
  // demo-mode flip) without moving it back to page 1.
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);
  const [creatorTab, setCreatorTab] = useState<'posts' | 'media'>('posts');
  const [mediaOrder, setMediaOrder] = useState<'desc' | 'asc'>('desc');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [selectedPostAssets, setSelectedPostAssets] = useState<Asset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // The search box debounces inside PostList, where the input actually lives,
  // so this only ever receives a settled term — typing no longer re-renders the
  // root (and with it the sidebar, the reading pane and the filmstrip). It is
  // still the trigger for the query effect below, and the SQL side is still a
  // full-table scan per fire; P0-2 only trimmed the payload it returns.
  const [loading, setLoading] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notify = useNotify();
  // Not useTranslation(): this component *renders* SettingsProvider, so it sits
  // outside its own context and would always read DEFAULT_SETTINGS. Keying off
  // the settings it loaded itself makes these strings follow the saved language
  // (a live switch still only reaches them on the next launch).
  const t = translations[initialSettings.language ?? 'zh'];
  const [syncingPosts, setSyncingPosts] = useState(false);
  const [syncingCreatorId, setSyncingCreatorId] = useState<string | null>(null);
  const [syncingSubscriptions, setSyncingSubscriptions] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [migratingImages, setMigratingImages] = useState(false);
  const [subscriptionSyncStatus, setSubscriptionSyncStatus] = useState<string>("");
  const [clearingCreatorId, setClearingCreatorId] = useState<string | null>(null);
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

  /** Which posts the list is looking at. A stable identity per query, so it can
   * drive both the loader effect and the workbench's own index fetch. Declared
   * with the state it reads — the loader effects below depend on it. */
  const postsFilter = useMemo<PostsFilterOptions>(() => (
    showStarred
      ? { starred: true, search: searchQuery }
      : {
          creatorId: selectedCreatorId ?? undefined,
          search: searchQuery,
          tierFilter,
          dateFrom,
          dateTo,
        }
  ), [showStarred, searchQuery, selectedCreatorId, tierFilter, dateFrom, dateTo]);

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
    // Straight into the progress store, not into component state: a sync page's
    // progress now repaints just the two widgets that print the numbers.
    "sync-progress": (payload: { current: number; total: number }) => {
      updateSyncProgress(payload.current, payload.total);
    },
    "sync-complete": async (payload: { creator_id: string }) => {
      if (demoMode) return;
      console.log("Sync complete event received. Refreshing posts...");
      await loadCreators();
      // Reload the posts that changed underneath: new posts land at the top of
      // the newest-first order, and both layouts refresh off this token (the
      // workbench's filmstrip index is its own query now, not a prop).
      setReloadToken(n => n + 1);
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
    // The one place per-file failures surface. A batch can fail dozens of files,
    // so they all share a dedupe key and arrive as one card with a count.
    "download-job-update": (job: { status: string; error: string | null; creator_id?: string }) => {
      if (job.status !== 'failed') return;
      notify({
        severity: 'error',
        title: t.notifications.imageDownloadFailed,
        detail: job.error ? job.error.slice(0, MAX_NOTIFY_DETAIL) : undefined,
        source: creators.find(c => c.id === job.creator_id)?.name,
        dedupeKey: 'download-job-failed',
        action: { kind: 'open-downloads' },
      });
    },
    // Same reasoning: the backfill reports twice a second for tens of minutes,
    // and this used to repaint the whole library tree on each report.
    "comment-backfill-progress": (payload: { done: number; total: number }) => {
      setCommentBackfillProgress(payload.done, payload.total);
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
    // The filter effect below already reloads for the creator change; the token
    // covers the case where the selection was already null and only demo mode
    // flipped (nothing else in the query would have changed).
    setReloadToken(t => t + 1);
  }, [demoMode]);

  // A new query always starts at its first page. Changing the page number lives
  // in its own effect below, so paging doesn't drop the open post the way
  // switching creator or searching does.
  useEffect(() => {
    if (loading) return;
    // Not while an open is in flight: that post belongs to this new query.
    if (!postOpenInFlightRef.current) setSelectedPost(null);
    setPage(1);
    loadPosts(1).catch(console.error);
    // `postsFilter` is a stable identity per query (it is rebuilt from the same
    // six values the old deps list spelled out), and `searchQuery` is already the
    // settled term — PostList debounces at the input (P0-2). `reloadToken` rides
    // along for refreshes that leave the query alone (a demo-mode flip); those
    // land on page 1 too, which is where new content is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postsFilter, loading, reloadToken]);

  // Paging within the current query. Page 1 is the effect above's job, so this
  // one never double-loads on mount or after a reset.
  useEffect(() => {
    if (loading || page === 1) return;
    loadPosts(page).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Safety net for the creator-change resets: every site that selects a creator
  // also clears the filters synchronously (see clearFilters), so this only
  // catches a stray setter. Values are already cleared, so it costs no render.
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

  // Stable identity — it only reads a ref and a setter — for the handlers that
  // depend on it (delete, subscription sync) and for the sidebar's prop.
  const loadCreators = useCallback(async () => {
    if (demoModeRef.current) {
      setCreators(DEMO_CREATORS);
      return;
    }
    const data = await getCreators();
    if (demoModeRef.current) return; // mode flipped to demo while this was in flight — discard stale real data
    setCreators(data);
  }, []);

  // Stable across unrelated re-renders — the identity only moves when the
  // selection or a running image download changes, which is what lets the
  // memoized sidebar rows skip.
  const handleDeleteCreator = useCallback(async (id: string) => {
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
  }, [demoMode, loadCreators, selectedCreatorId, syncingImagesCreatorId]);

  // Tier/date filters are persisted app-wide, so they must not follow the user
  // onto a different creator's posts. Cleared wherever the creator changes — not
  // only in the creator-change effect below, which commits a render too late for
  // the query that render already kicked off.
  const clearFilters = useCallback(() => {
    setTierFilter(null);
    setDatePreset('all');
    setDateFrom(null);
    setDateTo(null);
  }, []);

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
      // The creator's posts are gone: reload the list and the workbench index.
      setReloadToken(n => n + 1);
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
      // No explicit refresh needed: start_downloads emits download-job-update as
      // it enqueues each job, and useDownloadSummary (the root's only download
      // subscription) updates the sidebar badge from those events. The full job
      // list re-seeds itself when the Downloads page is opened.
    } catch (e) {
      console.error('Failed to start downloads:', e);
      notify({
        severity: 'error',
        title: t.notifications.imageDownloadFailed,
        detail: errorDetail(e),
        source: creators.find(c => c.id === selectedCreatorId)?.name,
        dedupeKey: `image-download:${selectedCreatorId}`,
        action: { kind: 'open-downloads' },
      });
    }
  };

  // Fresh sync and resume-from-checkpoint are the same run with three
  // differences, so they share one body: resume seeds progress from the
  // checkpoint, and takes its mode + cursor from it instead of the current UI
  // state. A fresh sync also forwards the incremental toggle, which resume
  // deliberately doesn't — resuming continues an existing crawl, where flipping
  // incremental mid-stream has no meaning.
  /**
   * Fetch comments for a creator's posts in one batched pass.
   *
   * `onlyMissing` is what a post-sync uses: it skips posts already cached, so
   * the cost is proportional to what the sync actually brought in rather than
   * to the whole archive. Passing false re-fetches everything, which is what the
   * manual "backfill all" action wants.
   *
   * Best-effort — a comment failure must not fail the sync that triggered it.
   */
  const backfillComments = async (creatorId: string, onlyMissing: boolean) => {
    if (demoMode) return;
    try {
      const ids = await getPostIdsForComments(creatorId, onlyMissing);
      if (ids.length === 0) return;
      setCommentBackfillProgress(0, ids.length);
      await invoke<number>('fetch_comments_for_posts', { postIds: ids });
    } catch (e) {
      console.error('Comment backfill failed:', e);
      notify({
        severity: 'warning',
        title: t.notifications.commentFetchFailed,
        detail: errorDetail(e),
        source: creators.find(c => c.id === creatorId)?.name,
        dedupeKey: `comment-fetch:${creatorId}`,
      });
    } finally {
      clearCommentBackfillProgress();
    }
  };

  /**
   * One-off backfill across every creator, for posts with no cached comments.
   * Kept as an explicit command rather than something a sync triggers: with a
   * few thousand posts this runs for tens of minutes and keeps hitting Patreon,
   * so it should be a deliberate choice.
   */
  const backfillAllComments = async () => {
    if (demoMode) return;
    try {
      const ids = await getAllPostIdsMissingComments();
      if (ids.length === 0) return;
      setCommentBackfillProgress(0, ids.length);
      await invoke<number>('fetch_comments_for_posts', { postIds: ids });
      // This one runs for tens of minutes with nobody watching, so its result
      // is worth a notification even when it succeeds.
      notify({
        severity: 'success',
        title: t.notifications.commentFetchDone(ids.length),
        dedupeKey: 'comment-backfill-all',
      });
    } catch (e) {
      console.error('Comment backfill failed:', e);
      notify({
        severity: 'error',
        title: t.notifications.commentFetchFailed,
        detail: errorDetail(e),
        dedupeKey: 'comment-backfill-all',
      });
    } finally {
      clearCommentBackfillProgress();
      // Reflect newly-cached comments in whatever post is open.
      if (selectedPost) loadAssets(selectedPost.id);
    }
  };

  const runSyncPosts = async (checkpoint: SyncCheckpoint | null) => {
    if (demoMode || !selectedCreatorId || syncingPosts) return;
    const creator = creators.find(c => c.id === selectedCreatorId);
    if (!creator?.profile_url) return;

    setSyncingPosts(true);
    setSyncingCreatorId(selectedCreatorId);
    beginSyncProgress(checkpoint ? checkpoint.posts_done : 0);
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
      // Refresh both layouts off the token: the classic list reloads its page and
      // the workbench its filmstrip index (which is no longer a prop).
      setReloadToken(n => n + 1);
      await loadCreators();
      // Pull comments for the posts this sync brought in. Only the ones with no
      // cached comments, so a repeat sync doesn't refetch the whole archive; the
      // comments panel's Refresh button still forces a single post.
      await backfillComments(creator.id, true);
      // Full mode: always auto-trigger images after sync batch completes.
      // Don't gate on checkpoint: with small maxPosts a checkpoint always exists, but
      // user still expects the current batch's images to download automatically.
      if (syncMode === 'full') {
        await handleSyncImages();
      }
    } catch (e) {
      console.error(checkpoint ? 'Failed to resume posts:' : 'Failed to sync posts:', e);
      notify({
        severity: 'error',
        title: t.notifications.postSyncFailed,
        detail: errorDetail(e),
        source: creator.name,
        dedupeKey: `post-sync:${creator.id}`,
        action: { kind: 'open-creator', payload: { creatorId: creator.id } },
      });
    } finally {
      setSyncingPosts(false);
      setSyncingCreatorId(null);
      endSyncProgress();
    }
  };

  const handleSyncPosts = () => runSyncPosts(null);

  /** Maps a notification's serialisable action ref onto real navigation. */
  const handleNotificationAction = (action: NotifyAction) => {
    switch (action.kind) {
      case 'open-downloads':
        setView('downloads');
        break;
      case 'open-creator': {
        const id = action.payload?.creatorId;
        if (typeof id === 'string') {
          setView('library');
          handleSelectCreator(id);
        }
        break;
      }
      case 'open-settings':
        handleOpenSettings();
        break;
    }
  };

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

  // Both of these only touch setters, so their identity is stable for the life
  // of the view — the memoized sidebar rows depend on that.
  const handleSelectCreator = useCallback((id: string | null) => {
    setSelectedCreatorId(id);
    setCreatorTab('posts');
    setSearchQuery("");
    setShowStarred(false);
    setImageFailedCount(0);
    clearFilters();
  }, [clearFilters]);

  // "Starred" now opens the unified Favorites page (starred posts + favourited
  // images) rather than filtering the classic post list in place.
  const handleSelectStarred = useCallback(() => {
    setShowStarred(false);
    setSelectedPost(null);
    setView('favorites');
  }, []);

  const handleToggleStar = async (post: Post, newStarred: boolean) => {
    if (demoMode) return;
    try {
      await toggleStarPost(post.id, newStarred);
    } catch (e) {
      console.error('Failed to toggle star:', e);
      return;
    }
    const updated = { ...post, is_starred: newStarred ? 1 : 0 };
    // Only the classic page rows and the open post render a star. In the
    // workbench the filmstrip's index carries no is_starred (nothing there shows
    // one), so `pagePosts` is empty and this is just the reading pane's badge.
    setPagePosts(prev => showStarred && !newStarred
      ? prev.filter(p => p.id !== post.id)
      : prev.map(p => p.id === post.id ? updated : p)
    );
    // Unstarring inside the starred query removes a row from the result set.
    if (showStarred && !newStarred) setPostsTotal(n => Math.max(0, n - 1));
    if (selectedPost?.id === post.id) setSelectedPost(updated);
  };

  const handleSyncSubscriptions = useCallback(async () => {
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
        notify({
          severity: 'error',
          title: t.notifications.subscriptionSyncFailed,
          detail: errorDetail(e),
          dedupeKey: 'subscription-sync',
        });
      }
    } catch (e: any) {
      setSubscriptionSyncStatus(t.sidebar.statusError(String(e).substring(0, MAX_ERROR_LENGTH)));
      notify({
        severity: 'error',
        title: t.notifications.subscriptionSyncFailed,
        detail: errorDetail(e),
        dedupeKey: 'subscription-sync',
      });
    } finally {
      setSyncingSubscriptions(false);
      setTimeout(() => setSubscriptionSyncStatus(""), 8000);
    }
  }, [demoMode, loadCreators, notify, syncingSubscriptions, t]);

  // Guards against a superseded load overwriting a newer one: a filter change
  // while the list sits on page 3 commits a page-1 load in the same effect phase
  // as the page-3 one it replaces, and creator switching has always been able to
  // interleave two loads.
  const postsLoadSeq = useRef(0);

  // The classic list's page, loaded for the current query regardless of layout.
  // Deliberate: the root can't see the live layout_mode (settings live inside the
  // SettingsProvider this component renders), and one page + its COUNT is two
  // bounded queries — far cheaper than the workbench having to reach back up for
  // its filmstrip. The workbench's index is its own query inside WorkbenchView.
  async function loadPosts(targetPage: number) {
    const seq = ++postsLoadSeq.current;
    if (demoModeRef.current) {
      // Demo data is a local array, so pagination is simulated here rather than
      // in SQL — same page shape, no IPC round trip.
      const all = getDemoPosts(showStarred ? undefined : (selectedCreatorId ?? undefined), showStarred);
      setPostsTotal(all.length);
      setPagePosts(all.slice((targetPage - 1) * POSTS_PER_PAGE, targetPage * POSTS_PER_PAGE));
      return;
    }
    const { posts: rows, total } = await getPostsPage(postsFilter, (targetPage - 1) * POSTS_PER_PAGE, POSTS_PER_PAGE);
    if (seq !== postsLoadSeq.current || demoModeRef.current) return;
    setPagePosts(rows);
    setPostsTotal(total);
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

  // Opening a post resolves it by id instead of searching a loaded array: the
  // target may not be in the current page, and in the workbench layout the list
  // is only an index. Both entry points share one sequence so the newest
  // selection wins — holding ← in the filmstrip fires a getPostById per keypress
  // and the responses can land out of order (P1-5); a synchronous click also
  // invalidates any async open still in flight.
  const selectedPostSeq = useRef(0);
  // True while a getPostById is resolving. The query effect below clears the
  // selection on a query change (switching creator closes the old post), but an
  // open that was requested in the same tick belongs to the *new* query — e.g. a
  // ⌘K jump changes the creator and asks for a post, and the reset would
  // otherwise wipe the post the moment it arrived.
  const postOpenInFlightRef = useRef(false);
  const selectPost = useCallback((post: Post) => {
    selectedPostSeq.current++;
    postOpenInFlightRef.current = false;
    setSelectedPost(post);
  }, []);
  const selectPostById = useCallback((postId: string) => {
    const seq = ++selectedPostSeq.current;
    postOpenInFlightRef.current = true;
    getPostById(postId)
      .then(post => {
        if (seq !== selectedPostSeq.current) return;
        postOpenInFlightRef.current = false;
        if (post) setSelectedPost(post);
      })
      .catch(e => {
        postOpenInFlightRef.current = false;
        console.error('Failed to open post:', e);
      });
  }, []);

  // Navigate to a specific post from outside the list (search result, favourites
  // list, timeline, palette): select its creator, then open the post itself.
  const handleOpenPost = (creatorId: string, postId: string) => {
    setShowStarred(false);
    setSearchQuery("");
    clearFilters();
    setSelectedCreatorId(creatorId);
    setView('library');
    selectPostById(postId);
  };

  const handleOpenSearchResult = (result: SearchResult) => handleOpenPost(result.creator_id, result.post_id);

  const handleOpenSettings = useCallback(() => {
    // Land directly on Sync History when there are unseen sync failures.
    setSettingsInitialSection(unseenFailures > 0 ? 'history' : 'account');
    setView('settings');
  }, [unseenFailures]);

  // These three go into the rail/sidebar as props, so they need stable
  // identities for the memoized rail to hold.
  const handleOpenDownloads = useCallback(() => setView('downloads'), []);
  const handleOpenSearch = useCallback(() => setView('search'), []);
  const handleOpenNotifications = useCallback(() => setNotificationsOpen(o => !o), []);

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
    // Re-fetch comments for every post of the current creator, including ones
    // already cached — for picking up replies posted since the last sync.
    ...(selectedCreatorId ? [{
      id: 'backfill-comments',
      label: t.commandPalette.cmdBackfillComments,
      run: () => { void backfillComments(selectedCreatorId, false); },
    }] : []),
    {
      id: 'backfill-comments-all',
      label: t.commandPalette.cmdBackfillCommentsAll,
      run: () => { void backfillAllComments(); },
    },
  ];

  const handlePaletteSelectCreator = (id: string) => {
    setShowStarred(false);
    setSearchQuery("");
    clearFilters();
    setSelectedCreatorId(id);
    setView('library');
  };

  // Resolve a creator id to its display name. Built once per creators change
  // instead of a fresh arrow per render: DownloadsView's rows are memoised, and
  // an unstable `creatorName` prop re-rendered every row on every progress event
  // — the lookup itself was an O(creators) `find` per row, per render.
  const creatorNameById = useMemo(() => {
    const map = new Map(creators.map(c => [c.id, c.name]));
    return (id: string) => map.get(id) ?? id;
  }, [creators]);

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
        {/* Inside SettingsProvider so these read the live language, unlike the
            notification text raised above, which is fixed at load time. */}
        <ToastStack onAction={handleNotificationAction} />
        <NotificationCenter
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
          onAction={handleNotificationAction}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          creators={creators}
          commands={paletteCommands}
          onSelectCreator={handlePaletteSelectCreator}
          onOpenPost={handleOpenSearchResult}
        />
        <CommentBackfillBanner />
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
            onClose={() => setView('library')}
            creatorName={creatorNameById}
          />
        ) : view === 'search' ? (
          <SearchView
            onClose={() => setView('library')}
            onOpenResult={handleOpenSearchResult}
          />
        ) : (
          <LibraryPanes
            creators={creators}
            posts={pagePosts}
            postsTotal={postsTotal}
            page={page}
            onPageChange={setPage}
            postsFilter={postsFilter}
            reloadToken={reloadToken}
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
            onSelectPost={selectPost}
            onSelectPostById={selectPostById}
            onOpenPost={handleOpenPost}
            onClearData={handleClearData}
            onToggleStar={handleToggleStar}
            postSync={{
              syncingPosts, syncingCreatorId, maxPosts,
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
              onOpenDownloads: handleOpenDownloads,
              onOpenSearch: handleOpenSearch,
              onOpenFavorites: handleSelectStarred,
              onOpenNotifications: handleOpenNotifications,
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
