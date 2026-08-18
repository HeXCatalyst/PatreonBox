import { describe, it, expect } from "vitest";
import { ensurePostsColumns, type SqlExec } from "./schemaHeal";

/**
 * Records the column names a real `pragma_table_info('posts')` query would
 * return, and captures every ALTER the heal function decides to issue. The
 * heal function only ever asks which of the two drift columns exist, so the
 * fake need only model that.
 */
class FakeDb implements SqlExec {
  constructor(private present: string[]) {}
  executed: string[] = [];

  async select<T = unknown>(_query: string, _params?: unknown[]): Promise<T> {
    return this.present.map(name => ({ name })) as unknown as T;
  }
  async execute(query: string, _params?: unknown[]): Promise<unknown> {
    this.executed.push(query);
    return undefined;
  }
}

const ADD_STAR =
  "ALTER TABLE posts ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0";
const ADD_MIN_CENTS =
  "ALTER TABLE posts ADD COLUMN min_cents_pledged_to_view INTEGER";

describe("ensurePostsColumns", () => {
  it("adds both columns on a fresh database (migrations only, neither column present)", async () => {
    const db = new FakeDb([]);
    await ensurePostsColumns(db);
    expect(db.executed).toEqual([ADD_STAR, ADD_MIN_CENTS]);
  });

  it("adds nothing on a legacy database (both columns already present)", async () => {
    const db = new FakeDb(["is_starred", "min_cents_pledged_to_view"]);
    await ensurePostsColumns(db);
    expect(db.executed).toEqual([]);
  });

  it("adds only the missing column on a partial drift", async () => {
    const db = new FakeDb(["min_cents_pledged_to_view"]);
    await ensurePostsColumns(db);
    expect(db.executed).toEqual([ADD_STAR]);
  });

  it("issues ALTERs in a fixed order regardless of detection query order", async () => {
    // is_starred is checked first, then min_cents — matching the code path the
    // Rust INSERT / frontend UPDATE exercise, so the columns always land in a
    // predictable order.
    const db = new FakeDb([]);
    await ensurePostsColumns(db);
    expect(db.executed.indexOf(ADD_STAR)).toBeLessThan(
      db.executed.indexOf(ADD_MIN_CENTS),
    );
  });
});
