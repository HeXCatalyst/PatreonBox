-- A successful empty response is cached too. NULL means no recorded success;
-- existing non-empty comment caches remain usable without a forced re-fetch.
ALTER TABLE posts ADD COLUMN comments_fetched_at TEXT;
