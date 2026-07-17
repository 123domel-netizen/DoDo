-- KOMUNIKATOR (CHAT3): załączniki wiadomości — Supabase Storage + metadane.
-- Ścieżka obiektu: {conversation_id}/{message_id}/{uuid}-{nazwa}
-- Bucket prywatny; odczyt przez signed URLs; dostęp = członkostwo rozmowy.

-- ---------------------------------------------------------------------------
-- message_attachments (metadane)
-- ---------------------------------------------------------------------------
create table if not exists public.message_attachments (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages (id) on delete cascade,
  bucket_path text not null,
  thumb_path  text,
  file_name   text not null,
  mime_type   text not null default 'application/octet-stream',
  size_bytes  integer not null default 0,
  width       integer,
  height      integer,
  created_at  timestamptz not null default now()
);

create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;

drop policy if exists "attachment visible to members" on public.message_attachments;
create policy "attachment visible to members" on public.message_attachments
  for select using (
    public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
  );

drop policy if exists "author adds attachments" on public.message_attachments;
create policy "author adds attachments" on public.message_attachments
  for insert with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.author_user_id = auth.uid()
    )
  );

drop policy if exists "author deletes attachments" on public.message_attachments;
create policy "author deletes attachments" on public.message_attachments
  for delete using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.author_user_id = auth.uid()
    )
  );

grant select, insert, delete on public.message_attachments to authenticated;
grant all on public.message_attachments to service_role;

-- ---------------------------------------------------------------------------
-- Bucket (prywatny)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Polityki storage.objects — pierwszy segment ścieżki = conversation_id
-- ---------------------------------------------------------------------------
drop policy if exists "chat attachments read" on storage.objects;
create policy "chat attachments read" on storage.objects
  for select using (
    bucket_id = 'chat-attachments'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat attachments insert" on storage.objects;
create policy "chat attachments insert" on storage.objects
  for insert with check (
    bucket_id = 'chat-attachments'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat attachments delete own" on storage.objects;
create policy "chat attachments delete own" on storage.objects
  for delete using (
    bucket_id = 'chat-attachments'
    and owner = auth.uid()
  );
