import { Creator, Post, SyncCheckpoint } from "../../types/db";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Image as ImageIcon, Download, ImageDown, Loader2, ChevronLeft, ChevronRight, Trash2, Star, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, useEffect, useRef } from "react";
import { formatPostDate } from "../../lib/formatDate";
import { FilterPanel } from "./FilterPanel";
import type { DatePreset } from "./FilterPanel";
import { useTranslation } from "../../lib/i18n";

const POSTS_PER_PAGE = 20;

// Prominent sync-progress row shown at the top of the post panel while a post
// sync or image download runs. Handles the indeterminate case (total unknown,
// e.g. incremental post sync) with a sliding bar instead of a fake percentage.
function EnhancedSyncBar({ phase, progress, total }: { phase: 'posts' | 'images'; progress: number; total: number }) {
  const t = useTranslation();
  const indeterminate = total <= 0;
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, (progress / total) * 100));
  const isPosts = phase === 'posts';
  const color = isPosts ? 'bg-blue-500' : 'bg-emerald-500';
  return (
    <div className="px-4 py-2.5 border-b bg-muted/40">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${isPosts ? 'text-blue-500' : 'text-emerald-500'}`} />
          <span className="text-xs font-medium truncate">
            {isPosts ? t.postList.syncingPostsLabel : t.postList.downloadingImagesLabel}
          </span>
        </div>
        <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
          {/* When the total is unknown, show the running count only once it's
              moving — a lone "0" next to a sliding bar reads as "stuck". */}
          {indeterminate ? (progress > 0 ? progress : '') : `${progress} / ${total}`}
          {!indeterminate && <span className="ml-2 font-semibold text-foreground">{Math.round(pct)}%</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        {indeterminate ? (
          <div
            className={`h-full w-1/3 rounded-full ${color}`}
            style={{ animation: 'sync-indeterminate 1.4s ease-in-out infinite' }}
          />
        ) : (
          <div
            className={`h-full rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

interface PostListProps {
  posts: Post[];
  searchQuery: string;
  selectedPostId: string | null;
  selectedCreator?: Creator & { post_count: number };
  isSyncingPosts?: boolean;
  syncProgress?: number;
  syncTotal?: number;
  maxPosts: number;
  onMaxPostsChange: (n: number) => void;
  onSearch: (q: string) => void;
  onSelectPost: (post: Post) => void;
  onSyncPosts?: () => void;
  onClearData?: () => Promise<void>;
  isClearingData?: boolean;
  onSyncImages?: () => Promise<void>;
  isSyncingImages?: boolean;
  imageProgress?: number;
  imageTotal?: number;
  // Sync mode
  syncMode?: 'normal' | 'full';
  onSyncModeChange?: (mode: 'normal' | 'full') => void;
  incrementalSync?: boolean;
  onIncrementalSyncChange?: (v: boolean) => void;
  // Pause / cancel / resume — posts
  onPausePosts?: () => void;
  onCancelPosts?: () => void;
  onResumePosts?: () => void;
  // Pause / cancel — images
  onPauseImages?: () => void;
  onCancelImages?: () => void;
  // Checkpoint state
  postCheckpoint?: SyncCheckpoint | null;
  isImagesPaused?: boolean;
  imagesDoneCount?: number;
  imageFailedCount?: number;
  showStarred?: boolean;
  onToggleStar?: (post: Post, newStarred: boolean) => void;
  tierFilter?: number | null;
  datePreset?: DatePreset;
  dateFrom?: string | null;
  dateTo?: string | null;
  distinctTiers?: number[];
  onTierChange?: (v: number | null) => void;
  onDatePresetChange?: (preset: DatePreset) => void;
  onDateRangeChange?: (from: string | null, to: string | null) => void;
  onShowMedia?: () => void;
}

export function PostList({
  posts,
  searchQuery,
  selectedPostId,
  selectedCreator,
  isSyncingPosts,
  syncProgress = 0,
  syncTotal = 0,
  maxPosts,
  onMaxPostsChange,
  onSearch,
  onSelectPost,
  onSyncPosts,
  onClearData,
  isClearingData,
  onSyncImages,
  isSyncingImages,
  imageProgress = 0,
  imageTotal = 0,
  syncMode = 'normal',
  onSyncModeChange,
  incrementalSync = false,
  onIncrementalSyncChange,
  onPausePosts,
  onCancelPosts,
  onResumePosts,
  onPauseImages,
  onCancelImages,
  postCheckpoint,
  isImagesPaused = false,
  imagesDoneCount = 0,
  imageFailedCount = 0,
  showStarred = false,
  onToggleStar,
  tierFilter = null,
  datePreset = 'all',
  dateFrom = null,
  dateTo = null,
  distinctTiers = [],
  onTierChange,
  onDatePresetChange,
  onDateRangeChange,
  onShowMedia,
}: PostListProps) {
  const t = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [maxPostsInput, setMaxPostsInput] = useState(String(maxPosts));
  const [pageJumpInput, setPageJumpInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const isActive = tierFilter !== null || dateFrom !== null || dateTo !== null;
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const postsPerPage = POSTS_PER_PAGE;

  const modeLabel = (m: 'normal' | 'full') => {
    if (m === 'full') return t.postList.modeFull;
    return t.postList.modeNormal;
  };

  // Reset pagination when searching or changing creator/filters
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCreator?.id, showStarred, tierFilter, datePreset, dateFrom, dateTo]);

  // Close filter panel only when creator or starred view changes
  useEffect(() => {
    setFilterOpen(false);
  }, [selectedCreator?.id, showStarred]);

  // Sync local input when maxPosts prop changes externally
  useEffect(() => {
    setMaxPostsInput(String(maxPosts));
  }, [maxPosts]);

  // Close mode dropdown when clicking outside
  useEffect(() => {
    if (!showModeMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showModeMenu]);

  const commitMaxPosts = () => {
    const val = parseInt(maxPostsInput);
    if (!isNaN(val) && val >= 1) {
      onMaxPostsChange(val);
    } else {
      setMaxPostsInput(String(maxPosts));
    }
  };

  const commitPageJump = () => {
    const val = parseInt(pageJumpInput);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setCurrentPage(val);
    }
    setPageJumpInput("");
  };

  const totalPages = Math.ceil(posts.length / postsPerPage);
  const displayPosts = posts.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage);

  return (
    <div className="w-full flex flex-col h-full bg-background relative">
      <div className="p-4 border-b space-y-3 z-10 bg-background">
        {showStarred ? (
          <div className="flex items-center gap-2 pb-1">
            <Star className="h-4 w-4 fill-star text-star" />
            <span className="font-semibold text-sm">{t.postList.starredHeading(posts.length)}</span>
          </div>
        ) : selectedCreator && (
          <div className="flex items-center justify-between pb-1 gap-1.5 flex-wrap">
            <h2 className="font-serif text-lg font-semibold truncate pr-1 min-w-0">{selectedCreator.name}</h2>

            {/* Posts | Media view toggle */}
            <div className="h-7 flex items-center border rounded text-xs bg-background overflow-hidden flex-shrink-0">
              <button className="px-2.5 h-full flex items-center gap-1 bg-secondary text-secondary-foreground font-medium">
                <FileText className="h-3.5 w-3.5" />
                {t.mediaView.postsTab}
              </button>
              <button
                onClick={onShowMedia}
                className="px-2.5 h-full flex items-center gap-1 text-muted-foreground hover:bg-muted/50 transition-colors"
                title={t.mediaView.mediaTab}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {t.mediaView.mediaTab}
              </button>
            </div>

            <div className="flex-1 min-w-0" />

            {/* === POST SYNCING STATE === */}
            {isSyncingPosts && (
              <>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t.postList.syncingLabel(
                    syncMode === 'full' ? t.postList.modeFullBare : t.postList.modeNormalBare,
                    syncProgress,
                    syncTotal > 0 ? String(syncTotal) : '...'
                  )}
                </span>
                <Button size="sm" variant="secondary" onClick={onPausePosts} className="h-7 text-xs px-2">{t.postList.pause}</Button>
                <Button size="sm" variant="outline" onClick={onCancelPosts} className="h-7 text-xs px-2 text-destructive border-destructive hover:bg-destructive/10">{t.postList.cancel}</Button>
              </>
            )}

            {/* === IMAGE DOWNLOADING STATE === */}
            {!isSyncingPosts && isSyncingImages && (
              <>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t.postList.downloadingImages(imageProgress, imageTotal > 0 ? String(imageTotal) : '...')}
                </span>
                <Button size="sm" variant="secondary" onClick={onPauseImages} className="h-7 text-xs px-2">{t.postList.pause}</Button>
                <Button size="sm" variant="outline" onClick={onCancelImages} className="h-7 text-xs px-2 text-destructive border-destructive hover:bg-destructive/10">{t.postList.cancel}</Button>
              </>
            )}

            {/* === IDLE STATE (no active sync) === */}
            {!isSyncingPosts && !isSyncingImages && (
              <>
                <input
                  type="number"
                  min={1}
                  value={maxPostsInput}
                  onChange={e => setMaxPostsInput(e.target.value)}
                  onBlur={commitMaxPosts}
                  onKeyDown={e => e.key === 'Enter' && commitMaxPosts()}
                  className="h-7 w-14 text-xs px-1.5 border rounded bg-background text-center flex-shrink-0"
                  title={t.postList.maxPostsTooltip}
                />

                <label
                  className="flex items-center gap-1 h-7 px-1.5 text-xs text-muted-foreground flex-shrink-0 cursor-pointer select-none"
                  title={t.postList.onlyNewPostsTooltip}
                >
                  <input
                    type="checkbox"
                    checked={incrementalSync}
                    onChange={e => onIncrementalSyncChange?.(e.target.checked)}
                    className="h-3 w-3"
                  />
                  {t.postList.onlyNewPosts}
                </label>

                {/* Split mode+sync button: left = execute sync, right (▾) = switch mode */}
                <div className="relative flex-shrink-0" ref={modeMenuRef}>
                  <div className="h-7 flex items-center border rounded text-xs bg-background overflow-hidden">
                    <button
                      onClick={postCheckpoint ? undefined : onSyncPosts}
                      disabled={!postCheckpoint && (isClearingData || isSyncingImages)}
                      className={`px-2 flex items-center gap-1 h-full transition-colors
                        ${!postCheckpoint
                          ? 'text-foreground hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
                          : 'text-muted-foreground cursor-default select-none'
                        }`}
                    >
                      {!postCheckpoint && <Download className="h-3 w-3" />}
                      {modeLabel(syncMode)}
                    </button>
                    <button
                      onClick={() => setShowModeMenu(m => !m)}
                      className="px-1.5 border-l text-muted-foreground hover:bg-muted/50 transition-colors h-full"
                    >
                      ▾
                    </button>
                  </div>
                  {showModeMenu && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-popover border rounded shadow-md w-48 py-1">
                      {(['normal', 'full'] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => { onSyncModeChange?.(m); setShowModeMenu(false); }}
                          className={`w-full flex justify-between items-center px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${syncMode === m ? 'font-semibold' : ''}`}
                        >
                          <span>{modeLabel(m)}{syncMode === m ? ' ✓' : ''}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {m === 'full' ? t.postList.modeFullDesc : t.postList.modeNormalDesc}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Post checkpoint: resume or fresh sync */}
                {postCheckpoint && (
                  <>
                    <Button
                      size="sm"
                      onClick={onResumePosts}
                      disabled={isClearingData || isSyncingImages}
                      className="h-7 text-xs px-2 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {t.postList.resume(postCheckpoint.posts_done)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onSyncPosts}
                      disabled={isClearingData || isSyncingImages}
                      className="h-7 text-xs px-2 text-muted-foreground"
                    >
                      {t.postList.resync}
                    </Button>
                  </>
                )}

                {/* Images button or resume-download button */}
                {isImagesPaused ? (
                  <Button
                    size="sm"
                    onClick={onSyncImages}
                    disabled={isClearingData}
                    className="h-7 text-xs px-2 bg-green-700 hover:bg-green-800 text-white"
                  >
                    {t.postList.resumeDownload(imagesDoneCount, imageTotal > 0 ? String(imageTotal) : '...')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onSyncImages}
                    disabled={isClearingData}
                    className="h-7 text-xs px-2"
                  >
                    <ImageDown className="h-3 w-3 mr-1" />
                    {t.postList.assets}
                  </Button>
                )}

                {imageFailedCount > 0 && (
                  <span className="text-xs text-destructive whitespace-nowrap">
                    {t.postList.failedCount(imageFailedCount)}
                  </span>
                )}

                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => { setClearError(null); setConfirmOpen(true); }}
                  disabled={isClearingData}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                  title={t.postList.clearDataTooltip}
                >
                  {isClearingData
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Trash2 className="h-3 w-3" />
                  }
                </Button>
              </>
            )}
          </div>
        )}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t.postList.searchPlaceholder}
              className="pl-9"
              value={searchQuery}
              onChange={e => onSearch(e.target.value)}
            />
          </div>
          {!showStarred && selectedCreator && (
            <button
              onClick={() => setFilterOpen(o => !o)}
              className={`flex-shrink-0 text-xs px-2.5 py-1.5 rounded border transition-colors ${
                isActive
                  ? 'border-primary text-primary bg-primary/10 hover:bg-primary/20'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {t.postList.filter}{isActive ? ' ●' : ''}
            </button>
          )}
        </div>
        {filterOpen && selectedCreator && !showStarred && onTierChange && onDatePresetChange && onDateRangeChange && (
          <FilterPanel
            tierFilter={tierFilter ?? null}
            datePreset={datePreset ?? 'all'}
            dateFrom={dateFrom ?? null}
            dateTo={dateTo ?? null}
            distinctTiers={distinctTiers ?? []}
            onTierChange={onTierChange}
            onDatePresetChange={onDatePresetChange}
            onDateRangeChange={onDateRangeChange}
          />
        )}
        {isSyncingPosts ? (
          <EnhancedSyncBar phase="posts" progress={syncProgress} total={syncTotal} />
        ) : isSyncingImages ? (
          <EnhancedSyncBar phase="images" progress={imageProgress} total={imageTotal} />
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col divide-y pb-20">
          {posts.length === 0 ? (
            <div className="p-8 flex flex-col items-center text-center text-muted-foreground mt-10">
              <ImageIcon className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium mb-1">
                {showStarred ? t.postList.noStarredPosts : selectedCreator ? t.postList.noPostsFound : t.postList.selectCreator}
              </p>
              <p className="text-xs mb-6 max-w-[200px]">
                {showStarred
                  ? t.postList.starredEmptyHint
                  : selectedCreator
                    ? t.postList.notSyncedHint
                    : t.postList.chooseCreatorHint}
              </p>
              {selectedCreator && !showStarred && (
                <div className="flex flex-col w-full items-center">
                  <Button
                    onClick={onSyncPosts}
                    disabled={isSyncingPosts || isClearingData || isSyncingImages}
                    variant="outline"
                    className="w-full mb-3"
                  >
                    {isSyncingPosts ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {isSyncingPosts ? t.postList.syncing : t.postList.syncNow}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            displayPosts.map(post => (
              <div
                key={post.id}
                onClick={() => onSelectPost(post)}
                className={`text-left p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                  selectedPostId === post.id ? "bg-muted" : ""
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-serif text-[15px] font-semibold line-clamp-2 leading-snug flex-1 pr-2">
                    {post.title}
                  </h3>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {post.read_state === 'unread' && (
                      <span className="h-2 w-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    )}
                    {onToggleStar && (
                      <button
                        type="button"
                        aria-label={post.is_starred ? t.postList.removeFromStarred : t.postList.addToStarred}
                        aria-pressed={!!post.is_starred}
                        className="p-1 rounded hover:bg-muted transition-colors flex-shrink-0"
                        onClick={e => { e.stopPropagation(); onToggleStar(post, post.is_starred === 0); }}
                      >
                        <Star
                          className={`h-3.5 w-3.5 transition-colors ${
                            post.is_starred
                              ? "fill-star text-star"
                              : "text-muted-foreground opacity-40 hover:opacity-70"
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                  <span className="truncate pr-2 post-byline">{post.creator_name}</span>
                  <span className="whitespace-nowrap flex-shrink-0">
                    {formatPostDate(post.published_at, t.common.unknownDate)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  {post.excerpt || post.content_raw?.substring(0, 100)}
                </p>
                {post.has_assets > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 asset-chip">
                    <ImageIcon className="h-3 w-3 mr-1" />
                    {t.postList.assets}
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {totalPages > 1 && (
        <div className="p-3 border-t bg-background flex items-center justify-between text-sm text-muted-foreground z-10 absolute bottom-0 w-full shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="h-8 px-2"
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> {t.postList.prev}
          </Button>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-xs">{currentPage}</span>
            <span className="text-xs">/</span>
            <span className="font-medium text-xs">{totalPages}</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageJumpInput}
              placeholder="#"
              onChange={e => setPageJumpInput(e.target.value)}
              onBlur={commitPageJump}
              onKeyDown={e => e.key === 'Enter' && commitPageJump()}
              className="h-6 w-10 text-xs px-1 border rounded bg-background text-center ml-1"
              title={t.postList.jumpToPageTooltip}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="h-8 px-2"
          >
            {t.postList.next} <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setClearError(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t.postList.clearDataTitle(selectedCreator?.name)}
            </DialogTitle>
            <DialogDescription>
              {t.postList.clearDataDesc(selectedCreator?.post_count ?? 0)}
            </DialogDescription>
          </DialogHeader>
          {clearError && (
            <p className="text-sm text-destructive">{clearError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isClearingData}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={isClearingData}
              onClick={async () => {
                setClearError(null);
                try {
                  await onClearData?.();
                  setCurrentPage(1);
                  setConfirmOpen(false);
                } catch (e) {
                  setClearError(String(e));
                }
              }}
            >
              {isClearingData && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t.postList.clearDataConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
