/**
 * Turn a user query into a safe FTS5 MATCH string — the exact semantics of the
 * backend's `build_fts_match` (src-tauri/src/commands/search.rs).
 *
 * Each whitespace-separated token becomes one double-quoted term, with any
 * embedded `"` doubled so it stays inside the quotes, and terms are joined by
 * whitespace (FTS5's implicit AND). Quoting is what makes arbitrary input safe:
 * inside a quoted string FTS5 treats `AND`/`OR`/`NOT`/`NEAR`, `*`, `^`, `:` and
 * parentheses as literal text, so a query like `cats AND (dogs` is searched for
 * rather than parsed. A malformed MATCH is therefore not expected — callers
 * still keep a LIKE fallback for the case where it happens anyway.
 *
 * Returns "" for an empty or whitespace-only query; `MATCH ''` is a syntax
 * error in FTS5, so callers must treat that as "no FTS clause" and fall back.
 */
export function buildFtsMatch(query: string): string {
  return query
    .split(/\s+/)
    .filter(token => token.length > 0)
    .map(token => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
}