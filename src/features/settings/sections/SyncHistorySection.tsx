import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, MinusCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "../../../lib/i18n";

interface SyncRun {
  id: string;
  source_key: string;
  creator_name: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  creators_scanned: number;
  posts_imported: number;
  error_message: string | null;
}

const SUBSCRIPTIONS_KEY = "__subscriptions__";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SyncHistorySection() {
  const t = useTranslation();
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuilt, setRebuilt] = useState(false);

  const load = useCallback(async () => {
    try {
      setRuns(await invoke<SyncRun[]>("get_sync_runs", { limit: 50 }));
    } catch (e) {
      console.error("get_sync_runs failed", e);
    }
  }, []);

  // Opening this section counts as "seeing" the failures — clears the sidebar dot.
  useEffect(() => {
    load();
    invoke("mark_sync_runs_seen").catch(console.error);
  }, [load]);

  const handleClear = async () => {
    await invoke("clear_sync_runs").catch(console.error);
    load();
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    setRebuilt(false);
    try {
      await invoke("rebuild_search_index");
      setRebuilt(true);
    } catch (e) {
      console.error("rebuild_search_index failed", e);
    } finally {
      setRebuilding(false);
    }
  };

  const statusMeta = (status: string) => {
    switch (status) {
      case "success": return { icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, label: t.settingsHistory.statusSuccess };
      case "failed": return { icon: <XCircle className="h-4 w-4 text-destructive" />, label: t.settingsHistory.statusFailed };
      case "running": return { icon: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />, label: t.settingsHistory.statusRunning };
      case "cancelled": return { icon: <MinusCircle className="h-4 w-4 text-muted-foreground" />, label: t.settingsHistory.statusCancelled };
      default: return { icon: <MinusCircle className="h-4 w-4 text-amber-500" />, label: t.settingsHistory.statusInterrupted };
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">{t.settingsHistory.heading}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t.settingsHistory.desc}</p>

      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={handleClear} disabled={runs.length === 0}>
          {t.settingsHistory.clearButton}
        </Button>
        <Button variant="outline" size="sm" onClick={handleRebuild} disabled={rebuilding}>
          {rebuilding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCw className="h-4 w-4 mr-2" />}
          {rebuilt ? t.settingsHistory.rebuildDone : t.settingsHistory.rebuildButton}
        </Button>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t.settingsHistory.empty}</p>
      ) : (
        <div className="divide-y">
          {runs.map(run => {
            const meta = statusMeta(run.status);
            const target = run.source_key === SUBSCRIPTIONS_KEY
              ? t.settingsHistory.subscriptionsTarget
              : (run.creator_name ?? run.source_key);
            const duration = fmtDuration(run.started_at, run.finished_at);
            return (
              <div key={run.id} className="py-3 flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0" title={meta.label}>{meta.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">{target}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">{fmtTime(run.started_at)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    {run.source_key === SUBSCRIPTIONS_KEY
                      ? <span>{t.settingsHistory.creatorsScanned(run.creators_scanned)}</span>
                      : <span>{t.settingsHistory.postsImported(run.posts_imported)}</span>}
                    {duration && <span>· {duration}</span>}
                  </div>
                  {run.error_message && (
                    <div className="text-xs text-destructive mt-1 break-words">{run.error_message}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
