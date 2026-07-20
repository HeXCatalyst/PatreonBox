import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { DownloadJob } from "./useDownloadJobs";

/** One point on the chart. Both figures are bytes per second. */
export interface ThroughputSample {
  net: number;
  disk: number;
}

interface DiskIoStats {
  total_written_bytes: number;
  total_read_bytes: number;
}

export const SAMPLE_MS = 1000;
export const WINDOW_SAMPLES = 60; // 60s of history

/** How hard each new reading pulls the displayed per-file speed. */
const EMA_ALPHA = 0.3;

/** Consecutive idle samples before we call the queue stalled. Samples are
 *  SAMPLE_MS apart, so this doubles as the number of seconds shown to the user. */
export const STALL_SAMPLES = 8;

interface Tracked {
  lastBytes: number;
  ema: number;
}

/**
 * Samples download throughput once a second while the Downloads page is open.
 *
 * Network is derived from the byte counts the download manager already emits —
 * no new backend work, and it measures exactly the queue rather than all traffic
 * from this machine. Disk comes from the process tree's cumulative write counter,
 * differenced here; comparing the two is what makes "bytes arriving but not
 * landing on disk" visible.
 *
 * Nothing is persisted, and the Downloads page is unmounted when you navigate
 * away, so the window starts empty each time it opens — which is what you want
 * from a chart about a run in progress.
 */
export function useThroughput(jobs: DownloadJob[]) {
  // Sampling reads the latest jobs off a ref rather than re-subscribing on every
  // update: byte counts change several times a second per job, and restarting
  // the interval each time would never let a full second elapse.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const [samples, setSamples] = useState<ThroughputSample[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});
  const [stalled, setStalled] = useState(false);

  const tracked = useRef<Map<string, Tracked>>(new Map());
  const lastDisk = useRef<{ bytes: number; at: number } | null>(null);
  const idleRun = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let lastAt = performance.now();

    const sample = async () => {
      const now = performance.now();
      const dt = Math.max(0.001, (now - lastAt) / 1000);
      lastAt = now;

      const current = jobsRef.current;
      const live = new Set(current.map(j => j.asset_id));
      let netTotal = 0;
      const nextSpeeds: Record<string, number> = {};

      for (const job of current) {
        const prev = tracked.current.get(job.asset_id);
        // A negative delta means the job restarted (a requeued retry resets
        // bytes_done), not that bytes were un-downloaded.
        const delta = prev ? Math.max(0, job.bytes_done - prev.lastBytes) : 0;
        const instant = delta / dt;
        // Seed the average with the first real reading instead of easing up from
        // zero, which would under-report for the first few seconds.
        const ema = prev && prev.ema > 0 ? prev.ema + (instant - prev.ema) * EMA_ALPHA : instant;

        tracked.current.set(job.asset_id, { lastBytes: job.bytes_done, ema });
        netTotal += instant;
        if (job.status === "downloading") nextSpeeds[job.asset_id] = ema;
      }

      // Forget jobs that left the queue, or the map grows for the whole session.
      for (const id of tracked.current.keys()) {
        if (!live.has(id)) tracked.current.delete(id);
      }

      let diskRate = 0;
      try {
        const io = await invoke<DiskIoStats>("disk_io_stats");
        const prev = lastDisk.current;
        if (prev) {
          const dtDisk = Math.max(0.001, (performance.now() - prev.at) / 1000);
          diskRate = Math.max(0, (io.total_written_bytes - prev.bytes) / dtDisk);
        }
        lastDisk.current = { bytes: io.total_written_bytes, at: performance.now() };
      } catch {
        // Disk stats are supplementary; a failure here shouldn't blank the
        // network line, which is the reading people actually watch.
      }

      if (cancelled) return;

      setSamples(prev => {
        const next = prev.length >= WINDOW_SAMPLES ? prev.slice(1) : prev.slice();
        next.push({ net: netTotal, disk: diskRate });
        return next;
      });
      setSpeeds(nextSpeeds);

      const anyActive = current.some(j => j.status === "downloading");
      idleRun.current = anyActive && netTotal < 1024 ? idleRun.current + 1 : 0;
      setStalled(idleRun.current >= STALL_SAMPLES);
    };

    // Prime the byte baselines immediately so the first real sample a second
    // later measures a full interval rather than "everything downloaded so far".
    for (const job of jobsRef.current) {
      tracked.current.set(job.asset_id, { lastBytes: job.bytes_done, ema: 0 });
    }

    const timer = window.setInterval(sample, SAMPLE_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const latest = samples.length > 0 ? samples[samples.length - 1] : { net: 0, disk: 0 };
  return { samples, speeds, stalled, net: latest.net, disk: latest.disk };
}
