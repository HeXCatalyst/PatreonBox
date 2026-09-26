import { describe, it, expect, vi } from "vitest";
import {
  LEGACY_TRIGGER_SQL,
  PRODUCTION_FTS_CREATE,
  PRODUCTION_TRIGGER_SQL,
} from "./db.searchGate.fixtures";

/**
 * R1 — the posts-list FTS gate must mirror the backend's index-state criteria.
 *
 * The gate (hasFtsIndex in ./db) decides MATCH vs LIKE for list searches. The
 * independent review found two gaps in the old gate, both reproduced by cases
 * below against a mocked sqlite_master (the *real database* acceptance lives
 * in db.searchGate.sqlite.test.ts):
 *
 * 1. It probed only the posts_fts_au trigger, while the backend's
 *    fts_triggers_current checks ai/ad/au — an index missing its insert or
 *    delete trigger looks "current" to the gate, MATCH silently misses new
 *    posts, and no repair is requested (mixed-shape cases below).
 * 2. It treated "no au trigger" as "no index at all", so a posts_fts table
 *    with every trigger missing walked LIKE forever without self-healing —
 *    it never distinguished "index absent" (stay lazy) from "index present
 *    but incomplete" (LIKE + background repair).
 *
 * The gate now takes one combined sqlite_master round trip (table DDL + all
 * three trigger DDLs) and applies the backend's exact criteria: table exists
 * in external-content mode (content='posts') + all three triggers present +
 * 'delete' command in ad/au + WHEN guard in au.
 *
 * The "current form" samples are parsed at runtime from the backend's own
 * source (see ./db.searchGate.fixtures), so the mock answers sqlite_master
 * with the *production* trigger DDL verbatim — a fictional sample can no
 * longer drift from the real definition. The "old form" sample is the
 * hand-written historical shape the pre-fix backend left behind.
 *
 * hasFtsIndex / buildPostsFilter / resolvePostsFilter are module-private, so
 * every case drives the public getPostsPage and observes (a) the SQL text the
 * fake db receives — the page query embeds the filter's whereSql verbatim, so
 * MATCH-vs-LIKE is visible there — and (b) the mocked invoke call record.
 * Module state (ftsIndexAvailable, dbInstance, refreshInFlight) is shared
 * between cases, so each case re-imports a fresh module via vi.resetModules().
 */

// Hoisted: vi.mock factories are lifted above every import, so the state they
// close over must exist before any of them run.
const mocks = vi.hoisted(() => ({
  // The FakeDb the mocked Database.load hands to getDb().
  db: null as unknown,
  // First argument of every invoke() call, in call order.
  invokeCommands: [] as string[],
  // Programmable invoke behaviour; null = resolve immediately. Cases that need
  // a pending invoke (the dedup test) install a () => Promise here.
  invokeImpl: null as null | (() => Promise<unknown>),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  // db.ts only ever calls Database.load('sqlite:patreonbox.db'); point it at
  // whatever FakeDb the current case installed.
  default: { load: async () => mocks.db },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    mocks.invokeCommands.push(cmd);
    return mocks.invokeImpl ? mocks.invokeImpl() : undefined;
  },
}));

/**
 * What the fake's sqlite_master carries: the posts_fts table DDL plus the
 * three trigger DDLs, each null when that object is absent. Independent
 * fields, so each case can construct exactly the drift it probes.
 */
interface FtsFixture {
  tableSql: string | null;
  ai: string | null;
  ad: string | null;
  au: string | null;
}

/** Full current production shape: external-content table + current triggers. */
const CURRENT: FtsFixture = {
  tableSql: PRODUCTION_FTS_CREATE,
  ai: PRODUCTION_TRIGGER_SQL.posts_fts_ai,
  ad: PRODUCTION_TRIGGER_SQL.posts_fts_ad,
  au: PRODUCTION_TRIGGER_SQL.posts_fts_au,
};

/** Historical shape: external-content table behind old-form triggers. */
const LEGACY: FtsFixture = {
  tableSql: PRODUCTION_FTS_CREATE,
  ai: LEGACY_TRIGGER_SQL.posts_fts_ai,
  ad: LEGACY_TRIGGER_SQL.posts_fts_ad,
  au: LEGACY_TRIGGER_SQL.posts_fts_au,
};

/**
 * Duck-typed stand-in for the sql plugin Database — the same trick
 * schemaHeal.test.ts uses (db.ts only ever calls select/execute). Dispatches
 * by SQL text and records everything it is asked, which is how the private
 * filter builder's decisions become observable from the public surface.
 */
class FakeDb {
  readonly selects: string[] = [];
  readonly executes: string[] = [];
  /** Reject the resolvePostsFilter probe (the one-row `… LIMIT 1` query). */
  failProbe = false;

  constructor(private readonly fts: FtsFixture) {}

  /** sqlite_master rows the fixture describes, as the real engine stores them. */
  private masterRows(): { name: string; sql: string }[] {
    const rows: { name: string; sql: string }[] = [];
    if (this.fts.tableSql != null) rows.push({ name: "posts_fts", sql: this.fts.tableSql });
    if (this.fts.ai != null) rows.push({ name: "posts_fts_ai", sql: this.fts.ai });
    if (this.fts.ad != null) rows.push({ name: "posts_fts_ad", sql: this.fts.ad });
    if (this.fts.au != null) rows.push({ name: "posts_fts_au", sql: this.fts.au });
    return rows;
  }

  /** How many times the gate probed sqlite_master (its re-check cadence). */
  sqliteMasterChecks(): number {
    return this.selects.filter(q => q.includes("sqlite_master")).length;
  }

  /** The classic list's page query — embeds the filter's whereSql verbatim. */
  pageQuery(): string | undefined {
    return this.selects.find(q => q.includes("LIMIT ? OFFSET ?"));
  }

  /** The one-row MATCH probe resolvePostsFilter runs before committing to FTS. */
  probeQuery(): string | undefined {
    return this.selects.find(q => q.includes("LIMIT 1"));
  }

  async select<T = unknown>(query: string, _params?: unknown[]): Promise<T> {
    this.selects.push(query);
    if (query.includes("pragma_table_info")) {
      // Both drift columns present → ensurePostsColumns issues no ALTERs.
      return ([{ name: "is_starred" }, { name: "min_cents_pledged_to_view" }] as unknown) as T;
    }
    if (query.includes("sqlite_master")) {
      // New gate: one combined probe carrying the table DDL and all three
      // trigger DDLs (recognised by its IN (...) list).
      if (query.includes("name IN")) {
        return (this.masterRows() as unknown) as T;
      }
      // Pre-fix gate shapes stay answerable so the suite also runs against
      // unrepaired code: the single posts_fts_au lookup, and the bare
      // table-existence lookup from before this whole fix round.
      if (query.includes("posts_fts_au")) {
        const au = this.masterRows().find(r => r.name === "posts_fts_au");
        return ((au ? [{ sql: au.sql }] : []) as unknown) as T;
      }
      const table = this.masterRows().find(r => r.name === "posts_fts");
      return ((table ? [{ name: "posts_fts" }] : []) as unknown) as T;
    }
    if (this.failProbe && query.includes("LIMIT 1")) {
      throw new Error("synthetic: fts5 MATCH probe rejected");
    }
    if (query.includes("COUNT(*)")) {
      return ([{ n: 0 }] as unknown) as T;
    }
    // Creator dedup (no rows), a successful probe, page rows: empty is fine.
    return ([] as unknown) as T;
  }

  async execute(query: string, _params?: unknown[]): Promise<unknown> {
    this.executes.push(query);
    return { rowsAffected: 0 };
  }
}

/** Fresh ./db module state + the fake db behind the mocked plugin, per case. */
async function loadDb(fts: FtsFixture, failProbe = false) {
  vi.resetModules();
  const fake = new FakeDb(fts);
  fake.failProbe = failProbe;
  mocks.db = fake;
  mocks.invokeCommands.length = 0;
  mocks.invokeImpl = null;
  const mod = await import("./db");
  return { mod, fake };
}

/** Let every pending microtask settle (refresh chains, dedup cleanup). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const refreshCalls = () =>
  mocks.invokeCommands.filter(c => c === "refresh_search_index").length;

/** Expect the list to have walked LIKE (page query) and fired exactly n repairs. */
async function expectLikeWithRepair(page: string | undefined, repairs: number) {
  expect(page).toBeDefined();
  expect(page).toContain("LIKE");
  expect(page).not.toContain("MATCH");
  await flush();
  expect(refreshCalls()).toBe(repairs);
}

describe("posts list search FTS gate (R1: backend-criteria aware, mocked)", () => {
  it("fixture sanity: the runtime-parsed production DDL carries the current-form contract", () => {
    // Guards the "sample == production definition" invariant the review
    // flagged: the fixtures module parses search.rs verbatim, so these
    // assertions document what the backend's fts_triggers_current /
    // fts_is_external_content actually accept.
    expect(Object.keys(PRODUCTION_TRIGGER_SQL).sort()).toEqual([
      "posts_fts_ad",
      "posts_fts_ai",
      "posts_fts_au",
    ]);
    expect(PRODUCTION_FTS_CREATE.toLowerCase()).toContain("content='posts'");
    expect(PRODUCTION_TRIGGER_SQL.posts_fts_ad.toLowerCase()).toContain("'delete'");
    expect(PRODUCTION_TRIGGER_SQL.posts_fts_au.toLowerCase()).toContain("'delete'");
    expect(PRODUCTION_TRIGGER_SQL.posts_fts_au.toLowerCase()).toContain("when");
    // …while the legacy sample really is the old form.
    expect(LEGACY_TRIGGER_SQL.posts_fts_ad.toLowerCase()).not.toContain("'delete'");
    expect(LEGACY_TRIGGER_SQL.posts_fts_au.toLowerCase()).not.toContain("'delete'");
    expect(LEGACY_TRIGGER_SQL.posts_fts_au.toLowerCase()).not.toContain("when");
  });

  it("legacy old-form triggers: LIKE branch + background refresh_search_index fires", async () => {
    // Realistic drift: the posts_fts table exists behind the OLD trigger
    // batch — the exact state a failed/incomplete upgrade leaves.
    const { mod, fake } = await loadDb(LEGACY);
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await expectLikeWithRepair(fake.pageQuery(), 1);
  });

  it("current production shape: FTS MATCH branch", async () => {
    // Full current state per the backend's criteria: external-content table
    // + all three current-form triggers.
    const { mod, fake } = await loadDb(CURRENT);
    await mod.getPostsPage({ search: "word" }, 0, 20);
    const page = fake.pageQuery();
    expect(page).toBeDefined();
    expect(page).toContain("MATCH");
    expect(page).not.toContain("LIKE");
  });

  it("mixed shape (current au, missing ai): LIKE branch + repair requested", async () => {
    // The review's primary gap: the old gate's single au probe read this as
    // current, served MATCH off an index that misses every new post, and
    // never requested the repair.
    const { mod, fake } = await loadDb({ ...CURRENT, ai: null });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await expectLikeWithRepair(fake.pageQuery(), 1);
  });

  it("mixed shape (current au, missing ad): LIKE branch + repair requested", async () => {
    // Same gap through the delete trigger: deletions would drift silently.
    const { mod, fake } = await loadDb({ ...CURRENT, ad: null });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await expectLikeWithRepair(fake.pageQuery(), 1);
  });

  it("missing au (ai/ad current): LIKE branch + repair requested", async () => {
    // An index that exists but lacks its update trigger is incomplete — not
    // "absent": the repair must still fire (old gate invoked nothing here).
    const { mod, fake } = await loadDb({ ...CURRENT, au: null });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await expectLikeWithRepair(fake.pageQuery(), 1);
  });

  it("table present, all triggers missing: LIKE branch + repair requested", async () => {
    // The review's second gap: "no au trigger" used to mean "no index" →
    // LIKE forever, never self-healing. The table exists, so the repair fires.
    const { mod, fake } = await loadDb({
      tableSql: PRODUCTION_FTS_CREATE,
      ai: null,
      ad: null,
      au: null,
    });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await expectLikeWithRepair(fake.pageQuery(), 1);
  });

  it("self-contained table mode behind current triggers: LIKE branch + repair requested", async () => {
    // fts_is_external_content would reject this table (no content='posts'),
    // so the backend recreates it — the gate must not drive MATCH off it.
    const { mod, fake } = await loadDb({
      ...CURRENT,
      tableSql: "CREATE VIRTUAL TABLE posts_fts USING fts5(title, content_rendered_html)",
    });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await expectLikeWithRepair(fake.pageQuery(), 1);
  });

  it("no index at all: LIKE branch, nothing invoked (lazy creation preserved)", async () => {
    const { mod, fake } = await loadDb({ tableSql: null, ai: null, ad: null, au: null });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    const page = fake.pageQuery();
    expect(page).toBeDefined();
    expect(page).toContain("LIKE");
    expect(page).not.toContain("MATCH");
    await flush();
    // A missing index is NOT a broken one: nothing self-heals here, the first
    // SearchView search still pays for the backfill (ensure_search_index).
    expect(mocks.invokeCommands).toHaveLength(0);
  });

  it("triggers present but no posts_fts table row: LIKE branch, nothing invoked", async () => {
    // Orphaned triggers with the table gone: the index is effectively absent,
    // so the gate must stay hands-off (no backfill off a list keystroke)
    // rather than "repair" what does not exist.
    const { mod, fake } = await loadDb({ ...CURRENT, tableSql: null });
    await mod.getPostsPage({ search: "word" }, 0, 20);
    const page = fake.pageQuery();
    expect(page).toBeDefined();
    expect(page).toContain("LIKE");
    expect(page).not.toContain("MATCH");
    await flush();
    expect(mocks.invokeCommands).toHaveLength(0);
  });

  it("positive gate result is cached: one sqlite_master probe across two searches", async () => {
    const { mod, fake } = await loadDb(CURRENT);
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await mod.getPostsPage({ search: "other" }, 0, 20);
    expect(fake.sqliteMasterChecks()).toBe(1);
  });

  it("negative gate result is not cached: a stale trigger is re-probed on every search", async () => {
    const { mod, fake } = await loadDb(LEGACY);
    await mod.getPostsPage({ search: "word" }, 0, 20);
    await mod.getPostsPage({ search: "other" }, 0, 20);
    expect(fake.sqliteMasterChecks()).toBe(2);
  });

  it("background refresh is deduplicated while in flight, fires again after settling", async () => {
    const { mod } = await loadDb(LEGACY);
    // invoke stays pending until the test releases it.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mocks.invokeImpl = () => gate;

    await mod.getPostsPage({ search: "word" }, 0, 20); // fires refresh #1
    await mod.getPostsPage({ search: "other" }, 0, 20); // deduped against #1
    expect(refreshCalls()).toBe(1);

    release();
    await flush(); // refresh #1 settles, refreshInFlight clears

    await mod.getPostsPage({ search: "third" }, 0, 20); // refresh #2 allowed
    expect(refreshCalls()).toBe(2);
  });

  it("resolvePostsFilter: a failing FTS probe falls back to LIKE (regression guard)", async () => {
    const { mod, fake } = await loadDb(CURRENT, true);
    await mod.getPostsPage({ search: "word" }, 0, 20);
    // The probe really ran (and threw) before the fallback was taken.
    expect(fake.probeQuery()).toBeDefined();
    const page = fake.pageQuery();
    expect(page).toBeDefined();
    expect(page).toContain("LIKE");
    expect(page).not.toContain("MATCH");
  });
});
