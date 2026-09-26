import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTauriEvents } from "../library/hooks/useTauriEvents";
import {
  deriveDownloadSummary,
  sameDownloadSummary,
  type DownloadJobStatus,
  type DownloadSummary,
} from "./downloadSummary";
import type { DownloadJob, DownloadSummaryState } from "./useDownloadJobs";

/**
 * The app shell's (LibraryView's) lightweight view of the download queue.
 *
 * Under P0-3 the root no longer subscribes to the full per-job list: that list's
 * `download-job-update` events fire up to ~66×/sec at 10-way concurrency, and a
 * `setJobs` per event re-rendered the entire app tree even when the Downloads
 * page wasn't open. Instead the root keeps the job map in a *ref* (mutable, no
 * re-render) and derives only `{ activeCount, status }` into state — and only
 * commits that state when it actually changes (sameDownloadSummary). A progress
 * tick changes bytes_done but not status, so it is absorbed without a re-render.
 * The full reactive list lives in DownloadsView via useDownloadJobs, mounted only
 * while that page is open.
 *
 * Seeds from `get_download_summary` (P1-6), which returns only the jobs that can
 * affect the badge or the icon — the full state's done/failed history is not
 * fetched, parsed and thrown away on every launch any more. Because this map
 * exists to *count* outstanding work, a job that finishes is deleted from it
 * rather than kept: keeping done rows would mean carrying the whole session's
 * history in the ref for no derivable difference.
 */
export function useDownloadSummary(): DownloadSummary {
  const [summary, setSummary] = useState<DownloadSummary>({ activeCount: 0, status: "idle" });
  const jobsRef = useRef<Record<string, { status: DownloadJobStatus }>>({});
  const pausedRef = useRef(false);

  // Recompute from the refs and commit only on change. Returning `prev` when
  // unchanged is the React-bailout that prevents the re-render.
  const recompute = useCallback((prev: DownloadSummary): DownloadSummary => {
    const next = deriveDownloadSummary(jobsRef.current, pausedRef.current);
    return sameDownloadSummary(prev, next) ? prev : next;
  }, []);

  useEffect(() => {
    invoke<DownloadSummaryState>("get_download_summary")
      .then(state => {
        const map: Record<string, { status: DownloadJobStatus }> = {};
        for (const j of state.active) map[j.asset_id] = { status: j.status };
        // Known race (accepted): an event that arrives before this seed resolves
        // lands in the map and is then overwritten here. The lost state heals on
        // the next event for that job; the window is a single launch-time
        // round trip and the alternative (buffering events until the seed lands)
        // would delay the badge behind a slower path.
        jobsRef.current = map;
        pausedRef.current = state.paused;
        setSummary(recompute);
      })
      .catch(e => console.error("get_download_summary failed", e));
  }, [recompute]);

  useTauriEvents({
    "download-job-update": (job: DownloadJob) => {
      const next = { ...jobsRef.current };
      if (job.status === "done" || job.status === "cancelled" || job.status === "failed") {
        // No longer outstanding, and this map only feeds the derived count.
        delete next[job.asset_id];
      } else {
        next[job.asset_id] = { status: job.status };
      }
      jobsRef.current = next;
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
