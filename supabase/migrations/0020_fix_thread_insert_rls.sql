-- Fix: odpowiedzi w wątku były zawsze odrzucane przez RLS.
-- W polityce INSERT niezqualifikowane `thread_root_id` w podzapytaniu
-- `FROM messages r` wiązało się do `r.thread_root_id` (zawsze NULL u rootów),
-- więc warunek `r.id = thread_root_id` nigdy nie przechodził.
-- Poprawka: kwalifikacja kolumny wiersza wstawianego → `messages.thread_root_id`.

drop policy if exists "member sends own messages" on public.messages;
create policy "member sends own messages" on public.messages
  for insert with check (
    author_user_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.archived_at is null
    )
    and (
      messages.thread_root_id is null
      or exists (
        select 1 from public.messages r
        where r.id = messages.thread_root_id
          and r.conversation_id = messages.conversation_id
          and r.thread_root_id is null
      )
    )
  );
