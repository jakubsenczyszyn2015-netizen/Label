# Label

A minimal label-printing app, built as a static site for GitHub Pages.

## What's here

- Password screen (`***`) that opens into the app
- A **People** menu: centered title, a short rule below it that stops before the edges, and a soft light-gray panel holding white profile rows
- A `+` in the top-right to add a person, and a `×` on each row to remove one —
  deleting requires typing the person's name exactly before the button unlocks
- Tap a person to open the **Food** list — same header, line and `+`
- Adding food takes a name, a picture, an expiration date, an optional
  description, and tick boxes for all 14 declarable allergens
- Pictures come from an upload, a pasted link, or the built-in search — type a
  name and tap a result. Search covers Open Food Facts (branded products) and
  Wikimedia Commons; both are free and need no API key
- Food is shared across all profiles: every person shows the same list, and
  deleting a food removes it everywhere
- A light/dark toggle sits in the top right of both screens; the choice is saved
  per device, never synced
- Tap a food to preview its label, then **Edit** it, **Save image** (PNG) or
  **Print / PDF** (the browser's print dialog can save as PDF)
- Feels like an app rather than a page: the page itself never scrolls or
  bounces, double-tap zoom is off, and only the list scrolls
- Installable: add it to your home screen and it opens standalone, with a
  service worker caching the shell so it still opens offline
- Built for phones: safe-area insets for notches, 38px tap targets, no
  focus-zoom on iOS, and a fallback for browsers without `<dialog>`

## Running locally

Serve the folder (ES modules need HTTP, not `file://`):

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Deploying

Run `python3 tools/stamp.py` before committing. It re-versions the CSS/JS links
in `index.html` so phones pick up the new build instead of a cached one.

Push to `main`. In **Settings → Pages**, set the source to **GitHub Actions**; the workflow in `.github/workflows/pages.yml` publishes the repo root.

## Supabase

Project `qyhitluutjiscfcslnuy` is already configured in `js/config.js`. If
Supabase or the CDN can't be reached, the app falls back to `localStorage` so it
still works offline.

Run [`supabase.sql`](supabase.sql) in the Supabase SQL editor. It creates both
tables and their policies, and is safe to re-run — existing objects are skipped
rather than erroring. It defines `people`, `foods`, and policies letting the
anon key read, insert and delete both.

Uploaded pictures are shrunk to 640px JPEGs and stored inline in `image_url`
as data URLs, so no storage bucket is needed.

Be aware of what those policies mean: the anon key and the password both ship to the
browser, so anyone who opens the page source can read and add rows through the
API directly. The password is a gate, not real security. If the people list
should be private, swap these policies for Supabase Auth and scope rows to the
signed-in user.
