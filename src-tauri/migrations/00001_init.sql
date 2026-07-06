CREATE TABLE creators (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL,
    external_id TEXT,
    name TEXT NOT NULL,
    profile_url TEXT,
    avatar_path TEXT,
    description TEXT,
    last_synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    excerpt TEXT,
    content_raw TEXT,
    content_rendered_html TEXT,
    content_format TEXT,
    source_url TEXT,
    published_at TEXT,
    archived_at TEXT,
    has_assets INTEGER NOT NULL DEFAULT 0,
    read_state TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE
);

CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    source_url TEXT,
    local_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    media_type TEXT,
    byte_size INTEGER,
    checksum_sha256 TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE sync_runs (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    creators_scanned INTEGER NOT NULL DEFAULT 0,
    posts_imported INTEGER NOT NULL DEFAULT 0,
    assets_downloaded INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);

CREATE TABLE post_tags (
    post_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (post_id, tag),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX idx_posts_creator_id ON posts(creator_id);
CREATE INDEX idx_assets_post_id ON assets(post_id);
CREATE INDEX idx_sync_runs_source_key ON sync_runs(source_key);
