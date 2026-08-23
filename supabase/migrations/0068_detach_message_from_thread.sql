-- Wyłącz wiadomość z wątku (reply → samodzielna w feedzie głównym).
-- SECURITY DEFINER: każdy członek rozmowy (jak attach / pin).

create or replace function public.detach_message_from_thread(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv uuid;
  root_id uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select m.conversation_id, m.thread_root_id
    into conv, root_id
  from public.messages m
  where m.id = p_message_id and m.deleted_at is null;

  if conv is null then
    raise exception 'message not found';
  end if;
  if root_id is null then
    raise exception 'message is not a thread reply';
  end if;
  if not public.is_conversation_member(conv) then
    raise exception 'not a member';
  end if;

  update public.messages
  set thread_root_id = null
  where id = p_message_id;
end;
$$;

grant execute on function public.detach_message_from_thread(uuid) to authenticated;
