-- KOMUNIKATOR (CHAT6): przypinanie wątków do rozmowy + rejestr notatek.

-- ---------------------------------------------------------------------------
-- messages: przypięcie wątku (wspólne dla rozmowy, nie per użytkownik)
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid;

create index if not exists messages_pinned_idx
  on public.messages (conversation_id, pinned_at desc)
  where pinned_at is not null;

-- Przypiąć/odpiąć może każdy członek rozmowy (RLS update na messages jest
-- ograniczone do autora, stąd RPC security definer).
create or replace function public.set_message_pinned(
  p_message_id uuid,
  p_pinned boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  select m.conversation_id into conv
  from public.messages m
  where m.id = p_message_id and m.deleted_at is null;
  if conv is null then
    raise exception 'message not found';
  end if;
  if not public.is_conversation_member(conv) then
    raise exception 'not a member';
  end if;
  update public.messages
  set pinned_at = case when p_pinned then now() end,
      pinned_by = case when p_pinned then caller end
  where id = p_message_id;
end;
$$;

grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- notes — rejestr notatek per rozmowa (lustrzany do decisions; konwersja:
-- wiadomość → notatka, notatka ↔ decyzja ↔ zadanie/wydarzenie/checklista)
-- ---------------------------------------------------------------------------
create table if not exists public.notes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id      uuid references public.messages (id) on delete set null,
  body            text not null,
  created_by      uuid not null references auth.users (id) on delete cascade,
  noted_at        timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists notes_conversation_idx
  on public.notes (conversation_id, noted_at desc);

alter table public.notes enable row level security;

drop policy if exists "notes visible to members" on public.notes;
create policy "notes visible to members" on public.notes
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists "member records note" on public.notes;
create policy "member records note" on public.notes
  for insert with check (
    created_by = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "author removes note" on public.notes;
create policy "author removes note" on public.notes
  for delete using (created_by = auth.uid());

grant select, insert, delete on public.notes to authenticated;
grant all on public.notes to service_role;
