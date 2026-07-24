-- Pliki Office „do edycji”: SharePoint + publiczny link (anyone with the link).

alter table public.message_attachments
  add column if not exists attach_intent text not null default 'attachment',
  add column if not exists sp_web_url text,
  add column if not exists sp_share_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'message_attachments_attach_intent_check'
  ) then
    alter table public.message_attachments
      add constraint message_attachments_attach_intent_check
      check (attach_intent in ('attachment', 'editable'));
  end if;
end $$;

comment on column public.message_attachments.attach_intent is
  'attachment = kopia w czacie; editable = plik na SP z publicznym linkiem edycji';
comment on column public.message_attachments.sp_share_url is
  'Anonimowy link Graph createLink (edit) — każdy z linkiem ma dostęp';
