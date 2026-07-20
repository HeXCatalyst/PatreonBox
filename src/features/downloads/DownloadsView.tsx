import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronDown, ChevronRight, Pause, Play, RotateCcw, X, XCircle, AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { DownloadJob } from "./useDownloadJobs";
import { useThroughput, STALL_SAMPLES, type ThroughputSample } from "./useThroughput";
import { ThroughputChart } from "./ThroughputChart";
import { useTranslation } from "../../lib/i18n";
import { Button } from "@/components/ui/button";

interface DownloadsViewProps {
  jobs: DownloadJob[];
  onRefresh: () => void;
  onClose: () => void;
  creatorName: (id: string) => string;
}

const MONITOR_KEY = "patreonbox-downloads-monitor-open";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Split so the unit can be set smaller than the figure without a second call. */
function fmtRate(bps: number): { value: string; unit: string } {
  if (bps < 1000 * 1024) return { value: String(Math.max(0, Math.round(bps / 1024))), unit: "KB/s" };
  return { value: (bps / (1024 * 1024)).toFixed(1), unit: "MB/s" };
}

/**
 * Time remaining at the current smoothed rate. Returns null below a floor rate,
 * because dividing by a near-zero speed yields hours-long estimates that flicker
 * wildly and tell the user nothing.
 */
function fmtEta(remaining: number, bps: number): string | null {
  if (bps < 1024 || remaining <= 0) return null;
  const secs = Math.round(remaining / bps);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  return `${m}m ${String(secs % 60).padStart(2, "0")}s`;
}

/**
 * The throughput band: network as a filled area, disk write as a hairline over
 * it, with the current figure for each. Collapsible, because it costs ~110px of
 * vertical space that matters once the queue is long; the choice persists.
 */
function ThroughputMonitor({
  samples, net, disk, stalled, open, onToggle,
}: {
  samples: ThroughputSample[];
  net: number;
  disk: number;
  stalled: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslation();
  const netR = fmtRate(net);
  const diskR = fmtRate(disk);

  return (
    <div className="border-b bg-muted/20">
      <div className="flex items-stretch gap-4 px-4 py-3">
        {open && (
          <div className="relative flex-1 min-w-0">
            <ThroughputChart samples={samples} />
            <span className="absolute bottom-0 right-0 text-[10px] font-mono text-muted-foreground pointer-events-none">
              {t.downloads.window}
            </span>
          </div>
        )}

        {/* Readouts stay visible when collapsed — the numbers are the point; the
            chart is the history behind them. */}
        <div className={`flex flex-shrink-0 gap-5 ${open ? "flex-col justify-center min-w-[9rem]" : "flex-1 items-center"}`}>
          <div className="flex items-baseline gap-2">
            <span className="h-2 w-2 rounded-[2px] bg-primary flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">
              {t.downloads.network}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-primary">
              {netR.value}<span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{netR.unit}</span>
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="h-2 w-2 rounded-[2px] border-[1.5px] flex-shrink-0" style={{ borderColor: "var(--link)" }} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">
              {t.downloads.diskWrite}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: "var(--link)" }}>
              {diskR.value}<span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{diskR.unit}</span>
            </span>
          </div>

          {stalled && (
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-destructive">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              {t.downloads.stalled(STALL_SAMPLES)}
            </div>
          )}
        </div>

        <button
          onClick={onToggle}
          title={open ? t.downloads.collapseMonitor : t.downloads.expandMonitor}
          aria-expanded={open}
          className="flex-shrink-0 self-start h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function DownloadsView({ jobs, onRefresh, onClose, creatorName }: DownloadsViewProps) {
  const t = useTranslation();
  const [paused, setPaused] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(
    () => localStorage.getItem(MONITOR_KEY) !== "0",
  );

  const { downloading, queued, failed, completed } = useMemo(() => {
    return {
      downloading: jobs.filter(j => j.status === "downloading"),
      queued: jobs.filter(j => j.status === "queued"),
      failed: jobs.filter(j => j.status === "failed"),
      completed: jobs.filter(j => j.status === "done"),
    };
  }, [jobs]);

  // Sampling runs for as long as this page is mounted, so the chart keeps
  // filling while you watch a queue drain — including the flat tail after the
  // last file lands, which is itself informative.
  const { samples, speeds, stalled, net, disk } = useThroughput(jobs);

  const toggleMonitor = () => {
    setMonitorOpen(open => {
      localStorage.setItem(MONITOR_KEY, open ? "0" : "1");
      return !open;
    });
  };

  const act = async (p: Promise<unknown>) => { try { await p; } catch (e) { console.error(e); } onRefresh(); };

  const togglePause = async () => {
    const next = !paused;
    setPaused(next);
    await act(invoke(next ? "pause_downloads" : "resume_downloads"));
  };

  const row = (j: DownloadJob) => {
    const pct = j.bytes_total && j.bytes_total > 0 ? Math.min(100, (j.bytes_done / j.bytes_total) * 100) : null;
    const speed = speeds[j.asset_id] ?? 0;
    const rate = fmtRate(speed);
    const eta = j.bytes_total ? fmtEta(j.bytes_total - j.bytes_done, speed) : null;

    return (
      <div key={j.asset_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-background">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono truncate">{j.file_name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {creatorName(j.creator_id)}
            {j.status === "failed" && j.error ? <span className="text-destructive"> · {j.error}</span> : null}
          </div>
          {j.status === "downloading" && (
            <div className="mt-1.5 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                {pct !== null
                  ? <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  : <div className="h-full w-1/3 bg-primary/70 rounded-full animate-pulse" />}
              </div>
              {/* Fixed-width, tabular slots: without both, the digits change
                  width as they tick and the whole row jitters. */}
              <div className="flex items-baseline gap-3 flex-shrink-0 font-mono text-xs tabular-nums">
                <span className="text-primary font-semibold text-right w-[4.75rem]">
                  {rate.value} {rate.unit}
                </span>
                <span className="text-muted-foreground text-right w-[7.5rem]">
                  {pct !== null
                    ? `${fmtBytes(j.bytes_done)} / ${fmtBytes(j.bytes_total!)}`
                    : fmtBytes(j.bytes_done)}
                </span>
                <span className="text-muted-foreground/70 text-right w-[5rem]">
                  {eta ? t.downloads.etaLeft(eta) : ""}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {j.status === "failed" && (
            <button className="w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              title={t.downloads.retry} onClick={() => act(invoke("retry_download", { assetId: j.asset_id }))}>
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {j.status !== "done" && (
            <button className="w-8 h-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted flex items-center justify-center"
              title={t.downloads.remove} onClick={() => act(invoke("cancel_download", { assetId: j.asset_id }))}>
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
          <ChevronLeft className="h-4 w-4" /> {t.downloads.backToLibrary}
        </button>
        <h1 className="text-lg font-semibold ml-1">{t.downloads.heading}</h1>
        <div className="text-xs text-muted-foreground flex gap-3 ml-1">
          <span>{t.downloads.countDownloading(downloading.length)}</span>
          <span>{t.downloads.countQueued(queued.length)}</span>
          {failed.length > 0 && <span className="text-destructive">{t.downloads.countFailed(failed.length)}</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={togglePause}>
            {paused ? <><Play /> {t.downloads.resumeAll}</> : <><Pause /> {t.downloads.pauseAll}</>}
          </Button>
          {failed.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => act(invoke("retry_all_failed", { creatorId: null }))}>
              <RotateCcw /> {t.downloads.retryAllFailed}
            </Button>
          )}
          {(downloading.length + queued.length + failed.length) > 0 && (
            <Button variant="destructive" size="sm" onClick={() => act(invoke("cancel_all_downloads"))}>
              <XCircle /> {t.downloads.cancelAll}
            </Button>
          )}
        </div>
      </div>

      <ThroughputMonitor
        samples={samples}
        net={net}
        disk={disk}
        stalled={stalled}
        open={monitorOpen}
        onToggle={toggleMonitor}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {nothing ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {t.downloads.empty}
          </div>
        ) : (
          <>
            {section(t.downloads.sectionDownloading, downloading)}
            {section(t.downloads.sectionQueued, queued)}
            {section(t.downloads.sectionFailed, failed)}

            {completed.length > 0 && (
              <section className="mt-5 opacity-60">
                <div className="flex items-center gap-2 mb-2">
                  <button className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCompleted(v => !v)}>
                    {showCompleted ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {t.downloads.sectionCompleted}
                  </button>
                  <span className="text-xs text-muted-foreground tabular-nums">{completed.length}</span>
                  <button className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => act(invoke("clear_completed_downloads"))}>
                    {t.downloads.clearCompleted}
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
