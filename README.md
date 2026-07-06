# PatreonBOX

**[English](README.md) | [中文](README.zh.md)**

A local-first desktop app for archiving, browsing, and reading your [Patreon](https://www.patreon.com) content — privately, offline, forever.

> ⚠️ This is an **unofficial**, open-source project for **personal use** only. It is not affiliated with or endorsed by Patreon, and is intended solely for the personal, offline archival of content you have legitimately subscribed to. See the [Disclaimer](#disclaimer) below.

![Library and reading view](screenshots/library.png)

<sub>Screens throughout this README use the built-in **Demo Mode** with sample content — no real account required.</sub>

---

## Features

- **3-pane reading layout** — Sidebar (creators), Post List, Reading View
- **One-click sync** — scrape your subscriptions and post content directly from Patreon
- **Image downloading** — bulk-download all post attachments to local storage
- **Full-text search** — search post titles and content across any creator
- **Starred posts** — bookmark posts and browse your collection in one place
- **Sync modes** — Normal (content + assets), Full (Normal + auto-download images)
- **Incremental sync** — stop paging early once already-synced posts are found, for quick "just the new stuff" updates
- **Pause & resume** — interrupt long syncs and pick up where you left off
- **Pinned creators** — drag-to-reorder your most-visited creators
- **Dark/light/system theme** — respects your OS preference
- **Bilingual UI** — switch between 中文 and English
- **Proxy support** — auto-detect the system proxy, set one manually, or turn it off
- **Custom storage location** — move your image library anywhere, with a verified migration
- **Configurable download timeout** — tune the per-request timeout for slow networks
- **Demo mode** — explore the interface with bundled sample content, no login required
- **Fully local** — no cloud, no tracking, no credentials stored

---

## User Guide

### First Launch

On first launch (or whenever you're not logged in), the app opens directly to **Settings → Account**.

1. **Log in to Patreon** — click **Log in to Patreon** in Settings → Account. A window opens where you sign in to Patreon; the app detects a successful login automatically and closes it.

2. **Sync your subscriptions** — click the cloud download icon (↓) in the top-left of the sidebar. The app scrapes your subscriptions, and your subscribed creators appear in the sidebar.

3. **Select a creator** — click any creator name to load their post list in the middle pane.

4. **Sync posts** — click **Sync** in the post list toolbar to download posts for that creator. Choose a sync mode first:
   - **↓ 普通 (Normal)** — full post content and asset metadata
   - **⬇ 完整 (Full)** — Normal + automatically downloads all images after sync

   Check **仅新帖** (only new posts) to stop paging as soon as an already-synced post is found — useful for a quick top-up instead of re-walking the whole feed.

5. **Read a post** — click any post row to open it in the Reading View on the right.

---

### Sync Controls

| Control | Description |
|---------|-------------|
| **Max posts** input | Limit how many posts to scrape (default: from Settings) |
| **仅新帖** checkbox | Stop paging as soon as an already-synced post is found (incremental sync) |
| **Mode** dropdown | Switch between Normal / Full before syncing |
| **⏸ Pause** | Pause mid-sync; a resume button appears with the post count |
| **↻ Resume N/...** | Continue from where the last sync stopped |
| **↓ Resync** | Discard the checkpoint and start fresh |
| **✕ Cancel** | Cancel and clear the saved checkpoint |
| **Images / ↻ Resume download** | Download (or resume downloading) all images for this creator |

---

### Starred Posts (收藏)

- Click the **☆** icon next to any post row to star it. The icon turns amber (★).
- Click **收藏** in the sidebar to see all your starred posts across all creators.
- Click ★ again (in the post row or the Reading View header) to unstar.
- When browsing 收藏, unstarring a post removes it from the view immediately.

---

### Creators Sidebar

| Feature | How |
|---------|-----|
| **Filter tabs** | All / Free / Paid / Unsub'd — filter by subscription type |
| **Search creators** | Type in the search box to filter by name |
| **Pin a creator** | Right-click → 置顶; pinned creators appear at the top with a drag handle |
| **Reorder pinned** | Drag the ⠿ grip handle to reorder pinned creators |
| **Unpin** | Right-click a pinned creator → 取消置顶 |
| **All Creators** | Select to show posts from every creator |

---

### Reading View

- **Images** — downloaded images render inline with a gallery. Use the slider (小/大) to resize thumbnails. Click any image to open the lightbox.
- **Lightbox** — zoom, pan, and navigate with arrow keys or on-screen buttons; download to your Downloads folder with the save button.
- **Original link** — click to open the original Patreon post in your browser.
- **Star** — the ★ button in the metadata row toggles the star from the Reading View.

![Full-screen image lightbox](screenshots/lightbox.png)

---

### Settings

Open **Settings** from the bottom of the sidebar. It's organized into the following sections:

| Section | What it covers |
|---------|----------------|
| **Account** | Log in to / out of Patreon. Shows your account once connected. The app opens here on launch when you're not logged in. |
| **Sync** | Default max posts, default sync mode (Normal / Full), and per-request download timeout. |
| **Network / Proxy** | Proxy mode — **Auto** (use the system proxy), **Manual** (enter a proxy URL), or **Off**. |
| **Storage** | Shows disk usage, lets you open the image folder, move it to a custom location, and migrate the existing library there with verification. |
| **Appearance** | Theme: Light / Dark / System. |
| **Language** | UI language: 中文 / English. |
| **About** | App version, and (for advanced users) a debug-output mode and a Demo Mode toggle. |

> **Defaults:** Developer options are off out of the box — Developer Mode is disabled, Demo Mode is off, and debug output is set to **none** (nothing is printed). Theme defaults to Dark and language to English.

![Settings — Sync preferences](screenshots/settings.png)

---

### Clearing Data

Click the 🗑 trash icon in the post list toolbar to delete all synced posts and images for a creator. The creator entry itself stays in the sidebar and can be re-synced anytime.

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

### Install dependencies

```bash
npm install
```

### Run in development

```bash
CC=clang npm run tauri dev
```

> **macOS note:** `CC=clang` is required — the default `gcc` toolchain fails to link on macOS.

### Build for production

```bash
CC=clang npm run tauri build
```

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Desktop shell | Tauri v2 |
| Database | SQLite via `tauri-plugin-sql` |
| Backend commands | Rust (`std::fs`, sha2 checksums) |
| Scraping | Tauri WebView windows (no undocumented APIs) |

### Project structure

```
src/
  features/
    library/        # Main 3-pane UI (Sidebar, PostList, ReadingView)
    settings/       # Settings page and context
    import/         # Browser import view
  lib/              # DB helpers, date formatting, settings loader
  types/            # TypeScript types (db.ts, settings.ts)
src-tauri/
  src/
    commands/       # Rust Tauri commands (scraping, file ops, auth, settings)
    lib.rs          # App setup, plugin registration, DB migrations
  capabilities/     # Tauri permission declarations
  migrations/       # SQL migration files
```

### How syncing works

1. **Subscription sync** — opens a sandboxed Tauri WebView window that navigates to Patreon. A content script captures creator data from the page DOM and sends it back via Tauri events. No credentials are accessed.
2. **Post sync** — a second scraper window visits each creator's Patreon page and pages through their post feed. Posts are streamed back in batches via `report_scraped_post_page` and written to SQLite.
3. **Image download** — `download_creator_images` fetches each asset URL and saves it to `$APPDATA/images/<creator_id>/`. The DB asset record is updated with the local path.

### Database

SQLite at `$APPDATA/com.hexcatalyst.patreonbox/patreonbox.db`. Schema migrations run automatically on startup from `src-tauri/migrations/`. The frontend also applies an idempotent `ALTER TABLE` for any columns added after initial release.

---

## Non-Goals

- No cloud sync
- No undocumented Patreon API calls
- No credential harvesting or cookie export
- No background scraping without user initiation
- Not for content redistribution — strictly personal archival

---

## Disclaimer

This software is an independent, unofficial tool. It is **not** affiliated with,
endorsed by, or connected to Patreon in any way.

It is intended solely for the **personal, offline archival of content you have
legitimately subscribed to and are authorized to access**. You are solely
responsible for how you use it, including compliance with
[Patreon's Terms of Use](https://www.patreon.com/policy/legal) and all applicable
laws in your jurisdiction. Do **not** use it to redistribute, resell, or publicly
share creators' paid content.

The software is provided "as is", without warranty of any kind. The author accepts
no liability for any misuse, account action, data loss, or other damages arising
from its use. If you do not agree with these terms, do not use this software.

## License

Released under the [MIT License](LICENSE).
