import type { Creator } from "../../types/db";

/** A creator counts as "paid" for sidebar priority only when currently
 *  subscribed AND their last-known tier is paid. A cancelled paid subscription
 *  keeps `subscription_type='paid'` historically but `is_subscribed=0`, which
 *  must NOT float — it's no longer financially active. */
function isPaidActive(c: Creator): boolean {
  return c.is_subscribed === 1 && c.subscription_type === "paid";
}

/** Sort a creator list so paid-subscribed creators float to the top. The
 *  tiebreak (used within the paid group and within the non-paid group) defaults
 *  to alphabetical by name — pass a custom one for the pinned section, where
 *  the user's manual drag order (pin_order) must survive as the tiebreak so
 *  paid creators float within their group without scrambling manual order.
 *  Returns a new array; does not mutate input. */
export function sortCreatorsByPaidFirst<T extends Creator>(
  creators: readonly T[],
  tiebreak: (a: T, b: T) => number = (a, b) => a.name.localeCompare(b.name),
): T[] {
  return [...creators].sort((a, b) => {
    const ap = isPaidActive(a) ? 0 : 1;
    const bp = isPaidActive(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return tiebreak(a, b);
  });
}

/** Order the Workbench rail's continuous creator list. The rail has no
 *  section headers, so it can NOT concatenate [pinned, rest] like the classic
 *  sidebar — that buried a paid-but-unpinned creator below free pinned ones.
 *  Instead: ALL paid-active creators (pinned and unpinned) float above every
 *  free creator. Within the paid block, pinned (by pin_order) come before
 *  unpinned (alphabetical); the free block keeps the same shape so the rail's
 *  overall pinned-first silhouette is preserved inside each tier.
 *  Returns a new array; does not mutate input. */
export function sortRailCreators<T extends Creator>(creators: readonly T[]): T[] {
  const paid = creators.filter(isPaidActive);
  const free = creators.filter((c) => !isPaidActive(c));
  const byPinThenName = (a: T, b: T) => {
    const ap = a.is_pinned ? 0 : 1;
    const bp = b.is_pinned ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.is_pinned || b.is_pinned
      ? a.pin_order - b.pin_order
      : a.name.localeCompare(b.name);
  };
  return [...sortCreatorsByPaidFirst(paid, byPinThenName), ...sortCreatorsByPaidFirst(free, byPinThenName)];
}
