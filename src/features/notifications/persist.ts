import { AppNotification, MAX_HISTORY, NotifySeverity } from "./store";

export const STORAGE_KEY = "patreonbox.notifications.v1";

/** The slice of the Storage API we need — lets tests pass a plain fake. */
export interface NotificationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SEVERITIES: NotifySeverity[] = ["error", "warning", "success", "info"];

function isSeverity(v: unknown): v is NotifySeverity {
  return typeof v === "string" && SEVERITIES.includes(v as NotifySeverity);
}

/**
 * Rebuilds one entry from parsed JSON, or returns null if it doesn't look like
 * a notification. Stored data outlives the code that wrote it (older app
 * versions, a hand-edited profile), so nothing here trusts its input.
 */
function reviveOne(raw: unknown): AppNotification | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  if (!isSeverity(r.severity)) return null;

  const lastAt = typeof r.lastAt === "number" ? r.lastAt : 0;
  return {
    id: r.id,
    severity: r.severity,
    title: r.title,
    detail: typeof r.detail === "string" ? r.detail : undefined,
    source: typeof r.source === "string" ? r.source : undefined,
    dedupeKey: typeof r.dedupeKey === "string" ? r.dedupeKey : undefined,
    count: typeof r.count === "number" && r.count > 0 ? r.count : 1,
    firstAt: typeof r.firstAt === "number" ? r.firstAt : lastAt,
    lastAt,
    read: r.read === true,
    action:
      typeof r.action === "object" && r.action !== null &&
      typeof (r.action as Record<string, unknown>).kind === "string"
        ? (r.action as AppNotification["action"])
        : undefined,
    // Toasts never survive a restart — a week-old error popping up on launch
    // would be noise. The entry stays in the centre, just not on screen.
    toastClosedAt: lastAt,
  };
}

export function loadNotifications(
  storage: NotificationStorage,
): AppNotification[] {
  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const revived: AppNotification[] = [];
  for (const raw of parsed) {
    const one = reviveOne(raw);
    if (one) revived.push(one);
  }
  return revived.slice(0, MAX_HISTORY);
}

export function saveNotifications(
  storage: NotificationStorage,
  list: AppNotification[],
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // A full or unavailable quota must never take down the app — the log is
    // a convenience, not a source of truth.
  }
}
