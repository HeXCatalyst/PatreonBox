import { describe, it, expect } from "vitest";
import {
  deriveDownloadSummary,
  sameDownloadSummary,
  type DownloadJobStatus,
} from "./downloadSummary";

// The whole point of P0-3: the root app shell subscribes to download events only
// to update the sidebar badge (active count + status icon). Progress ticks fire
// up to ~66×/sec at 10-way concurrency and change bytes_done but NOT status, so
// they must NOT cause a root re-render. deriveDownloadSummary collapses the job
// map to {activeCount, status}; sameDownloadSummary is the gate that skips the
// setState when only progress changed.

function job(status: DownloadJobStatus, extra: Record<string, unknown> = {}) {
  return { asset_id: extra.asset_id ?? `a-${status}`, status, ...extra };
}

describe("deriveDownloadSummary", () => {
  it("is idle with zero active for an empty queue", () => {
    expect(deriveDownloadSummary({}, false)).toEqual({ activeCount: 0, status: "idle" });
  });

  it("reports downloading when any job is downloading", () => {
    const jobs = { "1": job("downloading"), "2": job("queued") };
    expect(deriveDownloadSummary(jobs, false)).toEqual({ activeCount: 2, status: "downloading" });
  });

  it("counts downloading, queued and paused as active, but not done/failed/cancelled", () => {
    const jobs = {
      a: job("downloading"),
      b: job("queued"),
      c: job("paused"),
      d: job("done"),
      e: job("failed"),
      f: job("cancelled"),
    };
    expect(deriveDownloadSummary(jobs, false).activeCount).toBe(3);
  });

  it("reads paused only when the queue is paused and something is queued/paused", () => {
    expect(deriveDownloadSummary({ a: job("queued") }, true)).toEqual({ activeCount: 1, status: "paused" });
    // Not paused flag → queued alone reads idle (no worker actually running).
    expect(deriveDownloadSummary({ a: job("queued") }, false)).toEqual({ activeCount: 1, status: "idle" });
  });

  it("lets downloading win over paused", () => {
    const jobs = { a: job("downloading"), b: job("queued") };
    expect(deriveDownloadSummary(jobs, true)).toEqual({ activeCount: 2, status: "downloading" });
  });

  it("goes idle once everything finishes", () => {
    const jobs = { a: job("done"), b: job("failed") };
    expect(deriveDownloadSummary(jobs, false)).toEqual({ activeCount: 0, status: "idle" });
  });
});

describe("sameDownloadSummary (the P0-3 re-render gate)", () => {
  it("treats a progress-only change as unchanged", () => {
    // Same statuses, only bytes_done moved — exactly what a 150ms progress tick does.
    const before = { "1": job("downloading", { bytes_done: 100, bytes_total: 1000 }) };
    const after = { "1": job("downloading", { bytes_done: 500, bytes_total: 1000 }) };
    const s1 = deriveDownloadSummary(before, false);
    const s2 = deriveDownloadSummary(after, false);
    expect(sameDownloadSummary(s1, s2)).toBe(true);
  });

  it("detects an activeCount change", () => {
    const one = { "1": job("downloading") };
    const two = { "1": job("downloading"), "2": job("queued") };
    expect(sameDownloadSummary(deriveDownloadSummary(one, false), deriveDownloadSummary(two, false))).toBe(false);
  });

  it("detects a status transition", () => {
    const downloading = { "1": job("downloading") };
    const done = { "1": job("done") };
    expect(sameDownloadSummary(deriveDownloadSummary(downloading, false), deriveDownloadSummary(done, false))).toBe(false);
  });

  it("detects a paused-flag change with the same jobs", () => {
    const jobs = { "1": job("queued") };
    expect(sameDownloadSummary(deriveDownloadSummary(jobs, false), deriveDownloadSummary(jobs, true))).toBe(false);
  });
});
