# Label

A minimal label-printing app, built as a static site for GitHub Pages.

## What's here

- Password screen (`***`) that opens into the app
- A **People** menu: centered title, a short rule below it that stops before the edges, and a soft light-gray panel holding white profile rows
- A `+` in the top-right to add a person, and a `×` on each row to remove one —
  deleting requires typing the person's name exactly before the button unlocks
- Tap a person to open their **Food** list — same header, line and `+`
- Adding food takes a name, a picture, an expiration date, an optional
  description, and tick boxes for all 14 declarable allergens
- Pictures come from an upload, a pasted link, or the built-in search — type a
  name and tap a result. Search covers Open Food Facts (branded products) and
  Wikimedia Commons; both are free and need no API key
- Ticking **Add to everyone** makes one shared food that appears in every
  profile, tagged `Everyone`; deleting it removes it everywhere
- A light/dark toggle sits in the top right of both screens; the choice is saved
  per device, never synced
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
create table foods (
  id uuid primary key default gen_random_uuid(),
  -- nullable: a null person_id is a shared food, shown in every profile
  person_id uuid references people (id) on delete cascade,
  name text not null,
  image_url text,
  expires_on date,
  description text,
  allergens jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table people enable row level security;
alter table foods enable row level security;

create policy "anon can read" on people for select to anon using (true);
create policy "anon can insert" on people for insert to anon with check (true);
create policy "anon can delete" on people for delete to anon using (true);

create policy "anon can read food" on foods for select to anon using (true);
create policy "anon can add food" on foods for insert to anon with check (true);
create policy "anon can delete food" on foods for delete to anon using (true);
```

Uploaded pictures are shrunk to 640px JPEGs and stored inline in `image_url`
as data URLs, so no storage bucket is needed.

Be aware of what that means: the anon key and the password both ship to the
browser, so anyone who opens the page source can read and add rows through the
API directly. The password is a gate, not real security. If the people list
should be private, swap these policies for Supabase Auth and scope rows to the
signed-in user.
