-- SharePoint soft-delete mark: kosz _Usuniete + późniejszy purge.

alter table public.message_attachments
  add column if not exists sp_trash_marked_at timestamptz,
  add column if not exists sp_purge_after timestamptz,
  add column if not exists sp_purged_at timestamptz;

alter table public.galleries
  add column if not exists sp_trash_marked_at timestamptz,
  add column if not exists sp_purge_after timestamptz,
  add column if not exists sp_purged_at timestamptz;

create index if not exists message_attachments_sp_purge_idx
  on public.message_attachments (sp_purge_after)
  where sp_trash_marked_at is not null and sp_purged_at is null;

create index if not exists galleries_sp_purge_idx
  on public.galleries (sp_purge_after)
  where sp_trash_marked_at is not null and sp_purged_at is null;

comment on column public.message_attachments.sp_trash_marked_at is
  'Folder/plik przeniesiony do Zalaczniki/_Usuniete (soft-delete wiadomości)';
comment on column public.message_attachments.sp_purge_after is
  'Termin fizycznego deleteItem na SharePoint';
comment on column public.galleries.sp_trash_marked_at is
  'Folder galerii przeniesiony do Galerie/_Usuniete';
