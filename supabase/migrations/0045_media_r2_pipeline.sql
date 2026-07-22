-- Media pipeline: R2 (hot) + SharePoint (cold) — kolumny statusów sync/retencji.

-- ---------------------------------------------------------------------------
-- orgs.media_pipeline — serwerowa flaga per zespół (domyślnie legacy_sp)
-- ---------------------------------------------------------------------------
alter table public.orgs
  add column if not exists media_pipeline text not null default 'legacy_sp';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orgs_media_pipeline_check'
  ) then
    alter table public.orgs
      add constraint orgs_media_pipeline_check
      check (media_pipeline in ('legacy_sp', 'r2_sp'));
  end if;
end $$;

comment on column public.orgs.media_pipeline is
  'Server-side gallery media pipeline. legacy_sp (default) | r2_sp. Client Vite flag cannot enable R2 alone.';

-- ---------------------------------------------------------------------------
-- galleries.pipeline
-- ---------------------------------------------------------------------------
alter table public.galleries
  add column if not exists pipeline text not null default 'legacy_sp';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'galleries_pipeline_check'
  ) then
    alter table public.galleries
      add constraint galleries_pipeline_check
      check (pipeline in ('legacy_sp', 'r2_sp'));
  end if;
end $$;

comment on column public.galleries.pipeline is
  'legacy_sp = Edge→Graph; r2_sp = direct R2 + async SharePoint sync.';

-- ---------------------------------------------------------------------------
-- gallery_items: R2 + SharePoint sync
-- ---------------------------------------------------------------------------
alter table public.gallery_items
  add column if not exists r2_key_full text,
  add column if not exists r2_key_thumb text,
  add column if not exists r2_etag text,
  add column if not exists r2_size_bytes bigint,
  add column if not exists r2_status text not null default 'none',
  add column if not exists sp_status text not null default 'none',
  add column if not exists sp_drive_item_id text,
  add column if not exists sp_folder_id text,
  add column if not exists sync_attempts int not null default 0,
  add column if not exists sync_last_error text,
  add column if not exists sync_next_at timestamptz,
  add column if not exists sync_operation_id uuid,
  add column if not exists r2_delete_after timestamptz,
  add column if not exists r2_deleted_at timestamptz,
  add column if not exists retention_hold boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gallery_items_r2_status_check'
  ) then
    alter table public.gallery_items
      add constraint gallery_items_r2_status_check
      check (r2_status in ('none', 'uploading', 'ready', 'deleted'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'gallery_items_sp_status_check'
  ) then
    alter table public.gallery_items
      add constraint gallery_items_sp_status_check
      check (sp_status in (
        'none', 'queued', 'copying', 'uploaded', 'verified',
        'failed', 'permanent_failure', 'retry_scheduled'
      ));
  end if;
end $$;

create index if not exists gallery_items_sp_sync_idx
  on public.gallery_items (sp_status, sync_next_at)
  where sp_status in ('queued', 'failed', 'retry_scheduled', 'copying');

create index if not exists gallery_items_r2_cleanup_idx
  on public.gallery_items (r2_delete_after)
  where r2_deleted_at is null and r2_status = 'ready';

-- ---------------------------------------------------------------------------
-- message_attachments: R2 + SharePoint (Stage 3)
-- ---------------------------------------------------------------------------
alter table public.message_attachments
  add column if not exists pipeline text not null default 'legacy_supabase',
  add column if not exists r2_key text,
  add column if not exists r2_key_thumb text,
  add column if not exists r2_etag text,
  add column if not exists r2_size_bytes bigint,
  add column if not exists r2_status text not null default 'none',
  add column if not exists sp_status text not null default 'none',
  add column if not exists sp_drive_item_id text,
  add column if not exists sp_folder_id text,
  add column if not exists org_id uuid references public.orgs (id) on delete set null,
  add column if not exists sync_attempts int not null default 0,
  add column if not exists sync_last_error text,
  add column if not exists sync_next_at timestamptz,
  add column if not exists sync_operation_id uuid,
  add column if not exists r2_delete_after timestamptz,
  add column if not exists r2_deleted_at timestamptz,
  add column if not exists retention_hold boolean not null default false,
  add column if not exists retention_days int not null default 180;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'message_attachments_pipeline_check'
  ) then
    alter table public.message_attachments
      add constraint message_attachments_pipeline_check
      check (pipeline in ('legacy_supabase', 'r2_sp'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'message_attachments_r2_status_check'
  ) then
    alter table public.message_attachments
      add constraint message_attachments_r2_status_check
      check (r2_status in ('none', 'uploading', 'ready', 'deleted'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'message_attachments_sp_status_check'
  ) then
    alter table public.message_attachments
      add constraint message_attachments_sp_status_check
      check (sp_status in (
        'none', 'queued', 'copying', 'uploaded', 'verified',
        'failed', 'permanent_failure', 'retry_scheduled'
      ));
  end if;
end $$;

create index if not exists message_attachments_sp_sync_idx
  on public.message_attachments (sp_status, sync_next_at)
  where sp_status in ('queued', 'failed', 'retry_scheduled', 'copying');

create index if not exists message_attachments_r2_cleanup_idx
  on public.message_attachments (r2_delete_after)
  where r2_deleted_at is null and r2_status = 'ready';

-- ---------------------------------------------------------------------------
-- media_sync_jobs — dead-letter / admin retry
-- ---------------------------------------------------------------------------
create table if not exists public.media_sync_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in (
    'gallery_full', 'gallery_thumb', 'attachment', 'cleanup_r2'
  )),
  ref_id       uuid not null,
  state        text not null default 'pending' check (state in (
    'pending', 'running', 'done', 'failed', 'dead'
  )),
  attempts     int not null default 0,
  last_error   text,
  payload      jsonb not null default '{}'::jsonb,
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists media_sync_jobs_state_idx
  on public.media_sync_jobs (state, created_at);

drop trigger if exists media_sync_jobs_touch on public.media_sync_jobs;
create trigger media_sync_jobs_touch before update on public.media_sync_jobs
  for each row execute function public.touch_updated_at();

alter table public.media_sync_jobs enable row level security;

-- Tylko service role / Edge — brak polityk dla authenticated (admin przez Edge).
drop policy if exists "no direct client access sync jobs" on public.media_sync_jobs;

-- Org admin: retry sync dla gallery_item (RPC)
create or replace function public.retry_gallery_item_sync(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.gallery_items%rowtype;
  v_gallery public.galleries%rowtype;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Brak sesji.';
  end if;

  select * into v_item from public.gallery_items where id = p_item_id;
  if not found then
    raise exception 'Pozycja galerii nie istnieje.';
  end if;

  select * into v_gallery from public.galleries where id = v_item.gallery_id;
  if not found then
    raise exception 'Galeria nie istnieje.';
  end if;

  if not exists (
    select 1 from public.org_members m
    where m.org_id = v_gallery.org_id
      and m.user_id = v_caller
      and m.role = 'admin'
  ) then
    raise exception 'Tylko administrator zespołu może ponowić synchronizację.';
  end if;

  if v_item.r2_status <> 'ready' then
    raise exception 'Brak kompletnego pliku w R2 — nie można archiwizować.';
  end if;

  update public.gallery_items
  set sp_status = 'queued',
      sync_operation_id = coalesce(sync_operation_id, gen_random_uuid()),
      sync_next_at = now(),
      sync_last_error = null,
      retention_hold = false
  where id = p_item_id;

  insert into public.media_sync_jobs (kind, ref_id, state, payload)
  values (
    'gallery_full',
    p_item_id,
    'pending',
    jsonb_build_object('galleryId', v_gallery.id, 'orgId', v_gallery.org_id)
  );

  return jsonb_build_object('ok', true, 'itemId', p_item_id);
end;
$$;

revoke all on function public.retry_gallery_item_sync(uuid) from public;
grant execute on function public.retry_gallery_item_sync(uuid) to authenticated;
