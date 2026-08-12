# Label

A minimal label-printing app, built as a static site for GitHub Pages.

## What's here

- Password screen (`***`) that opens into the app
- A **People** menu: centered title, a short rule below it that stops before the edges, and a soft light-gray panel holding white profile rows
- A `+` in the top-right to add a person, and a `×` on each row to remove one —
  deleting requires typing the person's name exactly before the button unlocks
- Light theme by default; dark mode is wired up via `data-theme="dark"` on `<html>` and ready for a settings screen
- Built for phones: safe-area insets for notches, 38px tap targets, no
  focus-zoom on iOS, and a fallback for browsers without `<dialog>`

## Running locally

Serve the folder (ES modules need HTTP, not `file://`):

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Deploying

Push to `main`. In **Settings → Pages**, set the source to **GitHub Actions**; the workflow in `.github/workflows/pages.yml` publishes the repo root.

## Supabase

Project `qyhitluutjiscfcslnuy` is already configured in `js/config.js`. If
Supabase or the CDN can't be reached, the app falls back to `localStorage` so it
still works offline.

Run this once in the Supabase SQL editor to create the table:

```sql
create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_at timestamptz not null default now()
);
```

Then enable row-level security and add policies. The quickest setup that lets
the app read and write with the anon key:

```sql
alter table people enable row level security;

create policy "anon can read" on people for select to anon using (true);
create policy "anon can insert" on people for insert to anon with check (true);
```

Be aware of what that means: the anon key and the password both ship to the
browser, so anyone who opens the page source can read and add rows through the
API directly. The password is a gate, not real security. If the people list
should be private, swap these policies for Supabase Auth and scope rows to the
signed-in user.
