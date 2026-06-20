-- Kalendarz + ToDo - schemat bazy (Supabase / Postgres)
-- Uruchom w Supabase: SQL Editor -> wklej i Run, albo `supabase db push`.
--
-- Uwaga projektowa: kolekcje podrzędne (checklist, uczestnicy, załączniki,
-- przypomnienia) trzymamy w kolumnie JSONB `payload` w tabeli `items`. Upraszcza
-- to synchronizację (jeden wiersz = jeden element) i jest w pełni zgodne z
-- klientem (src/lib/cloud.ts). Tabele `groups` i `push_subscriptions` są osobne.

create extension if not exists "pgcrypto";

-- GRUPY ----------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  color       text not null default '#0b6e99',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ELEMENTY (wydarzenia + zadania to ten sam byt) -----------------------------
create table if not exists public.items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  type             text not null check (type in ('event', 'task')),
  title            text not null default '',
  description      text not null default '',
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  all_day          boolean not null default false,
  group_id         uuid references public.groups (id) on delete set null,
  show_in_calendar boolean not null default true,
  show_in_todo     boolean not null default false,
  done             boolean not null default false,
  -- { checklist:[], participants:[], attachments:[], reminders:[] }
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists items_user_idx     on public.items (user_id);
create index if not exists items_start_idx     on public.items (user_id, start_at);
create index if not exists items_group_idx     on public.items (group_id);

-- SUBSKRYPCJE PUSH (po jednym wierszu na urządzenie) -------------------------
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  keys          jsonb not null,
  device_label  text,
  created_at    timestamptz not null default now()
);

-- LOG WYSŁANYCH PRZYPOMNIEŃ (dedupe między urządzeniami / cron) --------------
create table if not exists public.reminder_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  item_id      uuid not null references public.items (id) on delete cascade,
  reminder_id  text not null,
  fire_at      timestamptz not null,
  sent_at      timestamptz not null default now(),
  unique (item_id, reminder_id, fire_at)
);

-- ROW LEVEL SECURITY ---------------------------------------------------------
alter table public.groups             enable row level security;
alter table public.items              enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_log       enable row level security;

create policy "own groups"  on public.groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own items"   on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own pushsub" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rlog"    on public.reminder_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- auto-aktualizacja updated_at -----------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- Realtime (sync między urządzeniami) ----------------------------------------
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.groups;
