import { memo, useMemo } from "react";
import { Creator } from "../../types/db";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Settings, History, RefreshCw, Loader2, Star, Bell } from "lucide-react";
import { useUnreadCount } from "../notifications/NotificationContext";
import { DownloadStatusIcon } from "../downloads/DownloadStatusIcon";
import type { DownloadStatus } from "../downloads/useDownloadJobs";
import { useTranslation } from "../../lib/i18n";
import type { Translations } from "../../lib/i18n";
import { sortRailCreators } from "../library/creatorSort";

/** Currently subscribed with a paid tier → gold glow + float-to-top, same
 *  rule as the classic sidebar's. A cancelled paid sub keeps
 *  subscription_type='paid' historically but is_subscribed=0 → no glow. */
function isPaidActive(c: Creator): boolean {
  return c.is_subscribed === 1 && c.subscription_type === "paid";
}

interface IconRailProps {
  creators: (Creator & { post_count: number })[];
  selectedCreatorId: string | null;
  onSelectCreator: (id: string) => void;
  onOpenSearch: () => void;
  onOpenFavorites: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  onOpenTimeline: () => void;
  onSyncSubscriptions: () => void;
  syncingSubscriptions: boolean;
  timelineActive: boolean;
  downloadStatus: DownloadStatus;
  downloadActiveCount: number;
  settingsErrorCount: number;
}

/**
 * One avatar in the rail. Memoized because switching creator re-renders the
 * rail and only two avatars actually change (`active`); with a long
 * subscription list that is the difference between two elements and N.
 * All props except `active` keep their identity between selections.
 */
const RailCreatorButton = memo(function RailCreatorButton({
  creator,
  active,
  onSelect,
  t,
}: {
  creator: Creator & { post_count: number };
  active: boolean;
  onSelect: (id: string) => void;
  t: Translations;
}) {
  const paid = isPaidActive(creator);
  return (
    <button
      onClick={() => onSelect(creator.id)}
      title={`${creator.name} · ${creator.post_count}${paid ? ` · ${t.sidebar.paidTag}` : ""}`}
      className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {active && <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-primary" />}
      <Avatar className={`h-9 w-9 transition-shadow creator-avatar${paid ? " creator-avatar-paid" : ""} ${active ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"}`}>
        <AvatarImage src={creator.avatar_path || undefined} />
        <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
      </Avatar>
    </button>
  );
});

/**
 * The Workbench's slim left rail: creator avatars (pinned first, active ringed)
 * over a scroll area, with search / downloads / settings at the bottom. Names
 * live in tooltips; ⌘K (a later phase) covers fast switching for long lists.
 *
 * Memoized: every prop is a stable callback, a stable list or a small badge
 * value, so the rail only re-renders when one of those genuinely changes —
 * not when the workbench around it re-renders.
 */
export const IconRail = memo(function IconRail({
  creators, selectedCreatorId, onSelectCreator,
  onOpenSearch, onOpenFavorites, onOpenDownloads, onOpenSettings, onOpenNotifications,
  onOpenTimeline, timelineActive,
  onSyncSubscriptions, syncingSubscriptions,
  downloadStatus, downloadActiveCount, settingsErrorCount,
}: IconRailProps) {
  const t = useTranslation();
  // Just the badge number, not the notification log — the log (and its 250ms
  // toast tick) would otherwise repaint the rail several times a second.
  const unreadCount = useUnreadCount();

  // The rail is one continuous list (no section headers), so ALL paid-active
  // creators — pinned AND unpinned — float above every free creator; manual
  // pin_order / alphabetical survives inside each tier. See sortRailCreators.
  const ordered = useMemo(
    () => sortRailCreators(creators.filter(c => Boolean(c.is_subscribed))),
    [creators],
  );

  return (
    <div className="w-full h-full bg-sidebar border-r flex flex-col items-center py-3 gap-2">
      {/* Sync subscriptions (fetch new posts from Patreon) — the Workbench's
          global "update" action, mirroring the classic sidebar header. A refresh
          mark, deliberately distinct from the download-cloud below so the two
          aren't confused. */}
      <button
        onClick={onSyncSubscriptions}
        disabled={syncingSubscriptions}
        title={t.sidebar.syncSubscriptionsTooltip}
        className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-60 transition-colors mb-1"
      >
        {syncingSubscriptions
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <RefreshCw className="h-4 w-4" />}
      </button>

      <button
        onClick={onOpenTimeline}
        title={t.timeline.heading}
        className={`h-9 w-9 grid place-items-center rounded-lg transition-colors mb-1 ${
          timelineActive ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
      >
        <History className="h-4 w-4" />
      </button>

      <div className="flex-1 w-full overflow-y-auto no-scrollbar">
        <div className="flex flex-col items-center gap-2 py-1">
          {ordered.map(c => (
            <RailCreatorButton
              key={c.id}
              creator={c}
              active={c.id === selectedCreatorId}
              onSelect={onSelectCreator}
              t={t}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-2 border-t w-full">
        <button onClick={onOpenFavorites} title={t.favorites.title}
          className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Star className="h-4 w-4" />
        </button>
        <button onClick={onOpenSearch} title={t.sidebar.search}
          className="h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Search className="h-4 w-4" />
        </button>
        <button onClick={onOpenDownloads} title={t.sidebar.downloads}
          className="relative h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <DownloadStatusIcon status={downloadStatus} />
          {downloadActiveCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </button>
        <button onClick={onOpenNotifications} title={t.notifications.title}
          className="relative h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-destructive text-white text-[10px] font-semibold tabular-nums">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button onClick={onOpenSettings} title={t.sidebar.settings}
          className="relative h-9 w-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
          <Settings className="h-4 w-4" />
          {settingsErrorCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </button>
      </div>
    </div>
  );
});