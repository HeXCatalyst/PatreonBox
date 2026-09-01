/**
 * Pure derivation of the two low-frequency values the app shell needs from the
 * download queue: how many jobs are outstanding (the sidebar badge) and the
 * single status the download icon reflects. This is the *only* thing the root
 * (LibraryView) subscribes to under P0-3 — the full per-job list, whose
 * progress events fire up to ~66×/sec at 10-way concurrency, now lives in
 * DownloadsView instead, so a progress tick no longer re-renders the whole
 * app tree.
 *
 * Mirrors the derivation that used to live inline in `useDownloadJobs`, so the
 * sidebar badge and icon behave identically — only the re-render fan-out
 * changes.
 */

export type DownloadJobStatus = "queued" | "downloading" | "paused" | "done" | "failed" | "cancelled";

/** The three visual states the animated Downloads icon reflects. */
export type DownloadStatus = "idle" | "downloading" | "paused";

export interface DownloadSummary {
  /** Jobs still outstanding: downloading + queued + paused. Paused counts as
   *  outstanding because the file is half-downloaded and still waiting on the
   *  user, so the badge shouldn't read as empty. */
  activeCount: number;
  status: DownloadStatus;
}

/** Statuses that count toward the active badge. */
const ACTIVE_STATUSES: ReadonlySet<DownloadJobStatus> = new Set(["downloading", "queued", "paused"]);

/**
 * Collapse a job map + the queue-wide pause flag into a summary. Takes the
 * minimal job shape (`{ status }`) so the app shell can keep a full job map in
 * a ref and pass it here without caring about the progress fields.
 */
export function deriveDownloadSummary(
  jobs: Record<string, { status: DownloadJobStatus }>,
  paused: boolean,
): DownloadSummary {
  const list = Object.values(jobs);
  const activeCount = list.filter(j => ACTIVE_STATUSES.has(j.status)).length;
  // downloading wins over paused: if a worker is still finishing an in-flight
  // file it should read as active. paused only shows once nothing is running.
  let status: DownloadStatus = "idle";
  if (list.some(j => j.status === "downloading")) {
    status = "downloading";
  } else if (paused && list.some(j => j.status === "queued" || j.status === "paused")) {
    status = "paused";
  }
  return { activeCount, status };
}

/**
 * Reference equality on the summary. The app shell only calls setState when this
 * returns false — so a burst of progress events (which change bytes_done but
 * not status or activeCount) is absorbed without a re-render.
 */
export function sameDownloadSummary(a: DownloadSummary, b: DownloadSummary): boolean {
  return a.activeCount === b.activeCount && a.status === b.status;
}
