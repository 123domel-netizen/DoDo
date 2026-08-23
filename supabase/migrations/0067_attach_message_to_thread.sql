-- Przypisz samodzielną wiadomość (root bez odpowiedzi) do istniejącego wątku.
-- SECURITY DEFINER: każdy członek rozmowy może to zrobić (jak pin / tytuł),
-- bo RLS update na messages jest tylko dla autora.

create or replace function public.attach_message_to_thread(
  p_message_id uuid,
  p_thread_root_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  src_conv uuid;
  src_is_root boolean;
  tgt_conv uuid;
  tgt_is_root boolean;
  reply_count integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if p_message_id = p_thread_root_id then
    raise exception 'cannot attach message to itself';
  end if;

  select m.conversation_id, (m.thread_root_id is null)
    into src_conv, src_is_root
  from public.messages m
  where m.id = p_message_id and m.deleted_at is null;

  if src_conv is null then
    raise exception 'message not found';
  end if;
  if not src_is_root then
    raise exception 'message is already a thread reply';
  end if;
  if not public.is_conversation_member(src_conv) then
    raise exception 'not a member';
  end if;

  select count(*)::integer into reply_count
  from public.messages r
  where r.thread_root_id = p_message_id
    and r.deleted_at is null;

  if reply_count > 0 then
    raise exception 'message already has thread replies';
  end if;

  select m.conversation_id, (m.thread_root_id is null)
    into tgt_conv, tgt_is_root
  from public.messages m
  where m.id = p_thread_root_id and m.deleted_at is null;

  if tgt_conv is null then
    raise exception 'thread root not found';
  end if;
  if not tgt_is_root then
    raise exception 'target is not a thread root';
  end if;
  if tgt_conv <> src_conv then
    raise exception 'different conversation';
  end if;

  update public.messages
  set thread_root_id = p_thread_root_id,
      thread_title = null,
      pinned_at = null,
      pinned_by = null,
      thread_archived_at = null
  where id = p_message_id;
end;
$$;

revoke all on function public.attach_message_to_thread(uuid, uuid) from public;
grant execute on function public.attach_message_to_thread(uuid, uuid) to authenticated;
