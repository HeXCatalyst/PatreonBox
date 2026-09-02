import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTauriEvents } from "../library/hooks/useTauriEvents";
import {
  deriveDownloadSummary,
  sameDownloadSummary,
  type DownloadSummary,
} from "./downloadSummary";
import type { DownloadJob, DownloadState } from "./useDownloadJobs";

/**
 * The app shell's (LibraryView's) lightweight view of the download queue.
 *
 * Under P0-3 the root no longer subscribes to the full per-job list: that list's
 * `download-job-update` events fire up to ~66×/sec at 10-way concurrency, and a
 * `setJobs` per event re-rendered the entire app tree even when the Downloads
 * page wasn't open. Instead the root keeps the full job map in a *ref* (mutable,
 * no re-render) and derives only `{ activeCount, status }` into state — and
 * only commits that state when it actually changes (sameDownloadSummary). A
 * progress tick changes bytes_done but not status, so it is absorbed without a
 * re-render. The full reactive list lives in DownloadsView via useDownloadJobs,
 * mounted only while that page is open.
 *
 * Seeds once from `get_download_state` so the badge is correct on launch.
 */
export function useDownloadSummary(): DownloadSummary {
  const [summary, setSummary] = useState<DownloadSummary>({ activeCount: 0, status: "idle" });
  const jobsRef = useRef<Record<string, DownloadJob>>({});
  const pausedRef = useRef(false);

  // Recompute from the refs and commit only on change. Returning `prev` when
  // unchanged is the React-bailout that prevents the re-render.
  const recompute = useCallback((prev: DownloadSummary): DownloadSummary => {
    const next = deriveDownloadSummary(jobsRef.current, pausedRef.current);
    return sameDownloadSummary(prev, next) ? prev : next;
  }, []);

  useEffect(() => {
    invoke<DownloadState>("get_download_state")
      .then(state => {
        const map: Record<string, DownloadJob> = {};
        for (const j of state.jobs) map[j.asset_id] = j;
        jobsRef.current = map;
        pausedRef.current = state.paused;
        setSummary(recompute);
      })
      .catch(e => console.error("get_download_state failed", e));
  }, [recompute]);

  useTauriEvents({
    "download-job-update": (job: DownloadJob) => {
      jobsRef.current = { ...jobsRef.current, [job.asset_id]: job };
      setSummary(recompute);
    },
    "download-job-removed": (assetId: string) => {
      if (!(assetId in jobsRef.current)) return;
      const next = { ...jobsRef.current };
      delete next[assetId];
      jobsRef.current = next;
      setSummary(recompute);
    },
    "download-paused": (p: boolean) => {
      pausedRef.current = p;
      setSummary(recompute);
    },
  });

  return summary;
}
