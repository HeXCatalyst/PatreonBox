import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Shared fixtures for the two search-gate test files
 * (db.searchGate.test.ts — mocked sqlite_master; db.searchGate.sqlite.test.ts
 * — real node:sqlite acceptance).
 *
 * The "current form" samples are NOT hand-written: they are parsed at runtime
 * out of the backend's own source (src-tauri/src/commands/search.rs), the same
 * raw-string consts that create the production index. That closes the gap the
 * independent review flagged — a fictional sample trigger can drift from the
 * real definition without any test noticing. Parsing is read-only text
 * matching; the backend file is never executed or modified here.
 *
 * The "legacy form" sample IS hand-written on purpose: that historical shape
 * only exists inside search.rs's #[cfg(test)] module as
 * create_legacy_external_fts, and copying test code out of the backend at
 * runtime would be a different (and worse) kind of coupling. It mirrors the
 * pre-fix triggers: plain DELETE FROM statements, no WHEN guard, no FTS5
 * 'delete' command.
 */

/** The three trigger names the backend's fts_triggers_current checks. */
export type TriggerName = "posts_fts_ai" | "posts_fts_ad" | "posts_fts_au";
export type TriggerSqlMap = Record<TriggerName, string>;

/** Resolve a repo-root-relative path independent of the process cwd. */
export function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

const SEARCH_RS = readFileSync(repoPath("src-tauri/src/commands/search.rs"), "utf8");

/**
 * Extract the body of a `const NAME: &str = r#"…"#;` raw string from
 * search.rs (regex per the independent review's probe). Throws loudly when
 * the backend renames the const, instead of silently testing nothing.
 */
function rustRawString(name: string): string {
  const match = SEARCH_RS.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  if (!match) {
    throw new Error(
      `search.rs no longer declares const ${name}: &str = r#"…"#; — the DDL parser needs updating`,
    );
  }
  return match[1];
}

/** Split a CREATE TRIGGER batch into per-trigger DDL keyed by trigger name. */
function splitTriggers(batch: string): TriggerSqlMap {
  const out = {} as TriggerSqlMap;
  const pattern = /CREATE TRIGGER IF NOT EXISTS (posts_fts_a[a-z]+)[\s\S]*?END;/g;
  for (const match of batch.matchAll(pattern)) {
    out[match[1] as TriggerName] = match[0];
  }
  return out;
}

/** Production external-content FTS table DDL (POSTS_FTS_CREATE, verbatim). */
export const PRODUCTION_FTS_CREATE = rustRawString("POSTS_FTS_CREATE");

/** Production trigger batch (POSTS_FTS_TRIGGERS, verbatim) — exec-able as one string. */
export const PRODUCTION_FTS_TRIGGERS = rustRawString("POSTS_FTS_TRIGGERS");

/** The same production triggers, one DDL per name — what sqlite_master rows carry. */
export const PRODUCTION_TRIGGER_SQL: TriggerSqlMap = splitTriggers(PRODUCTION_FTS_TRIGGERS);

/**
 * Historical trigger batch (pre-fix backend form; see create_legacy_external_fts
 * in search.rs's test module): plain DELETE FROM the FTS table and an unguarded
 * UPDATE trigger — the shape whose drift (stale tokens after an update) the
 * current-form triggers fix. Exec-able as one string.
 */
export const LEGACY_FTS_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, content_rendered_html)
    VALUES (new.rowid, new.title, new.content_rendered_html);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
    DELETE FROM posts_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
    DELETE FROM posts_fts WHERE rowid = old.rowid;
    INSERT INTO posts_fts(rowid, title, content_rendered_html)
    VALUES (new.rowid, new.title, new.content_rendered_html);
END;
`;

/** The same legacy triggers, one DDL per name. */
export const LEGACY_TRIGGER_SQL: TriggerSqlMap = splitTriggers(LEGACY_FTS_TRIGGERS);
