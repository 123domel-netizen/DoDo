-- Galerie w czacie + magazyn plików zespołu (SharePoint V1).

-- ---------------------------------------------------------------------------
-- messages.kind: gallery
-- ---------------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text', 'system', 'poll', 'gif', 'voice', 'gallery'));

-- ---------------------------------------------------------------------------
-- org_storage_connections — jeden aktywny magazyn na zespół
-- ---------------------------------------------------------------------------
create table if not exists public.org_storage_connections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  provider        text not null check (provider in ('sharepoint', 'onedrive', 'google_drive')),
  status          text not null default 'active'
                    check (status in ('active', 'disconnected')),
  -- SharePoint / Graph
  site_id         text,
  drive_id        text,
  base_folder_id  text,
  base_folder_name text,
  meta            jsonb not null default '{}'::jsonb,
  connected_by    uuid references auth.users (id) on delete set null,
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, provider)
);

create unique index if not exists org_storage_one_active_idx
  on public.org_storage_connections (org_id)
  where status = 'active';

create index if not exists org_storage_org_idx
  on public.org_storage_connections (org_id);

drop trigger if exists org_storage_touch on public.org_storage_connections;
create trigger org_storage_touch before update on public.org_storage_connections
  for each row execute function public.touch_updated_at();

alter table public.org_storage_connections enable row level security;

drop policy if exists "org members read storage" on public.org_storage_connections;
create policy "org members read storage" on public.org_storage_connections
  for select to authenticated
  using (public.is_org_member(org_id));

-- INSERT/UPDATE/DELETE tylko przez Edge (service role) lub admin RPC.

-- ---------------------------------------------------------------------------
-- galleries
-- ---------------------------------------------------------------------------
create table if not exists public.galleries (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs (id) on delete cascade,
  conversation_id     uuid not null references public.conversations (id) on delete cascade,
  message_id          uuid references public.messages (id) on delete set null,
  created_by          uuid not null references auth.users (id) on delete cascade,
  title               text not null,
  description         text,
  provider            text not null check (provider in ('sharepoint', 'onedrive', 'google_drive')),
  provider_folder_id  text,
  provider_folder_path text,
  status              text not null default 'draft'
                        check (status in (
                          'draft', 'uploading', 'ready', 'partial', 'failed', 'unavailable'
                        )),
  item_count          int not null default 0,
  failed_count        int not null default 0,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists galleries_conversation_idx
  on public.galleries (conversation_id, created_at desc)
  where deleted_at is null;

create index if not exists galleries_message_idx
  on public.galleries (message_id)
  where message_id is not null;

create unique index if not exists galleries_message_unique_idx
  on public.galleries (message_id)
  where message_id is not null;

drop trigger if exists galleries_touch on public.galleries;
create trigger galleries_touch before update on public.galleries
  for each row execute function public.touch_updated_at();

alter table public.galleries enable row level security;

drop policy if exists "members read galleries" on public.galleries;
create policy "members read galleries" on public.galleries
  for select to authenticated
  using (
    deleted_at is null
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "members insert galleries" on public.galleries;
create policy "members insert galleries" on public.galleries
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "members update galleries" on public.galleries;
create policy "members update galleries" on public.galleries
  for update to authenticated
  using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id));

-- ---------------------------------------------------------------------------
-- gallery_items
-- ---------------------------------------------------------------------------
create table if not exists public.gallery_items (
  id                uuid primary key default gen_random_uuid(),
  gallery_id        uuid not null references public.galleries (id) on delete cascade,
  sort_order        int not null default 0,
  file_name         text not null,
  mime_type         text not null default 'image/jpeg',
  size_bytes        bigint not null default 0,
  width             int,
  height            int,
  provider_item_id  text,
  status            text not null default 'pending'
                      check (status in ('pending', 'uploading', 'ready', 'failed')),
  error_code        text,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists gallery_items_gallery_idx
  on public.gallery_items (gallery_id, sort_order);

drop trigger if exists gallery_items_touch on public.gallery_items;
create trigger gallery_items_touch before update on public.gallery_items
  for each row execute function public.touch_updated_at();

alter table public.gallery_items enable row level security;

drop policy if exists "members read gallery items" on public.gallery_items;
create policy "members read gallery items" on public.gallery_items
  for select to authenticated
  using (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id
        and g.deleted_at is null
        and public.is_conversation_member(g.conversation_id)
    )
  );

drop policy if exists "members insert gallery items" on public.gallery_items;
create policy "members insert gallery items" on public.gallery_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id
        and g.deleted_at is null
        and public.is_conversation_member(g.conversation_id)
    )
  );

drop policy if exists "members update gallery items" on public.gallery_items;
create policy "members update gallery items" on public.gallery_items
  for update to authenticated
  using (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id
        and public.is_conversation_member(g.conversation_id)
    )
  )
  with check (
    exists (
      select 1 from public.galleries g
      where g.id = gallery_id
        and public.is_conversation_member(g.conversation_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.galleries;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.gallery_items;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: org ma aktywny magazyn?
-- ---------------------------------------------------------------------------
create or replace function public.org_has_active_storage(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_storage_connections c
    where c.org_id = p_org_id
      and c.status = 'active'
      and c.base_folder_id is not null
  );
$$;

grant execute on function public.org_has_active_storage(uuid) to authenticated;
