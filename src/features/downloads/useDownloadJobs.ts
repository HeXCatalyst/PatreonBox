import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTauriEvents } from "../library/hooks/useTauriEvents";

export interface DownloadJob {
  asset_id: string;
  creator_id: string;
  file_name: string;
  status: "queued" | "downloading" | "done" | "failed" | "cancelled";
  bytes_done: number;
  bytes_total: number | null;
  error: string | null;
}

/**
 * Live view of the global download queue. Seeds from `get_download_state` and applies
 * incremental `download-job-update` events. Removals (cancel/clear) happen via commands
 * that don't emit, so callers should `refresh()` after those.
 */
export function useDownloadJobs() {
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});

  const refresh = useCallback(async () => {
    try {
      const arr = await invoke<DownloadJob[]>("get_download_state");
      const map: Record<string, DownloadJob> = {};
      for (const j of arr) map[j.asset_id] = j;
      setJobs(map);
    } catch (e) {
      console.error("get_download_state failed", e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useTauriEvents({
    "download-job-update": (job: DownloadJob) => {
      setJobs(prev => ({ ...prev, [job.asset_id]: job }));
    },
  });

  const list = useMemo(() => Object.values(jobs), [jobs]);
  const activeCount = useMemo(
    () => list.filter(j => j.status === "downloading" || j.status === "queued").length,
    [list],
  );

  return { jobs: list, activeCount, refresh };
}
