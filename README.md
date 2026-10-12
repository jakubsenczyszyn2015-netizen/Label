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
- **Label printing for Brother QL and P-touch printers**, built to match
  Brother's reference driver byte for byte — see *Printing* below
- A bell at the top left holds app notices; when the page is running an older
  build than the deployed one it shows **Out dated!** with an Update button
  that clears the caches and service worker before reloading. Seen notices
  stay seen across restarts
- On iPhone/iPad the app asks to be added to the Home Screen first, with
  step-by-step instructions. Desktop is never gated
- Tap a food to see its label exactly as it will print, then **Print label**,
  **Send to Brother app**, **Save to Photos**, **Save PDF**, **Save PNG** or **Edit**
- Unlocking is remembered on the device until you press the lock button
- If Supabase is paused or unreachable, a maintenance notice explains it
  instead of showing a raw database error
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

## Printing

### What gets printed

`js/thermal.js` draws each label in pure black at the printer's own dot grid
(300 dpi for QL, 180 dpi for P-touch), sized to the exact printable area of
the chosen roll. Thermal printers can't print grey, so there is none: bold
name, an unambiguous date (`01 SEP 2026`), and allergens in a box with an
inverted header. Narrow rolls and tape turn the layout to run along the label.
The preview, the PNG, the PDF and the printer all get the same dots.

### Getting it to the printer

| From | How |
| --- | --- |
| Computer or Android, Chrome/Edge | **USB** (WebUSB) or **Bluetooth** (Web Serial, for classic-Bluetooth Brother printers) |
| iPhone/iPad | **Send to Brother app** — a PDF the size of the label, which iPrint&Label prints 1:1. Or the bridge |
| Anything on the Wi-Fi | **Bridge** — `tools/print-bridge.mjs` on a computer that can reach the printer |

The app reads the printer's status where it can: it detects which roll is
loaded and selects it, refuses to print onto the wrong roll (the usual cause
of a blinking red light), and reports when the printer has finished.

The system print dialog (under *Printer not connecting?*) uses a page sized
to the label, so Print → Share → iPrint&Label also prints 1:1.

### The bridge

A browser can't open the raw socket a network printer listens on, nor reach a
printer plugged into another computer. The bridge does both, and serves the
app so a phone can open it from there:

```
node tools/print-bridge.mjs --list                       # what this computer can reach
node tools/print-bridge.mjs --printer cups:Brother_QL_800   # macOS/Linux, USB QL-800
node tools/print-bridge.mjs --printer '\\localhost\QL800'   # Windows, shared printer
node tools/print-bridge.mjs --printer 192.168.1.50          # network printer
```

Open the address it prints on the phone, then **Bridge** in the print sheet.
From the hosted (https) app, only a bridge on the same computer
(`http://localhost:8080`) is reachable. Printers are fixed when the bridge
starts — a phone can only choose among them — and it serves only the app's
own files.

### Tests

`tools/test-raster.mjs` checks the QL output against
[brother_ql](https://github.com/pklaus/brother_ql), the reference driver:

```
python3 -m venv .bq && .bq/bin/pip install brother_ql==0.9.4 "Pillow<10"
node tools/test-raster.mjs .bq/bin/python
```

Twelve model/label combinations, including the QL-800 on 62mm, 52×29mm and
29mm, come out byte-identical. P-touch output follows Brother's PT raster
reference but has no reference driver to test against.

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
