# Label

A minimal label-printing app, built as a static site for GitHub Pages.

## What's here

- Password screen (`***`) that opens into the app
- A **People** menu: centered title, a short rule below it that stops before the edges, and a soft light-gray panel holding white profile rows
- A `+` in the top-right to add a person
- Light theme by default; dark mode is wired up via `data-theme="dark"` on `<html>` and ready for a settings screen

## Running locally

Serve the folder (ES modules need HTTP, not `file://`):

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Deploying

Push to `main`. In **Settings → Pages**, set the source to **GitHub Actions**; the workflow in `.github/workflows/pages.yml` publishes the repo root.

## Supabase

People are stored in `localStorage` until you fill in `js/config.js`:

```js
window.LABEL_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "...",
  PASSWORD: "Labelapp32",
};
```

Then create the table:

```sql
create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_at timestamptz not null default now()
);
```

Enable row-level security and add policies that match how you want the data
reached. Note that the anon key and the password both ship to the browser — the
password is a gate, not real security, so RLS is what actually protects the data.
