-- Zakres linku edycji SharePoint: anonymous (publiczny) lub organization.

alter table public.message_attachments
  add column if not exists sp_share_scope text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'message_attachments_sp_share_scope_check'
  ) then
    alter table public.message_attachments
      add constraint message_attachments_sp_share_scope_check
      check (
        sp_share_scope is null
        or sp_share_scope in ('anonymous', 'organization')
      );
  end if;
end $$;

comment on column public.message_attachments.sp_share_scope is
  'Zakres Graph createLink: anonymous = każdy z linkiem; organization = osoby w tenancie';
