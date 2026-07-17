import { Creator } from "../../types/db";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Settings, History, RefreshCw, Loader2 } from "lucide-react";
import { DownloadStatusIcon } from "../downloads/DownloadStatusIcon";
import type { DownloadStatus } from "../downloads/useDownloadJobs";
import { useTranslation } from "../../lib/i18n";

interface IconRailProps {
  creators: (Creator & { post_count: number })[];
  selectedCreatorId: string | null;
  onSelectCreator: (id: string) => void;
  onOpenSearch: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onOpenTimeline: () => void;
  onSyncSubscriptions: () => void;
  syncingSubscriptions: boolean;
  timelineActive: boolean;
  downloadStatus: DownloadStatus;
  downloadActiveCount: number;
  settingsErrorCount: number;
}

/**
 * The Workbench's slim left rail: creator avatars (pinned first, active ringed)
 * over a scroll area, with search / downloads / settings at the bottom. Names
 * live in tooltips; ⌘K (a later phase) covers fast switching for long lists.
 */
export function IconRail({
  creators, selectedCreatorId, onSelectCreator,
  onOpenSearch, onOpenDownloads, onOpenSettings, onOpenTimeline, timelineActive,
  onSyncSubscriptions, syncingSubscriptions,
  downloadStatus, downloadActiveCount, settingsErrorCount,
}: IconRailProps) {
  const t = useTranslation();

  const subscribed = creators.filter(c => Boolean(c.is_subscribed));
  const pinned = subscribed.filter(c => Boolean(c.is_pinned)).sort((a, b) => a.pin_order - b.pin_order);
  const rest = subscribed.filter(c => !Boolean(c.is_pinned)).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...pinned, ...rest];

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
          {ordered.map(c => {
            const active = c.id === selectedCreatorId;
            return (
              <button
                key={c.id}
                onClick={() => onSelectCreator(c.id)}
                title={`${c.name} · ${c.post_count}`}
                className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {active && <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-primary" />}
                <Avatar className={`h-9 w-9 transition-shadow ${active ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100 creator-avatar"}`}>
                  <AvatarImage src={c.avatar_path || undefined} />
                  <AvatarFallback>{c.name.charAt(0)}</AvatarFallback>
                </Avatar>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 pt-2 border-t w-full">
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
}
