import { describe, it, expect, beforeEach } from "vitest";
import {
  AppNotification,
  NotifyInput,
  COALESCE_WINDOW_MS,
  MAX_HISTORY,
  MAX_TOASTS,
  TOAST_TTL_MS,
  activeToasts,
  addNotification,
  clearAll,
  closeToast,
  hasExpiringToast,
  markAllRead,
  markRead,
  relativeBucket,
  removeNotification,
  resetIdCounter,
  unreadCount,
} from "./store";
import {
  STORAGE_KEY,
  NotificationStorage,
  loadNotifications,
  saveNotifications,
} from "./persist";

// A stand-in for the failures the app actually produces, so the tests exercise
// the same shapes the batch tasks emit rather than invented ones.
function dummyError(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    severity: "error",
    title: "Image download failed",
    detail: "403 Forbidden",
    source: "someartist",
    dedupeKey: "image-download-failed",
    ...overrides,
  };
}

function dummySuccess(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    severity: "success",
    title: "Sync complete",
    ...overrides,
  };
}

/** Feeds `n` identical failures at `stepMs` apart, starting at `start`. */
function burst(
  list: AppNotification[],
  n: number,
  start: number,
  stepMs = 100,
  input: NotifyInput = dummyError(),
): AppNotification[] {
  let out = list;
  for (let i = 0; i < n; i += 1) {
    out = addNotification(out, input, start + i * stepMs);
  }
  return out;
}

class FakeStorage implements NotificationStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

beforeEach(() => {
  resetIdCounter();
});

describe("addNotification", () => {
  it("adds a first notification unread with count 1", () => {
    const list = addNotification([], dummyError(), 1000);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(1);
    expect(list[0].read).toBe(false);
    expect(list[0].firstAt).toBe(1000);
    expect(list[0].lastAt).toBe(1000);
  });

  it("puts the newest notification first", () => {
    let list = addNotification([], dummyError({ title: "first" }), 1000);
    list = addNotification(list, dummyError({ title: "second", dedupeKey: "b" }), 2000);
    expect(list.map(n => n.title)).toEqual(["second", "first"]);
  });

  it("never mutates the input array", () => {
    const original = addNotification([], dummyError(), 1000);
    const snapshot = [...original];
    addNotification(original, dummySuccess(), 2000);
    expect(original).toEqual(snapshot);
  });

  // The whole point of the dedupe key: one batch failing 50 files is one card.
  it("coalesces a burst of 50 identical failures into a single entry", () => {
    const list = burst([], 50, 1000, 10);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(50);
    expect(list[0].firstAt).toBe(1000);
    expect(list[0].lastAt).toBe(1000 + 49 * 10);
  });

  it("keeps failures with different dedupe keys apart", () => {
    let list = addNotification([], dummyError({ dedupeKey: "image" }), 1000);
    list = addNotification(list, dummyError({ dedupeKey: "comment" }), 1100);
    expect(list).toHaveLength(2);
    expect(list.every(n => n.count === 1)).toBe(true);
  });

  it("does not coalesce without a dedupe key", () => {
    let list = addNotification([], dummyError({ dedupeKey: undefined }), 1000);
    list = addNotification(list, dummyError({ dedupeKey: undefined }), 1100);
    expect(list).toHaveLength(2);
  });

  it("starts a new entry once the coalesce window has passed", () => {
    let list = addNotification([], dummyError(), 1000);
    list = addNotification(list, dummyError(), 1000 + COALESCE_WINDOW_MS + 1);
    expect(list).toHaveLength(2);
  });

  it("still coalesces exactly on the window boundary", () => {
    let list = addNotification([], dummyError(), 1000);
    list = addNotification(list, dummyError(), 1000 + COALESCE_WINDOW_MS);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(2);
  });

  it("keeps the freshest detail when coalescing", () => {
    let list = addNotification([], dummyError({ detail: "403 Forbidden" }), 1000);
    list = addNotification(list, dummyError({ detail: "500 Server Error" }), 1100);
    expect(list[0].detail).toBe("500 Server Error");
    expect(list[0].count).toBe(2);
  });

  it("resurfaces a coalesced entry that had already been read", () => {
    let list = addNotification([], dummyError(), 1000);
    list = markAllRead(list);
    expect(unreadCount(list)).toBe(0);
    list = addNotification(list, dummyError(), 1100);
    expect(unreadCount(list)).toBe(1);
    expect(list[0].count).toBe(2);
  });

  it("re-opens the toast of a coalesced entry the user had closed", () => {
    let list = addNotification([], dummyError(), 1000);
    list = closeToast(list, list[0].id, 1050);
    expect(activeToasts(list, 1060)).toHaveLength(0);
    list = addNotification(list, dummyError(), 1100);
    expect(activeToasts(list, 1110)).toHaveLength(1);
  });

  it("moves a coalesced entry back to the top of the log", () => {
    let list = addNotification([], dummyError({ dedupeKey: "old" }), 1000);
    list = addNotification(list, dummyError({ dedupeKey: "new" }), 1100);
    list = addNotification(list, dummyError({ dedupeKey: "old" }), 1200);
    expect(list[0].dedupeKey).toBe("old");
    expect(list).toHaveLength(2);
  });

  it("caps history at MAX_HISTORY, dropping the oldest", () => {
    let list: AppNotification[] = [];
    for (let i = 0; i < MAX_HISTORY + 20; i += 1) {
      list = addNotification(list, dummyError({ title: `e${i}`, dedupeKey: `k${i}` }), 1000 + i);
    }
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].title).toBe(`e${MAX_HISTORY + 19}`);
    expect(list.some(n => n.title === "e0")).toBe(false);
  });
});

describe("read state", () => {
  it("counts only unread entries", () => {
    let list = burst([], 3, 1000, COALESCE_WINDOW_MS * 2);
    expect(unreadCount(list)).toBe(3);
    list = markRead(list, list[1].id);
    expect(unreadCount(list)).toBe(2);
  });

  it("marks everything read at once", () => {
    const list = markAllRead(burst([], 4, 1000, COALESCE_WINDOW_MS * 2));
    expect(unreadCount(list)).toBe(0);
  });

  it("removes a single entry", () => {
    const list = burst([], 3, 1000, COALESCE_WINDOW_MS * 2);
    const target = list[1].id;
    const after = removeNotification(list, target);
    expect(after).toHaveLength(2);
    expect(after.some(n => n.id === target)).toBe(false);
  });

  it("clears the whole log", () => {
    expect(clearAll()).toEqual([]);
  });
});

describe("toast lifecycle", () => {
  it("keeps error toasts on screen indefinitely", () => {
    const list = addNotification([], dummyError(), 1000);
    expect(activeToasts(list, 1000 + TOAST_TTL_MS * 100)).toHaveLength(1);
  });

  it("keeps warning toasts on screen indefinitely", () => {
    const list = addNotification([], dummyError({ severity: "warning" }), 1000);
    expect(activeToasts(list, 1000 + TOAST_TTL_MS * 100)).toHaveLength(1);
  });

  it("expires success toasts after the TTL", () => {
    const list = addNotification([], dummySuccess(), 1000);
    expect(activeToasts(list, 1000 + TOAST_TTL_MS - 1)).toHaveLength(1);
    expect(activeToasts(list, 1000 + TOAST_TTL_MS)).toHaveLength(0);
  });

  it("expires info toasts after the TTL", () => {
    const list = addNotification([], dummySuccess({ severity: "info" }), 1000);
    expect(activeToasts(list, 1000 + TOAST_TTL_MS)).toHaveLength(0);
  });

  it("keeps an expired toast in the log", () => {
    const list = addNotification([], dummySuccess(), 1000);
    expect(activeToasts(list, 1000 + TOAST_TTL_MS)).toHaveLength(0);
    expect(list).toHaveLength(1);
    expect(unreadCount(list)).toBe(1);
  });

  it("hides a toast the user closed but keeps the log entry", () => {
    let list = addNotification([], dummyError(), 1000);
    list = closeToast(list, list[0].id, 1500);
    expect(activeToasts(list, 1600)).toHaveLength(0);
    expect(list).toHaveLength(1);
  });

  it("shows at most MAX_TOASTS at once", () => {
    const list = burst([], 10, 1000, COALESCE_WINDOW_MS * 2, dummyError({ dedupeKey: undefined }));
    expect(list.length).toBeGreaterThan(MAX_TOASTS);
    expect(activeToasts(list, 100000)).toHaveLength(MAX_TOASTS);
  });

  it("reports a pending countdown only while a transient toast is live", () => {
    const list = addNotification([], dummySuccess(), 1000);
    expect(hasExpiringToast(list, 1000)).toBe(true);
    expect(hasExpiringToast(list, 1000 + TOAST_TTL_MS)).toBe(false);
  });

  it("reports no countdown for sticky-only toasts, so the UI can stay idle", () => {
    const list = addNotification([], dummyError(), 1000);
    expect(hasExpiringToast(list, 1000)).toBe(false);
  });

  it("restarts the countdown when a transient toast coalesces", () => {
    let list = addNotification([], dummySuccess({ dedupeKey: "saved" }), 1000);
    expect(hasExpiringToast(list, 1000 + TOAST_TTL_MS)).toBe(false);
    list = addNotification(list, dummySuccess({ dedupeKey: "saved" }), 1000 + TOAST_TTL_MS);
    expect(hasExpiringToast(list, 1000 + TOAST_TTL_MS)).toBe(true);
  });
});

describe("relativeBucket", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("calls anything under a minute 'now'", () => {
    expect(relativeBucket(0, 59_999)).toEqual({ unit: "now" });
  });

  it("switches to minutes at exactly one minute", () => {
    expect(relativeBucket(0, MIN)).toEqual({ unit: "minute", value: 1 });
  });

  it("rounds minutes down", () => {
    expect(relativeBucket(0, 59 * MIN + 59_000)).toEqual({ unit: "minute", value: 59 });
  });

  it("switches to hours at exactly one hour", () => {
    expect(relativeBucket(0, HOUR)).toEqual({ unit: "hour", value: 1 });
  });

  it("switches to days at exactly one day", () => {
    expect(relativeBucket(0, DAY)).toEqual({ unit: "day", value: 1 });
  });

  it("keeps hours right up to the day boundary", () => {
    expect(relativeBucket(0, DAY - 1000)).toEqual({ unit: "hour", value: 23 });
  });

  // Clock skew or a timestamp restored from the future must not render "-3m ago".
  it("clamps future timestamps to 'now'", () => {
    expect(relativeBucket(10_000, 0)).toEqual({ unit: "now" });
  });
});

describe("persistence", () => {
  it("round-trips a log through storage", () => {
    const storage = new FakeStorage();
    let list = addNotification([], dummyError(), 1000);
    list = addNotification(list, dummySuccess({ dedupeKey: "s" }), 2000);
    saveNotifications(storage, list);

    const loaded = loadNotifications(storage);
    expect(loaded).toHaveLength(2);
    expect(loaded.map(n => n.title)).toEqual(list.map(n => n.title));
    expect(loaded[0].severity).toBe("success");
  });

  it("preserves read state and counts across a reload", () => {
    const storage = new FakeStorage();
    let list = burst([], 7, 1000, 10);
    list = markAllRead(list);
    saveNotifications(storage, list);

    const loaded = loadNotifications(storage);
    expect(loaded[0].count).toBe(7);
    expect(loaded[0].read).toBe(true);
    expect(unreadCount(loaded)).toBe(0);
  });

  it("preserves the action ref so a restored entry stays retryable", () => {
    const storage = new FakeStorage();
    const list = addNotification(
      [],
      dummyError({ action: { kind: "open-downloads" } }),
      1000,
    );
    saveNotifications(storage, list);
    expect(loadNotifications(storage)[0].action).toEqual({ kind: "open-downloads" });
  });

  // A stale error re-popping as a toast on launch would be pure noise.
  it("does not re-show restored entries as toasts", () => {
    const storage = new FakeStorage();
    saveNotifications(storage, addNotification([], dummyError(), 1000));
    const loaded = loadNotifications(storage);
    expect(activeToasts(loaded, 1000)).toHaveLength(0);
    expect(unreadCount(loaded)).toBe(1);
  });

  it("returns an empty log when nothing is stored", () => {
    expect(loadNotifications(new FakeStorage())).toEqual([]);
  });

  it("survives corrupt JSON", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    expect(loadNotifications(storage)).toEqual([]);
  });

  it("survives a stored value that isn't an array", () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, '{"nope":true}');
    expect(loadNotifications(storage)).toEqual([]);
  });

  it("drops malformed entries but keeps the good ones", () => {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "ok", severity: "error", title: "kept", lastAt: 5 },
        { id: "missing-title", severity: "error", lastAt: 5 },
        { id: "bad-severity", severity: "catastrophe", title: "x", lastAt: 5 },
        null,
        "just a string",
      ]),
    );
    const loaded = loadNotifications(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("kept");
  });

  it("defaults a missing count to 1 rather than NaN", () => {
    const storage = new FakeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "a", severity: "error", title: "t", lastAt: 5 }]),
    );
    expect(loadNotifications(storage)[0].count).toBe(1);
  });

  it("does not throw when storage is unavailable", () => {
    const broken: NotificationStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadNotifications(broken)).toEqual([]);
    expect(() => saveNotifications(broken, [])).not.toThrow();
  });

  it("caps what it writes to MAX_HISTORY", () => {
    const storage = new FakeStorage();
    let list: AppNotification[] = [];
    for (let i = 0; i < MAX_HISTORY + 50; i += 1) {
      list = addNotification(list, dummyError({ dedupeKey: `k${i}` }), 1000 + i);
    }
    saveNotifications(storage, list);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toHaveLength(MAX_HISTORY);
  });
});
