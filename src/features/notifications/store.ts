// Pure notification state. Deliberately free of React and of any Tauri or DOM
// API so the coalescing / expiry / capping rules can be tested directly.
//
// Time is always passed in as `now` rather than read from Date.now() inside,
// so tests can drive the toast lifecycle without waiting on real timers.

export type NotifySeverity = "error" | "warning" | "success" | "info";

/**
 * A serialisable pointer to something the UI can do about a notification.
 * The handler itself lives in the UI layer (keyed by `kind`) — storing a
 * closure here would make the log impossible to persist across restarts.
 */
export interface NotifyAction {
  kind: string;
  payload?: Record<string, string | number>;
}

export interface AppNotification {
  id: string;
  severity: NotifySeverity;
  title: string;
  /** Secondary line: the underlying error text, a count, etc. */
  detail?: string;
  /** Where it came from — a creator name, a post title. */
  source?: string;
  /**
   * Repeats within COALESCE_WINDOW_MS that share a key collapse into one
   * entry with a bumped `count`. A batch sync failing 50 images must not
   * produce 50 cards.
   */
  dedupeKey?: string;
  count: number;
  firstAt: number;
  lastAt: number;
  read: boolean;
  action?: NotifyAction;
  /** Set when the user closes the toast; the entry stays in the log. */
  toastClosedAt?: number;
}

/** What a caller supplies; the store fills in the bookkeeping fields. */
export type NotifyInput = Omit<
  AppNotification,
  "id" | "count" | "firstAt" | "lastAt" | "read" | "toastClosedAt"
>;

/** Repeats further apart than this start a new entry instead of coalescing. */
export const COALESCE_WINDOW_MS = 5000;
/** Successes and info toasts fade on their own; problems must be dismissed. */
export const TOAST_TTL_MS = 3000;
/** Oldest entries beyond this are dropped so the log can't grow forever. */
export const MAX_HISTORY = 200;
/** Toasts past this are queued in the log only, to avoid burying the UI. */
export const MAX_TOASTS = 4;

function isSticky(severity: NotifySeverity): boolean {
  return severity === "error" || severity === "warning";
}

let idCounter = 0;

function nextId(now: number): string {
  idCounter += 1;
  return `n${now}-${idCounter}`;
}

/** Test seam — keeps generated ids predictable across test cases. */
export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Adds a notification, coalescing into the most recent matching entry when one
 * is still inside the dedupe window. Returns a new array; never mutates.
 */
export function addNotification(
  list: AppNotification[],
  input: NotifyInput,
  now: number,
): AppNotification[] {
  if (input.dedupeKey) {
    const idx = list.findIndex(
      n => n.dedupeKey === input.dedupeKey && now - n.lastAt <= COALESCE_WINDOW_MS,
    );
    if (idx !== -1) {
      const prev = list[idx];
      const merged: AppNotification = {
        ...prev,
        // Later occurrences carry fresher context (a new error string, a new
        // source), so the newest wins for the display fields.
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        source: input.source,
        action: input.action ?? prev.action,
        count: prev.count + 1,
        lastAt: now,
        // A repeat is new information: resurface it even if already seen.
        read: false,
        toastClosedAt: undefined,
      };
      return [merged, ...list.slice(0, idx), ...list.slice(idx + 1)];
    }
  }

  const created: AppNotification = {
    ...input,
    id: nextId(now),
    count: 1,
    firstAt: now,
    lastAt: now,
    read: false,
  };
  return [created, ...list].slice(0, MAX_HISTORY);
}

export function markRead(list: AppNotification[], id: string): AppNotification[] {
  return list.map(n => (n.id === id ? { ...n, read: true } : n));
}

export function markAllRead(list: AppNotification[]): AppNotification[] {
  return list.map(n => (n.read ? n : { ...n, read: true }));
}

/** Removes an entry from the log entirely. */
export function removeNotification(
  list: AppNotification[],
  id: string,
): AppNotification[] {
  return list.filter(n => n.id !== id);
}

export function clearAll(): AppNotification[] {
  return [];
}

/** Closes the toast but keeps the entry in the notification centre. */
export function closeToast(
  list: AppNotification[],
  id: string,
  now: number,
): AppNotification[] {
  return list.map(n => (n.id === id ? { ...n, toastClosedAt: now } : n));
}

export function unreadCount(list: AppNotification[]): number {
  return list.reduce((sum, n) => (n.read ? sum : sum + 1), 0);
}

/**
 * The toasts that should be on screen right now: not manually closed, and
 * either sticky (error/warning) or still inside their TTL.
 */
export function activeToasts(
  list: AppNotification[],
  now: number,
): AppNotification[] {
  return list
    .filter(n => {
      if (n.toastClosedAt !== undefined) return false;
      if (isSticky(n.severity)) return true;
      return now - n.lastAt < TOAST_TTL_MS;
    })
    .slice(0, MAX_TOASTS);
}

/**
 * Whether any non-sticky toast is still counting down. The UI uses this to
 * decide if it needs a ticking timer at all, so an idle app stays idle.
 */
export function hasExpiringToast(list: AppNotification[], now: number): boolean {
  return list.some(
    n =>
      n.toastClosedAt === undefined &&
      !isSticky(n.severity) &&
      now - n.lastAt < TOAST_TTL_MS,
  );
}

export type RelativeBucket =
  | { unit: "now" }
  | { unit: "minute"; value: number }
  | { unit: "hour"; value: number }
  | { unit: "day"; value: number };

/**
 * Coarse "how long ago" for the notification centre, split from its wording so
 * the rounding can be tested without going through i18n.
 */
export function relativeBucket(at: number, now: number): RelativeBucket {
  const secs = Math.max(0, Math.floor((now - at) / 1000));
  if (secs < 60) return { unit: "now" };
  const mins = Math.floor(secs / 60);
  if (mins < 60) return { unit: "minute", value: mins };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  return { unit: "day", value: Math.floor(hours / 24) };
}
