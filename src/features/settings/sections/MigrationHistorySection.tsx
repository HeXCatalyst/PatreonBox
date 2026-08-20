import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, RotateCcw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "../../../lib/i18n";

interface MigrationRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  source_dir: string;
  target_dir: string;
  is_restore: boolean;
  file_count: number | null;
  total_bytes: number | null;
  copied_bytes: number | null;
  verify_mode: string;
  status: string; // "running" | "success" | "failed" | "rolled_back"
  error: string | null;
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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

export function MigrationHistorySection() {
  const t = useTranslation();
  const [records, setRecords] = useState<MigrationRecord[]>([]);

  const load = useCallback(async () => {
    try {
      setRecords(await invoke<MigrationRecord[]>("get_migration_history", { limit: 50 }));
    } catch (e) {
      console.error("get_migration_history failed", e);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh when a migration finishes (the backend emits this after
    // record_migration_finish) so the list updates without manual refresh.
    const unlisten = listen("image-migrations-changed", () => { load(); });
    return () => { unlisten.then(f => f()); };
  }, [load]);

  const handleClear = async () => {
    await invoke("clear_migration_history").catch(console.error);
    load();
  };

  const statusMeta = (status: string) => {
    switch (status) {
      case "success": return { icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, label: t.migrationHistory.statusSuccess };
      case "failed": return { icon: <XCircle className="h-4 w-4 text-destructive" />, label: t.migrationHistory.statusFailed };
      case "rolled_back": return { icon: <RotateCcw className="h-4 w-4 text-amber-500" />, label: t.migrationHistory.statusRolledBack };
      case "running": return { icon: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />, label: t.migrationHistory.statusRunning };
      default: return { icon: <XCircle className="h-4 w-4 text-muted-foreground" />, label: status };
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">{t.migrationHistory.heading}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t.migrationHistory.desc}</p>

      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={handleClear} disabled={records.length === 0}>
          {t.migrationHistory.clearButton}
        </Button>
      </div>

      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">{t.migrationHistory.empty}</p>
      ) : (
        <div className="space-y-3">
          {records.map(rec => {
            const meta = statusMeta(rec.status);
            const duration = fmtDuration(rec.started_at, rec.finished_at);
            // file_count = files actually copied (on failure) or total files
            // (on success). Byte progress (copied/total) is the reliable partial
            // indicator, so we don't try to split file_count into "X / Y".
            return (
              <div key={rec.id} className="py-3 border-b last:border-0">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0" title={meta.label}>{meta.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium flex-shrink-0">
                        {rec.is_restore ? t.migrationHistory.restoreDefault : t.migrationHistory.toCustom}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">{fmtTime(rec.started_at)}</span>
                    </div>
                    {/* source → target, monospace, truncated with tooltip */}
                    <div className="text-xs font-mono text-muted-foreground mt-1 flex items-center gap-1 min-w-0">
                      <span className="truncate" title={rec.source_dir}>{rec.source_dir}</span>
                      <ArrowRight className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate" title={rec.target_dir}>{rec.target_dir}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap tabular-nums">
                      <span>📁 {t.migrationHistory.files(rec.file_count ?? 0)}</span>
                      <span>💾 {formatBytes(rec.copied_bytes)} / {formatBytes(rec.total_bytes)}</span>
                      <span>🔍 {rec.verify_mode}</span>
                      {duration && <span>⏱ {duration}</span>}
                    </div>
                    {rec.error && (
                      <div className="text-xs text-destructive mt-1.5 font-mono break-words p-2 rounded bg-destructive/10">
                        {rec.error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
