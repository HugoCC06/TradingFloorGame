-- Trading Floor cloud saves (optional). Run in the Supabase SQL editor.
create table if not exists public.cloud_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,
  meta jsonb not null,
  data text not null,               -- base64(gzip(JSON GameState))
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table public.cloud_saves enable row level security;

-- Users can only see and modify their own saves.
create policy "own saves: select" on public.cloud_saves for select using (auth.uid() = user_id);
create policy "own saves: insert" on public.cloud_saves for insert with check (auth.uid() = user_id);
create policy "own saves: update" on public.cloud_saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own saves: delete" on public.cloud_saves for delete using (auth.uid() = user_id);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile: all" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
