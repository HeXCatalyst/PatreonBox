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

interface DownloadState {
  jobs: DownloadJob[];
  paused: boolean;
}

/** The three visual states the animated Downloads icon reflects. */
export type DownloadStatus = "idle" | "downloading" | "paused";

/**
 * Live view of the global download queue. Seeds from `get_download_state` and
 * applies incremental events: `download-job-update` (per-job upsert),
 * `download-job-removed` (per-job delete) and `download-paused` (queue-wide).
 *
 * A separate removal event is needed because `download-job-update` can only ever
 * add or modify a row — there's no way to say "this one is gone" through it.
 * `refresh()` is still available and still correct, but it's now a safety net
 * rather than a requirement after cancelling.
 */
export function useDownloadJobs() {
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await invoke<DownloadState>("get_download_state");
      const map: Record<string, DownloadJob> = {};
      for (const j of state.jobs) map[j.asset_id] = j;
      setJobs(map);
      setPaused(state.paused);
    } catch (e) {
      console.error("get_download_state failed", e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useTauriEvents({
    "download-job-update": (job: DownloadJob) => {
      setJobs(prev => ({ ...prev, [job.asset_id]: job }));
    },
    "download-job-removed": (assetId: string) => {
      setJobs(prev => {
        if (!(assetId in prev)) return prev;
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
    },
    "download-paused": (p: boolean) => setPaused(p),
  });

  const list = useMemo(() => Object.values(jobs), [jobs]);
  const activeCount = useMemo(
    () => list.filter(j => j.status === "downloading" || j.status === "queued").length,
    [list],
  );

  // downloading wins over paused: if a worker is still finishing an in-flight file
  // it should read as active. paused only shows once nothing is actually running.
  const status: DownloadStatus = useMemo(() => {
    if (list.some(j => j.status === "downloading")) return "downloading";
    if (paused && list.some(j => j.status === "queued")) return "paused";
    return "idle";
  }, [list, paused]);

  return { jobs: list, activeCount, status, paused, refresh };
}
