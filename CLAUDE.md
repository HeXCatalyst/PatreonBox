# CLAUDE.md

Guidance for Claude Code (and contributors) working in this repository.

## Dev commands

- Run the app: `CC=clang npm run tauri dev`
- Frontend typecheck: `npx tsc --noEmit`
- Backend check: `cd src-tauri && CC=clang cargo check`
- `docs/` is gitignored — internal notes, plans, and specs live there and never ship.

## MANDATORY pre-commit checklist

Run through this **every time, before `git add` / `git commit`** — no exceptions,
even for "trivial" changes:

1. **No real subscription data.** This app is developed against the developer's
   own Patreon account. Nothing captured from it may enter the repo: creator
   names/handles, post titles or content, commission recipients, media
   filenames/URLs, avatar images, or timestamps copied from real posts. This
   applies to code, comments, test fixtures, demo data, design mockups, and
   screenshots. Only the fictional demo dataset (`src/lib/demoData.ts` +
   `DisplayMode/`) may appear.
2. **Run the sensitive-terms scan.** A gitignored term list lives at
   `docs/privacy/sensitive-terms.txt`. Before committing, this must print
   nothing:
   ```sh
   git diff --cached | grep '^+' | grep -iF -f docs/privacy/sensitive-terms.txt
   ```
   (Scans added lines only, so removing a stale term doesn't false-positive.)
   If the file is missing (fresh clone), ask the repo owner before committing
   anything that includes names, sample data, or UI copy.
3. **No personal paths or identity.** No real OS usernames in paths, no
   personal email addresses (git identity uses the GitHub noreply address).
4. **Generic examples only.** When a code comment or doc needs an example
   handle/slug/URL, invent one (`someartist`, `example-creator`) — never copy
   one from live data.
5. **Commit messages are public.** Keep them about the code. Don't reference
   real accounts, subscriptions, or the specifics of privacy scrubs.

## Conventions

- i18n: every user-facing string gets `zh` + `en` entries in `src/lib/i18n.ts`
  (type + both locales).
- Theme system: colors flow through the shadcn tokens in `src/index.css`;
  named color themes override tokens under `[data-color-theme=…]`. Don't
  hardcode colors in components — add a token if one is missing.
- DB schema changes go through the versioned migrations in `src-tauri/src/lib.rs`.
