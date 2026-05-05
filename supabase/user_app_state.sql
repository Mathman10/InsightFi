create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_state enable row level security;

drop policy if exists "Users can read own app state" on public.user_app_state;
create policy "Users can read own app state"
on public.user_app_state
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can write own app state" on public.user_app_state;
create policy "Users can write own app state"
on public.user_app_state
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

