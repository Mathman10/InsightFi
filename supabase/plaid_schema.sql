create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  access_token text not null,
  cursor text,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, item_id)
);

create table if not exists public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null,
  item_id text not null,
  account_id text not null,
  account_name text,
  amount numeric not null,
  date date not null,
  name text not null,
  merchant_name text,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, transaction_id)
);

alter table public.plaid_items enable row level security;
alter table public.plaid_transactions enable row level security;

drop policy if exists "Users can view own plaid items" on public.plaid_items;
create policy "Users can view own plaid items"
on public.plaid_items
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view own plaid transactions" on public.plaid_transactions;
create policy "Users can view own plaid transactions"
on public.plaid_transactions
for select
to authenticated
using (auth.uid() = user_id);

