-- Label — full schema. Safe to run more than once.

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists foods (
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

-- If foods was created before shared food existed, person_id is still NOT NULL.
alter table foods alter column person_id drop not null;

alter table people enable row level security;
alter table foods enable row level security;

-- Dropped first so re-running never trips "policy already exists".
drop policy if exists "anon can read" on people;
drop policy if exists "anon can insert" on people;
drop policy if exists "anon can delete" on people;

create policy "anon can read" on people for select to anon using (true);
create policy "anon can insert" on people for insert to anon with check (true);
create policy "anon can delete" on people for delete to anon using (true);

drop policy if exists "anon can read food" on foods;
drop policy if exists "anon can add food" on foods;
drop policy if exists "anon can delete food" on foods;

create policy "anon can read food" on foods for select to anon using (true);
create policy "anon can add food" on foods for insert to anon with check (true);
create policy "anon can delete food" on foods for delete to anon using (true);
