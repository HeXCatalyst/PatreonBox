import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  LEGACY_FTS_TRIGGERS,
  PRODUCTION_FTS_CREATE,
  PRODUCTION_FTS_TRIGGERS,
  repoPath,
} from "./db.searchGate.fixtures";

/**
 * Real-SQLite acceptance for the posts-list search FTS gate (independent
 * review, acceptance requirement 3).
 *
 * db.searchGate.test.ts proves the gate's decision *logic* against a mocked
 * sqlite_master; these tests prove the decision is *correct against a real
 * database carrying the production schema and the production index DDL*:
 * every case builds an actual index state (parsed at runtime from
 * src-tauri/src/commands/search.rs, never hand-copied), puts real posts rows
 * behind it, and drives the public getPostsPage.
 *
 * Every case asserts the FIXED semantics, not the bug the review's probe
 * recorded: a post the index has silently missed must still be found by the
 * list (LIKE), and any existing-but-incomplete index must request exactly one
 * deduplicated background repair (refresh_search_index). Only a fully missing
 * index stays hands-off (lazy creation).
 */

const mocks = vi.hoisted(() => ({ load: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: mocks.load } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let sqlite: DatabaseSync;
let mod: typeof import("./db");

beforeEach(async () => {
  vi.resetModules();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  sqlite = new DatabaseSync(":memory:");
  // Production schema from the real migration; creators.is_pinned arrives in
  // a later migration and the fixture creator is fully fictional (review
  // privacy rules: no real subscription data anywhere in these fixtures).
  sqlite.exec(readFileSync(repoPath("src-tauri/migrations/00001_init.sql"), "utf8"));
  sqlite.exec(`ALTER TABLE creators ADD COLUMN is_pinned INTEGER DEFAULT 0;
    INSERT INTO creators(id, source_key, name, created_at, updated_at)
      VALUES('c1','patreon','Example Creator','test','test');`);
  // The sql plugin is mocked onto the real database: every select/execute the
  // production code issues runs as real SQLite.
  mocks.load.mockResolvedValue({
    select: async (q: string, params: any[] = []) => sqlite.prepare(q).all(...params),
    execute: async (q: string, params: any[] = []) => sqlite.prepare(q).run(...params),
  });
  mod = await import("./db");
});
afterEach(() => sqlite.close());

/** Fictional post, same shape the review probe used. */
function insertPost(id = "101", title = "newword") {
  sqlite.exec(`INSERT INTO posts(id,creator_id,source_key,title,content_raw,content_rendered_html,created_at,updated_at)
    VALUES('${id}','c1','patreon','${title}','newbody','newbody','test','test');`);
}

/** Build the index exactly as production would: external-content table +
 * current triggers + one backfill rebuild. Safe with or without posts rows. */
function buildCurrentFts() {
  sqlite.exec(PRODUCTION_FTS_CREATE);
  sqlite.exec(PRODUCTION_FTS_TRIGGERS);
  sqlite.exec("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')");
}

/** Ground truth straight on the index — what MATCH would really return. */
function ftsMatchCount(term: string): number {
  const row = sqlite
    .prepare("SELECT count(*) AS n FROM posts_fts WHERE posts_fts MATCH ?")
    .get(term) as { n: number | bigint } | undefined;
  return Number(row?.n ?? 0);
}

/** Let pending microtasks settle (the background repair chain). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const refreshCalls = () =>
  mocks.invoke.mock.calls.filter(call => call[0] === "refresh_search_index").length;

describe("posts list search FTS gate (real SQLite)", () => {
  it("missing posts_fts_ai (au/ad current): LIKE still finds the post, repair requested", async () => {
    // Review scenario 1: au is current, ai is not. Posts inserted afterwards
    // never enter the index — MATCH silently returns 0 for a post that exists.
    buildCurrentFts();
    sqlite.exec("DROP TRIGGER posts_fts_ai");
    insertPost();
    expect(ftsMatchCount("newword")).toBe(0); // proof the post really is unindexed

    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    await flush();
    expect(refreshCalls()).toBe(1);
  });

  it("missing posts_fts_ad (ai/au current): LIKE result correct, repair requested", async () => {
    // Structurally incomplete even though the inserted post happens to be in
    // sync (ai indexed it): deletions would silently drift. The gate must
    // match the backend's three-trigger criterion, not just "results look
    // right" — that is exactly the check the old gate lacked.
    buildCurrentFts();
    sqlite.exec("DROP TRIGGER posts_fts_ad");
    insertPost();

    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    await flush();
    expect(refreshCalls()).toBe(1);
  });

  it("missing posts_fts_au (ai/ad current): LIKE result correct, repair requested", async () => {
    buildCurrentFts();
    sqlite.exec("DROP TRIGGER posts_fts_au");
    insertPost();

    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    await flush();
    expect(refreshCalls()).toBe(1);
  });

  it("table exists but all three triggers missing: LIKE correct AND repair requested", async () => {
    // Review scenario 2: the old gate read "no au trigger" as "no index" and
    // never self-healed. The table exists, so the index is incomplete, not
    // absent — the list must take LIKE *and* kick the background repair.
    buildCurrentFts();
    sqlite.exec("DROP TRIGGER posts_fts_ai; DROP TRIGGER posts_fts_ad; DROP TRIGGER posts_fts_au;");
    insertPost();

    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    await flush();
    expect(refreshCalls()).toBe(1);
  });

  it("ordinary legacy triggers with stale index: LIKE excludes the stale term, repair requested", async () => {
    // The state the pre-fix backend actually produced (see
    // create_legacy_external_fts in search.rs's test module): external-content
    // table + old-form triggers. The old update trigger leaves pre-update
    // tokens in the index, so MATCH would serve a hit whose post no longer
    // carries the term.
    sqlite.exec(PRODUCTION_FTS_CREATE);
    sqlite.exec(LEGACY_FTS_TRIGGERS);
    insertPost("101", "oldword");
    sqlite.exec("UPDATE posts SET title='newword' WHERE id='101'");
    expect(ftsMatchCount("oldword")).toBe(1); // the stale residue really is indexed

    const fresh = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(fresh.total).toBe(1);
    await flush();
    const stale = await mod.getPostsPage({ search: "oldword" }, 0, 20);
    // MATCH would return the stale hit (total 1); only LIKE semantics give 0.
    expect(stale.total).toBe(0);
    await flush();
    // Each settled false probe retries the repair once (false is not cached).
    expect(refreshCalls()).toBe(2);
  });

  it("current production shape: FTS MATCH semantics (token match, not substring)", async () => {
    // Distinguishes MATCH from LIKE on a healthy index: a post whose title
    // embeds the term inside one token ('xxnewwordxx') is a LIKE hit but not
    // an FTS token match. total==1 proves the list really ran MATCH.
    buildCurrentFts();
    insertPost("101", "xxnewwordxx");
    insertPost("102", "newword");

    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    expect(page.posts[0]?.id).toBe("102");
    await flush();
    expect(refreshCalls()).toBe(0); // healthy index: nothing to heal
  });

  it("failed repair is retried on the next search (false is not cached)", async () => {
    // Review acceptance: "retry after failed repair". The first
    // refresh_search_index rejects; the list still returns correct results
    // via LIKE, and the next search probes again and retries the repair.
    buildCurrentFts();
    sqlite.exec("DROP TRIGGER posts_fts_ai");
    insertPost();
    mocks.invoke
      .mockReset()
      .mockRejectedValueOnce(new Error("synthetic: backend offline"))
      .mockResolvedValueOnce(undefined);

    const first = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(first.total).toBe(1);
    await flush();
    const second = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(second.total).toBe(1);
    await flush();
    expect(refreshCalls()).toBe(2);
  });

  it("self-contained (non external-content) posts_fts table: LIKE + repair requested", async () => {
    // Table exists in the wrong mode (no content='posts'): the gate must not
    // trust MATCH on it even with current-form triggers around it — the
    // backend would drop and recreate it, so the list takes LIKE and asks
    // for exactly that repair.
    sqlite.exec("CREATE VIRTUAL TABLE posts_fts USING fts5(title, content_rendered_html)");
    sqlite.exec(PRODUCTION_FTS_TRIGGERS);
    insertPost();

    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    await flush();
    expect(refreshCalls()).toBe(1);
  });

  it("no posts_fts table at all: LIKE correct, zero invokes (lazy creation preserved)", async () => {
    // A missing index is not a broken one: the first global search still pays
    // for the backfill, and a list keystroke must never trigger it.
    insertPost();
    const page = await mod.getPostsPage({ search: "newword" }, 0, 20);
    expect(page.total).toBe(1);
    await flush();
    expect(mocks.invoke.mock.calls.length).toBe(0);
  });
});
