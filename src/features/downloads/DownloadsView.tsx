import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronDown, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DownloadJob } from "./useDownloadJobs";

interface DownloadsViewProps {
  jobs: DownloadJob[];
  onRefresh: () => void;
  onClose: () => void;
  creatorName: (id: string) => string;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DownloadsView({ jobs, onRefresh, onClose, creatorName }: DownloadsViewProps) {
  const [paused, setPaused] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const { downloading, queued, failed, completed } = useMemo(() => {
    return {
      downloading: jobs.filter(j => j.status === "downloading"),
      queued: jobs.filter(j => j.status === "queued"),
      failed: jobs.filter(j => j.status === "failed"),
      completed: jobs.filter(j => j.status === "done"),
    };
  }, [jobs]);

  const act = async (p: Promise<unknown>) => { try { await p; } catch (e) { console.error(e); } onRefresh(); };

  const togglePause = async () => {
    const next = !paused;
    setPaused(next);
    await act(invoke(next ? "pause_downloads" : "resume_downloads"));
  };

  const row = (j: DownloadJob) => {
    const pct = j.bytes_total && j.bytes_total > 0 ? Math.min(100, (j.bytes_done / j.bytes_total) * 100) : null;
    return (
      <div key={j.asset_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-background">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono truncate">{j.file_name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {creatorName(j.creator_id)}
            {j.status === "failed" && j.error ? <span className="text-destructive"> · {j.error}</span> : null}
          </div>
          {j.status === "downloading" && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                {pct !== null
                  ? <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  : <div className="h-full w-1/3 bg-primary/70 rounded-full animate-pulse" />}
              </div>
              <span className="text-xs text-muted-foreground font-mono tabular-nums whitespace-nowrap">
                {pct !== null
                  ? `${fmtBytes(j.bytes_done)} / ${fmtBytes(j.bytes_total!)}`
                  : fmtBytes(j.bytes_done)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {j.status === "failed" && (
            <button className="w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              title="Retry" onClick={() => act(invoke("retry_download", { assetId: j.asset_id }))}>
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {j.status !== "done" && (
            <button className="w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted flex items-center justify-center"
              title="Remove" onClick={() => act(invoke("cancel_download", { assetId: j.asset_id }))}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const section = (title: string, items: DownloadJob[]) => items.length > 0 && (
    <section className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </div>
      <div className="space-y-1.5">{items.map(row)}</div>
    </section>
  );

  const nothing = jobs.length === 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
      <div className="p-4 border-b flex items-center gap-3 flex-wrap">
        <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onClose}>
          <ChevronLeft className="h-4 w-4" /> Back to Library
        </button>
        <h1 className="text-lg font-semibold ml-1">Downloads</h1>
        <div className="text-xs text-muted-foreground flex gap-3 ml-1">
          <span>{downloading.length} downloading</span>
          <span>{queued.length} queued</span>
          {failed.length > 0 && <span className="text-destructive">{failed.length} failed</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs rounded border hover:bg-muted flex items-center gap-1.5"
            onClick={togglePause}>
            {paused ? <><Play className="h-3.5 w-3.5" /> Resume all</> : <><Pause className="h-3.5 w-3.5" /> Pause all</>}
          </button>
          {failed.length > 0 && (
            <button className="px-3 py-1.5 text-xs rounded border hover:bg-muted"
              onClick={() => act(invoke("retry_all_failed", { creatorId: null }))}>
              Retry all failed
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {nothing ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No downloads yet. Start an image download from a creator's Posts view.
          </div>
        ) : (
          <>
            {section("Downloading", downloading)}
            {section("Queued", queued)}
            {section("Failed", failed)}

            {completed.length > 0 && (
              <section className="mt-5 opacity-60">
                <div className="flex items-center gap-2 mb-2">
                  <button className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCompleted(v => !v)}>
                    {showCompleted ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Completed
                  </button>
                  <span className="text-xs text-muted-foreground tabular-nums">{completed.length}</span>
                  <button className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => act(invoke("clear_completed_downloads"))}>
                    Clear completed
                  </button>
                </div>
                {showCompleted && <div className="space-y-1.5">{completed.map(row)}</div>}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
