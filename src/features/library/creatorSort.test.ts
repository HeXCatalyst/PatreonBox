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
    is_pinned: over.is_pinned ?? 0,
    pin_order: over.pin_order ?? 0,
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

  // --- Pinned section: paid-first with pin_order tiebreak ---
  // Pinned creators keep manual drag order (pin_order) as the tiebreak WITHIN
  // each group, so the user's manual reordering still works inside paid and
  // non-paid groups — paid creators just float to the top of the pinned list.

  it("uses a custom tiebreak (pin_order) for pinned creators", () => {
    const out = sortCreatorsByPaidFirst(
      [
        mk({ id: "free-b", name: "Beta", subscription_type: "free", pin_order: 5 }),
        mk({ id: "paid-b", name: "Bravo", subscription_type: "paid", pin_order: 3 }),
        mk({ id: "free-a", name: "Alpha", subscription_type: "free", pin_order: 1 }),
        mk({ id: "paid-a", name: "Alpha", subscription_type: "paid", pin_order: 7 }),
      ],
      (a, b) => a.pin_order - b.pin_order,
    );
    // Paid group by pin_order: paid-b(3), paid-a(7)
    // Free group by pin_order: free-a(1), free-b(5)
    expect(out.map((c) => c.id)).toEqual(["paid-b", "paid-a", "free-a", "free-b"]);
  });

  it("ignores cancelled paid even with a custom tiebreak", () => {
    const out = sortCreatorsByPaidFirst(
      [
        mk({ id: "active-free", name: "Boo", subscription_type: "free", pin_order: 1 }),
        mk({ id: "cancelled-paid", name: "Aaa", subscription_type: "paid", is_subscribed: 0, pin_order: 0 }),
      ],
      (a, b) => a.pin_order - b.pin_order,
    );
    // is_subscribed=0 → NOT paid-active → doesn't float; tiebreak by pin_order
    expect(out.map((c) => c.id)).toEqual(["cancelled-paid", "active-free"]);
  });

  // --- IconRail scenario: the already-subscribed list, paid floats in both
  // the pinned group (pin_order tiebreak) and the rest group (alphabetical) —
  // the Workbench rail previously sorted both groups WITHOUT paid priority. ---

  it("floats paid to the top of an already-subscribed list (IconRail rest)", () => {
    const subscribed = [
      mk({ id: "free-ana", name: "Ana", subscription_type: "free" }),
      mk({ id: "paid-zed", name: "Zed", subscription_type: "paid" }),
      mk({ id: "free-bob", name: "Bob", subscription_type: "free" }),
    ];
    const out = sortCreatorsByPaidFirst(subscribed);
    expect(out.map((c) => c.id)).toEqual(["paid-zed", "free-ana", "free-bob"]);
  });

  it("floats paid to the top of pinned entries (IconRail pinned)", () => {
    const out = sortCreatorsByPaidFirst(
      [
        mk({ id: "free-1", name: "Aaa", subscription_type: "free", pin_order: 1 }),
        mk({ id: "paid-3", name: "Ccc", subscription_type: "paid", pin_order: 3 }),
        mk({ id: "free-2", name: "Bbb", subscription_type: "free", pin_order: 2 }),
        mk({ id: "paid-0", name: "Ddd", subscription_type: "paid", pin_order: 0 }),
      ],
      (a, b) => a.pin_order - b.pin_order,
    );
    // paid-0(0), paid-3(3) — then free-1(1), free-2(2)
    expect(out.map((c) => c.id)).toEqual(["paid-0", "paid-3", "free-1", "free-2"]);
  });
});
