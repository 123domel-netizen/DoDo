-- Integracja Google Calendar + Google Tasks
-- Uruchom po 0001_init.sql

-- Połączone konta Google (refresh token szyfrowany po stronie Edge Function)
create table if not exists public.google_accounts (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  google_email             text not null default '',
  refresh_token_encrypted  text not null,
  access_token             text,
  access_token_expires_at  timestamptz,
  scopes                   text[] not null default '{}',
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Ustawienia synchronizacji per użytkownik
create table if not exists public.google_sync_settings (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  calendar_enabled         boolean not null default true,
  tasks_enabled            boolean not null default true,
  calendar_id              text not null default 'primary',
  task_list_id             text not null default '@default',
  dual_visibility_mode     text not null default 'both_linked'
    check (dual_visibility_mode in ('calendar_only', 'tasks_only', 'both_linked', 'ask_per_item')),
  sync_completed_tasks     boolean not null default false,
  import_existing_on_connect boolean not null default true,
  settings                 jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

-- Stan incremental sync + Calendar watch
create table if not exists public.google_sync_state (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  calendar_sync_token      text,
  tasks_updated_min        timestamptz,
  last_sync_at             timestamptz,
  last_sync_error          text,
  watch_channel_id         text,
  watch_resource_id        text,
  watch_expiration         timestamptz,
  updated_at               timestamptz not null default now()
);

-- Mapowanie itemów appki ↔ Google
create table if not exists public.item_external_links (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  item_id                  uuid not null references public.items (id) on delete cascade,
  provider                 text not null check (provider in ('google_calendar', 'google_tasks')),
  external_id              text not null,
  external_calendar_id     text,
  external_task_list_id    text,
  etag                     text,
  link_group_id            uuid,
  checklist_subtask_ids    jsonb not null default '{}'::jsonb,
  last_pushed_at           timestamptz,
  last_pulled_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, item_id, provider)
);

create unique index if not exists item_external_links_external_unique
  on public.item_external_links (
    user_id,
    provider,
    external_id,
    coalesce(external_calendar_id, ''),
    coalesce(external_task_list_id, '')
  );

create index if not exists item_external_links_item_idx
  on public.item_external_links (user_id, item_id);

create index if not exists item_external_links_external_idx
  on public.item_external_links (user_id, provider, external_id);

-- Kolejka sync (debounce z klienta / webhook)
create table if not exists public.google_sync_queue (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  action       text not null default 'push' check (action in ('push', 'pull', 'full')),
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists google_sync_queue_pending_idx
  on public.google_sync_queue (user_id, created_at)
  where processed_at is null;

-- Tymczasowy state OAuth
create table if not exists public.google_oauth_states (
  state_token  text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists google_oauth_states_exp_idx
  on public.google_oauth_states (expires_at);

-- RLS ------------------------------------------------------------------------
alter table public.google_accounts        enable row level security;
alter table public.google_sync_settings   enable row level security;
alter table public.google_sync_state      enable row level security;
alter table public.item_external_links    enable row level security;
alter table public.google_sync_queue      enable row level security;
alter table public.google_oauth_states    enable row level security;

create policy "own google_accounts" on public.google_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own google_sync_settings" on public.google_sync_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own google_sync_state" on public.google_sync_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own item_external_links" on public.item_external_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own google_sync_queue" on public.google_sync_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- oauth states: tylko service role zapisuje; użytkownik nie czyta
create policy "no direct oauth states" on public.google_oauth_states
  for all using (false);

-- Service role pełny dostęp (Edge Functions)
grant all on public.google_accounts to service_role;
grant all on public.google_sync_settings to service_role;
grant all on public.google_sync_state to service_role;
grant all on public.item_external_links to service_role;
grant all on public.google_sync_queue to service_role;
grant all on public.google_oauth_states to service_role;

-- Domyślne ustawienia przy pierwszym połączeniu (Edge Function tworzy wiersze)
