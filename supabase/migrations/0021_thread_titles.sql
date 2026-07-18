-- Nazwa wątku (opcjonalna) na wiadomości-rootcie.
-- Ustawiana przy pierwszym „Odpowiedz w wątku"; domyślnie treść rootu.

alter table public.messages
  add column if not exists thread_title text;

comment on column public.messages.thread_title is
  'Nazwa wątku (tylko dla rootów, thread_root_id is null).';

create or replace function public.set_thread_title(
  p_message_id uuid,
  p_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv uuid;
  is_root boolean;
  cleaned text := nullif(trim(both from coalesce(p_title, '')), '');
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if cleaned is null or char_length(cleaned) > 200 then
    raise exception 'invalid title';
  end if;

  select m.conversation_id, (m.thread_root_id is null)
    into conv, is_root
  from public.messages m
  where m.id = p_message_id and m.deleted_at is null;

  if conv is null then
    raise exception 'message not found';
  end if;
  if not is_root then
    raise exception 'not a thread root';
  end if;
  if not public.is_conversation_member(conv) then
    raise exception 'not a member';
  end if;

  update public.messages
  set thread_title = cleaned
  where id = p_message_id;
end;
$$;

grant execute on function public.set_thread_title(uuid, text) to authenticated;
