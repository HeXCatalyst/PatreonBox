import { useSyncExternalStore } from "react";

/**
 * External stores for the two long-running progress streams (post sync and
 * comment backfill).
 *
 * Both used to live in the library root's `useState`, which made every progress
 * event re-render the entire app tree — the root is the only re-render engine in
 * this app and there are no memo boundaries above the panes. A comment backfill
 * runs for tens of minutes and reports twice a second; a post sync reports once
 * per page. Neither should be able to repaint the sidebar, the reading pane or a
 * filmstrip holding one cell per post.
 *
 * Living outside React, the counter can be written from an event handler without
 * touching any component, and read by the two components that actually print the
 * numbers. Everything in between — and everything above them — stays put.
 */
function createStore<T>(initial: T, equal: (a: T, b: T) => boolean) {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  // Must return a cached value: useSyncExternalStore compares snapshots by
  // identity and would loop forever on a freshly-built object.
  const getSnapshot = () => snapshot;
  const set = (next: T) => {
    if (equal(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const useStore = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { getSnapshot, set, useStore };
}

/* ------------------------------------------------------------------ *
 * Post sync — "N / M posts fetched", shown in the toolbar + dock header
 * ------------------------------------------------------------------ */

export interface SyncProgress {
  current: number;
  total: number;
}

const IDLE_SYNC: SyncProgress = { current: 0, total: 0 };

const syncStore = createStore<SyncProgress>(
  IDLE_SYNC,
  (a, b) => a.current === b.current && a.total === b.total,
);

/**
 * Seeds the counter as a run starts. Resuming from a checkpoint passes the
 * posts already done, so the bar doesn't jump back to zero.
 */
export function beginSyncProgress(current = 0) {
  syncStore.set({ current, total: 0 });
}

/**
 * One progress event's worth. `total` is only adopted when the backend knows it
 * (> 0) — a zero total means "unknown", and the UI renders that as an
 * indeterminate bar rather than resetting a known total.
 */
export function updateSyncProgress(current: number, total: number) {
  const prev = syncStore.getSnapshot();
  syncStore.set({ current, total: total > 0 ? total : prev.total });
}

/** Run finished (or failed) — back to idle. */
export function endSyncProgress() {
  syncStore.set(IDLE_SYNC);
}

/** Live sync counter. Read it low in the tree: whoever subscribes re-renders. */
export function useSyncProgress(): SyncProgress {
  return syncStore.useStore();
}

/* ------------------------------------------------------------------ *
 * Comment backfill — the thin strip above the panes; null when idle
 * ------------------------------------------------------------------ */

export interface CommentBackfillProgress {
  done: number;
  total: number;
}

const commentStore = createStore<CommentBackfillProgress | null>(
  null,
  (a, b) => a === b || (!!a && !!b && a.done === b.done && a.total === b.total),
);

export function setCommentBackfillProgress(done: number, total: number) {
  commentStore.set({ done, total });
}

export function clearCommentBackfillProgress() {
  commentStore.set(null);
}

export function useCommentBackfillProgress(): CommentBackfillProgress | null {
  return commentStore.useStore();
}