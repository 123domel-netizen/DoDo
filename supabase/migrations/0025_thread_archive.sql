-- Archiwum wątków + czyszczenie pustego wątku (nazwa/przypięcie).

alter table public.messages
  add column if not exists thread_archived_at timestamptz;

comment on column public.messages.thread_archived_at is
  'Wątek zarchiwizowany — ukryty na głównej liście, dostępny w archiwum.';

create index if not exists messages_thread_archived_idx
  on public.messages (conversation_id, thread_archived_at desc)
  where thread_archived_at is not null;

-- Pozwól wyczyścić nazwę (null) — do usuwania pustego wątku / edycji.
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
  -- cleaned null = wyczyść nazwę; inaczej max 200 znaków
  if cleaned is not null and char_length(cleaned) > 200 then
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

create or replace function public.set_thread_archived(
  p_message_id uuid,
  p_archived boolean
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
begin
  if caller is null then
    raise exception 'not authenticated';
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
  set thread_archived_at = case when p_archived then now() else null end
  where id = p_message_id;
end;
$$;

-- Usuń pusty wątek z listy: bez odpowiedzi → czyści nazwę, pin i archiwum.
create or replace function public.dissolve_empty_thread(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv uuid;
  is_root boolean;
  reply_count integer;
begin
  if caller is null then
    raise exception 'not authenticated';
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

  select count(*)::integer into reply_count
  from public.messages r
  where r.thread_root_id = p_message_id
    and r.deleted_at is null;

  if reply_count > 0 then
    raise exception 'thread has replies — archive instead';
  end if;

  update public.messages
  set thread_title = null,
      pinned_at = null,
      pinned_by = null,
      thread_archived_at = null
  where id = p_message_id;
end;
$$;

grant execute on function public.set_thread_title(uuid, text) to authenticated;
grant execute on function public.set_thread_archived(uuid, boolean) to authenticated;
grant execute on function public.dissolve_empty_thread(uuid) to authenticated;
