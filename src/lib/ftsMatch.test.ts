import { describe, it, expect } from "vitest";
import { buildFtsMatch } from "./ftsMatch";

// The list search hands this string to SQLite as `posts_fts MATCH ?`. The Rust
// backend builds its own MATCH string for the SearchView (search.rs), so these
// tests pin the shared contract: quoting must neutralise every FTS5 operator,
// and the two implementations must agree token for token.

describe("buildFtsMatch", () => {
  it("returns an empty string for an empty query", () => {
    expect(buildFtsMatch("")).toBe("");
  });

  it("returns an empty string for a whitespace-only query", () => {
    // Callers must not run `MATCH ''` — FTS5 rejects it as a syntax error.
    expect(buildFtsMatch("   \t\n ")).toBe("");
  });

  it("quotes a single token", () => {
    expect(buildFtsMatch("dragon")).toBe('"dragon"');
  });

  it("ANDs whitespace-separated tokens by joining them with a space", () => {
    expect(buildFtsMatch("dragon knight")).toBe('"dragon" "knight"');
  });

  it("collapses runs of whitespace, including newlines and tabs", () => {
    expect(buildFtsMatch("  dragon \t\n knight  ")).toBe('"dragon" "knight"');
  });

  it("doubles embedded quotes so they stay inside the quoted term", () => {
    expect(buildFtsMatch('say "hi"')).toBe('"say" """hi"""');
  });

  it("neutralises FTS5 operator characters", () => {
    // Unquoted, each of these would be a syntax error or change the query's
    // meaning; quoted, they are literal text.
    expect(buildFtsMatch("cats AND (dogs OR birds)")).toBe('"cats" "AND" "(dogs" "OR" "birds)"');
    expect(buildFtsMatch("NEAR/2")).toBe('"NEAR/2"');
    expect(buildFtsMatch("title:foo")).toBe('"title:foo"');
    expect(buildFtsMatch("wild*")).toBe('"wild*"');
    expect(buildFtsMatch("^start")).toBe('"^start"');
  });

  it("keeps a multi-character CJK term intact as one token", () => {
    // Chinese queries have no spaces; the whole phrase becomes one quoted term,
    // which is what the backend does too.
    expect(buildFtsMatch("龍騎士")).toBe('"龍騎士"');
  });

  it("does not add a leading or trailing space", () => {
    expect(buildFtsMatch("a b").startsWith(" ")).toBe(false);
    expect(buildFtsMatch("a b").endsWith(" ")).toBe(false);
  });
});