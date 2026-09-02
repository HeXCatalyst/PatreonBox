import type { Creator } from "../../types/db";

/** A creator counts as "paid" for sidebar priority only when currently
 *  subscribed AND their last-known tier is paid. A cancelled paid subscription
 *  keeps `subscription_type='paid'` historically but `is_subscribed=0`, which
 *  must NOT float — it's no longer financially active. */
function isPaidActive(c: Creator): boolean {
  return c.is_subscribed === 1 && c.subscription_type === "paid";
}

/** Sort a creator list so paid-subscribed creators float to the top, ties
 *  broken alphabetically by name. Returns a new array; does not mutate input. */
export function sortCreatorsByPaidFirst<T extends Creator>(
  creators: readonly T[]
): T[] {
  return [...creators].sort((a, b) => {
    const ap = isPaidActive(a) ? 0 : 1;
    const bp = isPaidActive(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
}
