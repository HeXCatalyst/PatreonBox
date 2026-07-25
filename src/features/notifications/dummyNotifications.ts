import type { Translations } from "../../lib/i18n";
import type { NotifyInput } from "./store";

/**
 * Developer-mode helper: replays the notification shapes the real batch tasks
 * emit, so the toast stack, the coalescing counter and the centre can be
 * checked by eye. Nothing here touches the network or the database.
 *
 * The behavioural guarantees (coalescing, expiry, capping, persistence) are
 * covered by store.test.ts — this is only for looking at the result.
 */
export function emitDummyNotifications(
  notify: (input: NotifyInput) => void,
  t: Translations,
): void {
  const n = t.notifications;

  notify({
    severity: "success",
    title: n.commentFetchDone(42),
    dedupeKey: "demo-success",
  });

  notify({
    severity: "warning",
    title: n.commentFetchFailed,
    detail: "429 Too Many Requests",
    source: "example-creator",
    dedupeKey: "demo-warning",
  });

  notify({
    severity: "error",
    title: n.postSyncFailed,
    detail: "timed out after 90s with no progress",
    source: "someartist",
    dedupeKey: "demo-post-sync",
    action: { kind: "open-settings" },
  });

  // A burst on one key, to show 12 failures arriving as a single card.
  for (let i = 0; i < 12; i += 1) {
    notify({
      severity: "error",
      title: n.imageDownloadFailed,
      detail: "403 Forbidden (signed URL expired)",
      source: "someartist",
      dedupeKey: "demo-image-burst",
      action: { kind: "open-downloads" },
    });
  }
}
