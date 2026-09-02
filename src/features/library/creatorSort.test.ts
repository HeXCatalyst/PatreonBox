import { describe, it, expect } from "vitest";
import { sortCreatorsByPaidFirst } from "./creatorSort";
import type { Creator } from "../../types/db";

// The sidebar groups creators into pinned (manual order) and normal sections.
// Within the normal section, paid-subscribed creators float to the top so the
// user's financially-supported artists are first; ties break alphabetically.
// This keeps the comparator pure and testable — Sidebar calls it on the
// already-filtered visibleCreators.

function mk(over: Partial<Creator> & { post_count?: number } = {}): Creator & { post_count: number } {
  return {
    id: over.id ?? "x",
    source_key: "",
    external_id: null,
    name: over.name ?? "x",
    profile_url: null,
    avatar_path: null,
    description: null,
    last_synced_at: null,
    created_at: "",
    updated_at: "",
    subscription_type: over.subscription_type ?? null,
    is_subscribed: over.is_subscribed ?? 1,
    is_pinned: 0,
    pin_order: 0,
    post_count: over.post_count ?? 0,
  };
}

describe("sortCreatorsByPaidFirst", () => {
  it("places paid-subscribed creators before free ones", () => {
    const out = sortCreatorsByPaidFirst([
      mk({ id: "free", name: "Aaa" }),
      mk({ id: "paid", name: "Zzz", subscription_type: "paid" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["paid", "free"]);
  });

  it("breaks ties alphabetically within the paid group", () => {
    const out = sortCreatorsByPaidFirst([
      mk({ id: "zoe", name: "Zoe", subscription_type: "paid" }),
      mk({ id: "amy", name: "Amy", subscription_type: "paid" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["amy", "zoe"]);
  });

  it("breaks ties alphabetically within the free/unsubscribed group", () => {
    const out = sortCreatorsByPaidFirst([
      mk({ id: "z", name: "Zoe", subscription_type: "free" }),
      mk({ id: "a", name: "Amy", subscription_type: "free" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("ignores subscription_type when is_subscribed is 0", () => {
    // A cancelled subscription has subscription_type='paid' (last known) but
    // is_subscribed=0 — it must NOT float to the top; it's just historical.
    const out = sortCreatorsByPaidFirst([
      mk({ id: "active", name: "Boo", subscription_type: "free" }),
      mk({ id: "cancelled", name: "Aaa", subscription_type: "paid", is_subscribed: 0 }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["cancelled", "active"]);
  });

  it("treats null subscription_type as non-paid", () => {
    const out = sortCreatorsByPaidFirst([
      mk({ id: "unknown", name: "Aaa", subscription_type: null }),
      mk({ id: "paid", name: "Zzz", subscription_type: "paid" }),
    ]);
    expect(out.map((c) => c.id)).toEqual(["paid", "unknown"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      mk({ id: "free", name: "Aaa" }),
      mk({ id: "paid", name: "Zzz", subscription_type: "paid" }),
    ];
    const snapshot = input.map((c) => c.id);
    sortCreatorsByPaidFirst(input);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });
});
