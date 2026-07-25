# PatreonBOX

**[English](README.md) | [中文](README.zh.md)**

A local-first desktop app for archiving, browsing, and reading your [Patreon](https://www.patreon.com) content — privately, offline, forever.

> ⚠️ This is an **unofficial**, open-source project for **personal use** only. It is not affiliated with or endorsed by Patreon, and is intended solely for the personal, offline archival of content you have legitimately subscribed to. See the [Disclaimer](#disclaimer) below.

![Workbench layout: icon rail, reading canvas, and filmstrip dock](screenshots/workbench.jpg)

<sub>Screens throughout this README use the built-in **Demo Mode** with sample content — no real account required.</sub>

---

## Features

**Reading & browsing**

- **Two layouts** — classic three panes (sidebar / post list / reading view), or **Workbench** (icon rail + reading canvas + filmstrip dock)
- **Zen reading mode** — hide the surrounding chrome and keep just the text
- **Timeline** — an "all activity" river across every creator
- **⌘K command palette** — jump to a creator, switch views, run common actions
- **Media wall** — a per-creator wall (X-style) of images, video, and audio, filterable by kind
- **Time scrubber** — jump to any month in the media wall
- **Post comments** — fetched and cached locally, with nested replies, an author badge, and links to commenters' profiles
- **Favourites** — favourite individual images, plus a combined favourites page with creator filter and sorting
- **Full-text search** — SQLite FTS5 search over post titles and content across creators

**Syncing & downloads**

- **One-click sync** — scrape your subscriptions and post content directly from Patreon
- **Sync modes** — Normal (content + assets), Full (Normal + auto-download images)
- **Incremental sync** — stop paging early once already-synced posts are found, for quick "just the new stuff" updates
- **Pause & resume** — interrupt long syncs and pick up where you left off
- **Global download queue** — one place to pause, resume, cancel, and retry every download
- **Resumable downloads** — pausing keeps the partial file and continues from where it stopped
- **Throughput monitor** — live network and disk-write chart, plus per-file speed and ETA
- **Tunable concurrency** — simultaneous downloads (1–10) and retry count
- **Sync history** — a record of every run, with a sidebar hint when one fails

**Appearance & other**

- **Colour themes** — Reading Room, Dhole, Nightwolf, Azure Fox
- **Dark/light/system theme** — respects your OS preference
- **Bilingual UI** — switch between 中文 and English
- **Pinned creators** — drag-to-reorder your most-visited creators
- **Proxy support** — auto-detect the system proxy, set one manually, or turn it off
- **Custom storage location** — move your image library anywhere, with a verified migration
- **Demo mode** — explore the interface with bundled sample content, no login required
- **Fully local** — no cloud, no tracking, no credentials stored

---

## User Guide

### First Launch

On first launch (or whenever you're not logged in), the app opens directly to **Settings → Account**.

1. **Log in to Patreon** — click **Log in to Patreon** in Settings → Account. A window opens where you sign in to Patreon; the app detects a successful login automatically and closes it.

2. **Sync your subscriptions** — click the refresh icon at the top of the sidebar. The app scrapes your subscriptions, and your subscribed creators appear in the sidebar.

3. **Select a creator** — click any creator name to load their post list in the middle pane.

4. **Sync posts** — click **Sync** in the post list toolbar to download posts for that creator. Choose a sync mode first:
   - **Normal** — full post content and asset metadata
   - **Full** — Normal + automatically downloads all images after sync

   Check **New posts only** to stop paging as soon as an already-synced post is found — useful for a quick top-up instead of re-walking the whole feed.

5. **Read a post** — click any post row to open it in the Reading View on the right.

> A small scraper window appears while syncing, parked in the corner of your screen and nearly transparent. It has to stay visible: macOS suspends rendering for a fully hidden window, so Patreon's page would never fire the requests the scraper reads. If a sync stalls — Patreon asking you to log in again, say — the window grows and comes forward so you can deal with it.

---

### Sync Controls

| Control | Description |
|---------|-------------|
| **Max posts** input | Limit how many posts to scrape (default: from Settings) |
| **New posts only** checkbox | Stop paging as soon as an already-synced post is found (incremental sync) |
| **Mode** dropdown | Switch between Normal / Full before syncing |
| **Pause** | Pause mid-sync; a resume button appears with the post count |
| **Resume N/...** | Continue from where the last sync stopped |
| **Resync** | Discard the checkpoint and start fresh |
| **Cancel** | Cancel and clear the saved checkpoint |
| **Download** | Queue this creator's pending attachments in the global download queue |

---

### Layouts: Classic and Workbench

Switch layouts in **Settings → Appearance**.

- **Classic 3-pane** — sidebar (creators), post list, reading view.
- **Workbench** — a slim icon rail, a large reading canvas, and a filmstrip dock along the bottom for paging through posts (scroll it horizontally with the mouse wheel, or use ← →).

The **Zen** button at the top right of the reading view hides the surrounding chrome for distraction-free reading.

![Appearance settings: theme, colour theme, and layout](screenshots/appearance.jpg)

---

### Downloads

Open the downloads page from the sidebar to manage everything in one place.

- **Throughput monitor** — the chart shows network in (filled area) against disk writes (thin line). They normally track each other; bytes arriving with the disk line flat means data isn't landing (a full volume, a permissions problem). Collapsible.
- **Per file** — live speed, bytes done / total, and estimated time left.
- **Pause all / Resume** — pausing genuinely stops in-flight transfers and keeps what's downloaded; resuming continues from that point rather than starting over.
- **Cancel** — discards partial files, so you're never left with half a file on disk.
- **Retry** — failed downloads can be retried individually or in bulk.

> **On failures:** Patreon's image links are signed and expire. A 403 from an expired link is a permanent failure and isn't retried automatically — re-syncing the creator's posts mints fresh links, and a retry works after that.

---

### Favourites

- **Star a post** — click the **☆** icon next to any post row; it turns amber (★).
- **Favourite an image** — hover any image on the media wall and click the star in its corner.
- **Favourites page** — open it from the sidebar for everything you've kept across all creators. Media and Posts tabs, with a creator filter, sorting by favourited/published date, name, or size, and a thumbnail size slider.

---

### Creators Sidebar

| Feature | How |
|---------|-----|
| **Filter tabs** | All / Free / Paid / Unsub'd — filter by subscription type |
| **Search creators** | Type in the search box to filter by name |
| **Pin a creator** | Right-click → Pin; pinned creators appear at the top with a drag handle |
| **Reorder pinned** | Drag the ⠿ grip handle to reorder pinned creators |
| **Unpin** | Right-click a pinned creator → Unpin |
| **All Creators** | Select to show posts from every creator |

---

### Reading View

- **Images** — downloaded images render inline in a justified gallery. Use the small/large slider to change density, and click any image to open the lightbox.
- **Lightbox** — zoom (the wheel zooms toward the cursor), pan, and navigate with arrow keys or on-screen buttons; save to your Downloads folder with the save button. Videos play inline and can go full-screen.
- **Comments** — shown below the post, with nested replies and an **Author** badge on the creator's own. Commenter names link to their Patreon profile. **Refresh** re-fetches that post's comments.
- **Original link** — click to open the original Patreon post in your browser.
- **Star** — the ★ button in the metadata row toggles the star from the Reading View.

![Full-screen image lightbox](screenshots/lightbox.jpg)

---

### Media View

Each creator's page has a **Posts / Media** toggle in the header. Switch to **Media**
for an X-style wall that gathers every downloaded file from that creator across all
posts:

- **Kind filter** — All / Images / Video / Audio.
- **Sort** — toggle Newest / Oldest first.
- **Density** — use the small/large slider to resize thumbnails.
- **Time scrubber** — drag the date pill or use the month wheel to jump through the archive; there are also jump-to-top and jump-to-bottom buttons.
- **Lightbox** — click anything to open it full-screen and page through the creator's entire media set; videos play in place.
- **Bulk management** — enter select mode to pick several files and delete them locally.

![Media wall with kind filter, sorting, and density control](screenshots/media-wall.jpg)

Only downloaded files appear here — sync/download from the Posts view first.

---

### Settings

Open **Settings** from the bottom of the sidebar. It's organized into the following sections:

| Section | What it covers |
|---------|----------------|
| **Account** | Log in to / out of Patreon. Shows your account once connected. The app opens here on launch when you're not logged in. |
| **Sync** | Default max posts, default sync mode, download timeout, simultaneous downloads (1–10), retry count, download delay and jitter, and which asset types to download. |
| **Network / Proxy** | Proxy mode — **Auto** (use the system proxy), **Manual** (enter a proxy URL), or **Off**. |
| **Storage** | Shows disk usage, lets you open the image folder, move it to a custom location, and migrate the existing library there with verification. |
| **Appearance** | Theme (Light / Dark / System), colour theme, and layout (Classic / Workbench). |
| **Language** | UI language: 中文 / English. |
| **Sync History** | A record of past syncs; failures raise a dot in the sidebar. |
| **Self-Check** | Verifies folders, database, proxy, and connectivity. |
| **About** | App version, and (for advanced users) Developer Mode, a debug-output mode, and a Demo Mode toggle. |

> **Defaults:** Developer options are off out of the box — Developer Mode is disabled, Demo Mode is off, and debug output is set to **none** (nothing is printed). Theme defaults to Dark and language to English.

![Settings — Sync preferences](screenshots/settings-sync.jpg)

---

### Developer Mode

Enabling it in **Settings → About** unlocks:

- **Performance HUD** — a draggable overlay showing frame rate, CPU, and memory for this process and its children.
- **Visible scraper windows** — full-size, opaque scraper windows, so you can watch a scrape happen.
- **Debug output** — send logs to a terminal or a file.

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

### Checks and tests

```bash
npm run typecheck                     # frontend type check
npm test                              # Rust unit tests
cd src-tauri && CC=clang cargo check   # backend compile check
```

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
| Desktop shell | Tauri v2 (pinned to 2.10.x) |
| Database | SQLite via `tauri-plugin-sql` |
| Backend commands | Rust (reqwest downloads, sha2 checksums, sysinfo sampling) |
| Scraping | Tauri WebView windows (no undocumented APIs) |

> Tauri is pinned to 2.10.x: 2.11 changed how remote pages call `invoke()`, which stops the scraper scripts from reporting back.

### Project structure

```
src/
  features/
    library/        # Classic 3-pane UI (Sidebar, PostList, ReadingView, MediaView)
    workbench/      # Workbench layout (icon rail, canvas, filmstrip, timeline)
    downloads/      # Download queue page and throughput monitor
    favorites/      # Favourites page (media + posts)
    search/         # Full-text search
    command/        # ⌘K command palette
    settings/       # Settings page and context
    dev/            # Developer performance HUD
  lib/              # DB, media classification, asset URLs, dates, i18n, theme
  types/            # TypeScript types (db.ts, settings.ts)
src-tauri/
  src/
    commands/       # Rust Tauri commands (scraping, downloads, comments, files, settings)
    lib.rs          # App setup, plugin registration, DB migrations
  capabilities/     # Tauri permission declarations
  migrations/       # SQL migration files
```

### How syncing works

1. **Subscription sync** — opens a sandboxed Tauri WebView window that navigates to Patreon. A content script captures creator data from the page DOM and sends it back via Tauri events. No credentials are accessed.
2. **Post sync** — a second scraper window visits each creator's Patreon page and pages through their post feed. Posts are streamed back in batches via `report_scraped_post_page` and written to SQLite.
3. **Comments** — fetched automatically for newly synced posts. Patreon's `/api/*` endpoints are bot-protected and reject ordinary HTTP requests, so comments go through the authenticated WebView too.
4. **Attachment downloads** — post sync only records asset metadata; the actual transfer runs through the global download queue (`start_downloads`), where a worker pool streams files into `$APPDATA/images/<creator_id>/` and updates each row's local path.

> Why scraping uses a WebView rather than plain HTTP: Patreon's endpoints are bot-protected, and a cookie'd request gets a 403. Only a real, logged-in browser gets through.

### Database

SQLite at `$APPDATA/com.hexcatalyst.patreonbox/patreonbox.db`. Schema migrations run automatically on startup from the versioned list declared in `src-tauri/src/lib.rs` — the single source of truth for the schema.

---

## Non-Goals

- No cloud sync
- No undocumented Patreon API calls
- No credential harvesting or cookie export
- No background scraping without user action
- Personal archival only — not for redistribution

---

## Disclaimer

This software is an independent, unofficial tool. It is **not** affiliated with, endorsed by, or connected to Patreon in any way.

It is intended **solely for personal, offline archival of content you have legitimately subscribed to and are authorised to access**. You are entirely responsible for how you use it, including compliance with the [Patreon Terms of Use](https://www.patreon.com/policy/legal) and the laws of your jurisdiction. Do **not** use it to redistribute, resell, or publicly share creators' paid content.

This is a hobby project built quickly with heavy AI assistance ("vibe coding"), and it has **not** been exhaustively tested or reviewed. It may contain bugs or behave unexpectedly, especially on platforms and configurations the author has never tried. Back up anything you care about and use it at your own risk.

The software is provided "as is", without warranty of any kind. The author accepts no liability for misuse, account penalties, data loss, or any other damages arising from its use.

## License

Released under the [MIT License](LICENSE).
