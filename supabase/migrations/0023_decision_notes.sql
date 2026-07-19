-- Decyzje: pole notatki + edycja przez członków rozmowy.

alter table public.decisions
  add column if not exists note text not null default '';

drop policy if exists "member updates decision" on public.decisions;
create policy "member updates decision" on public.decisions
  for update using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id));

grant select, insert, update, delete on public.decisions to authenticated;
