import type { DownloadStatus } from "./useDownloadJobs";

/**
 * The Downloads sidebar mark, animated to reflect the queue at a glance:
 *   idle        → muted, a slow near-still float
 *   downloading → the arrow drops into the cloud on a loop, the cloud glows
 *   paused      → the arrow becomes pause-bars and the whole mark breathes
 *
 * Built from separable SVG parts (a shared cloud path + an `.arrow` group and a
 * `.bars` group) so each part animates independently. Motion lives in index.css
 * under `.dl-icon` / `.dl-<status>` and is disabled by prefers-reduced-motion.
 */
export function DownloadStatusIcon({ status, className }: { status: DownloadStatus; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`dl-icon dl-${status} ${className ?? ""}`}
      aria-hidden="true"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path className="dl-cloud" d="M4.4 15.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.4 8.3" />
      <g className="dl-arrow">
        <path d="M12 12v6" />
        <path d="m9 15 3 3 3-3" />
      </g>
      <g className="dl-bars">
        <path d="M10 12v6" />
        <path d="M14 12v6" />
      </g>
    </svg>
  );
}
