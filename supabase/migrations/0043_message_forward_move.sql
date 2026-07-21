-- Przekaż / Przenieś wiadomość (z wątkiem) + przepisanie ścieżek Storage.

-- ---------------------------------------------------------------------------
-- Helper: aktywne członkostwo (bez item-derived) — do filtrów „autor w celu”
-- ---------------------------------------------------------------------------
create or replace function public.is_active_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.left_at is null
  );
$$;

revoke all on function public.is_active_conversation_member(uuid, uuid) from public;
grant execute on function public.is_active_conversation_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Skopiuj / przenieś obiekt w bucketcie chat-attachments (security definer)
-- ---------------------------------------------------------------------------
create or replace function public._chat_storage_copy(p_from text, p_to text)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if p_from is null or p_to is null or p_from = p_to then
    return false;
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'chat-attachments' and name = p_from
  ) then
    return false;
  end if;
  delete from storage.objects
  where bucket_id = 'chat-attachments' and name = p_to;

  insert into storage.objects (bucket_id, name, owner, metadata)
  select bucket_id, p_to, owner, metadata
  from storage.objects
  where bucket_id = 'chat-attachments' and name = p_from
  limit 1;

  return true;
exception
  when others then
    raise warning 'chat_storage_copy % -> % failed: %', p_from, p_to, sqlerrm;
    return false;
end;
$$;

create or replace function public._chat_storage_move(p_from text, p_to text)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if p_from is null or p_to is null then
    return false;
  end if;
  if p_from = p_to then
    return true;
  end if;

  update storage.objects
  set name = p_to
  where bucket_id = 'chat-attachments' and name = p_from;

  if found then
    return true;
  end if;

  -- Już w celu?
  if exists (
    select 1 from storage.objects
    where bucket_id = 'chat-attachments' and name = p_to
  ) then
    return true;
  end if;

  return public._chat_storage_copy(p_from, p_to);
exception
  when unique_violation then
    perform public._chat_storage_copy(p_from, p_to);
    delete from storage.objects
    where bucket_id = 'chat-attachments' and name = p_from;
    return true;
  when others then
    raise warning 'chat_storage_move % -> % failed: %', p_from, p_to, sqlerrm;
    return public._chat_storage_copy(p_from, p_to);
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot podglądu do stubów / forward
-- ---------------------------------------------------------------------------
create or replace function public._message_preview_payload(p_msg public.messages)
returns jsonb
language plpgsql
stable
as $$
declare
  att_count int;
  preview text;
begin
  select count(*) into att_count
  from public.message_attachments a
  where a.message_id = p_msg.id;

  preview := case
    when p_msg.kind = 'voice' then 'Wiadomość głosowa'
    when p_msg.kind = 'gif' then 'GIF'
    when p_msg.kind = 'gallery' then coalesce(nullif(trim(p_msg.body), ''), 'Galeria')
    when p_msg.kind = 'poll' then coalesce(nullif(trim(p_msg.body), ''), 'Ankieta')
    else left(coalesce(p_msg.body, ''), 280)
  end;

  return jsonb_build_object(
    'kind', p_msg.kind,
    'body', preview,
    'payload', coalesce(p_msg.payload, '{}'::jsonb),
    'attachmentCount', att_count,
    'authorUserId', p_msg.author_user_id,
    'createdAt', p_msg.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- PRZEKAŻ: nowe wiadomości w celu, autor = caller, z payload.forward
-- ---------------------------------------------------------------------------
create or replace function public.forward_message_thread(
  p_root_id uuid,
  p_target_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_caller uuid := auth.uid();
  v_root public.messages%rowtype;
  v_src_conv uuid;
  r public.messages%rowtype;
  v_new_root_id uuid;
  v_id_map jsonb := '{}'::jsonb;
  v_old_id uuid;
  v_new_id uuid;
  v_new_thread uuid;
  v_new_reply uuid;
  v_payload jsonb;
  v_fwd_meta jsonb;
  att record;
  v_new_att_id uuid;
  v_new_bucket text;
  v_new_thumb text;
  v_order int := 0;
begin
  if v_caller is null then
    raise exception 'Brak sesji.';
  end if;

  select * into v_root from public.messages where id = p_root_id;
  if not found then
    raise exception 'Wiadomość nie istnieje.';
  end if;
  if v_root.deleted_at is not null then
    raise exception 'Nie można przekazać usuniętej wiadomości.';
  end if;
  if v_root.thread_root_id is not null then
    -- Zawsze operuj na rootcie
    p_root_id := v_root.thread_root_id;
    select * into v_root from public.messages where id = p_root_id;
  end if;
  if coalesce(v_root.payload->>'movedStub', '') = 'true' then
    raise exception 'Nie można przekazać znacznika przeniesienia.';
  end if;

  v_src_conv := v_root.conversation_id;
  if v_src_conv = p_target_conversation_id then
    raise exception 'Wybierz inną rozmowę docelową.';
  end if;
  if not public.is_conversation_member(v_src_conv) then
    raise exception 'Nie jesteś członkiem rozmowy źródłowej.';
  end if;
  if not public.is_conversation_member(p_target_conversation_id) then
    raise exception 'Nie jesteś członkiem rozmowy docelowej.';
  end if;

  -- Mapuj id: root + replies (nieusunięte)
  for r in
    select *
    from public.messages m
    where m.deleted_at is null
      and (m.id = p_root_id or m.thread_root_id = p_root_id)
    order by m.created_at asc, m.id asc
  loop
    v_id_map := v_id_map || jsonb_build_object(r.id::text, gen_random_uuid()::text);
  end loop;

  if v_id_map = '{}'::jsonb then
    raise exception 'Brak wiadomości do przekazania.';
  end if;

  v_new_root_id := (v_id_map->>p_root_id::text)::uuid;

  v_fwd_meta := jsonb_build_object(
    'fromMessageId', p_root_id,
    'fromConversationId', v_src_conv,
    'forwardedAt', now(),
    'originalAuthorUserId', v_root.author_user_id,
    'preview', public._message_preview_payload(v_root)
  );

  for r in
    select *
    from public.messages m
    where m.deleted_at is null
      and (m.id = p_root_id or m.thread_root_id = p_root_id)
    order by m.created_at asc, m.id asc
  loop
    v_old_id := r.id;
    v_new_id := (v_id_map->>v_old_id::text)::uuid;
    v_new_thread := case
      when r.thread_root_id is null then null
      else (v_id_map->>r.thread_root_id::text)::uuid
    end;
    v_new_reply := case
      when r.reply_to_message_id is not null
        and v_id_map ? r.reply_to_message_id::text
      then (v_id_map->>r.reply_to_message_id::text)::uuid
      else null
    end;

    v_payload := coalesce(r.payload, '{}'::jsonb);
    -- Świeża ankieta bez powiązania ze starymi głosami
    if r.kind = 'poll' then
      v_payload := jsonb_build_object('poll', coalesce(v_payload->'poll', '{}'::jsonb));
    end if;
    if r.id = p_root_id then
      v_payload := v_payload || jsonb_build_object('forward', v_fwd_meta);
    else
      v_payload := v_payload || jsonb_build_object(
        'forward',
        jsonb_build_object(
          'fromMessageId', r.id,
          'fromConversationId', v_src_conv,
          'forwardedAt', now(),
          'originalAuthorUserId', r.author_user_id,
          'threadRootForward', v_fwd_meta
        )
      );
    end if;

    insert into public.messages (
      id, conversation_id, author_user_id, kind, body, payload, mentions,
      thread_root_id, reply_to_message_id, created_at
    ) values (
      v_new_id,
      p_target_conversation_id,
      v_caller,
      r.kind,
      r.body,
      v_payload,
      coalesce(r.mentions, '{}'::uuid[]),
      v_new_thread,
      v_new_reply,
      now() + (v_order * interval '1 millisecond')
    );
    v_order := v_order + 1;

    -- Załączniki: kopia Storage + nowe metadane
    for att in
      select * from public.message_attachments a where a.message_id = v_old_id
    loop
      v_new_att_id := gen_random_uuid();
      v_new_bucket := p_target_conversation_id::text || '/' || v_new_id::text || '/' ||
        coalesce(nullif(split_part(att.bucket_path, '/', 3), ''), v_new_att_id::text);
      v_new_thumb := case
        when att.thumb_path is null then null
        else p_target_conversation_id::text || '/' || v_new_id::text || '/' ||
          coalesce(nullif(split_part(att.thumb_path, '/', 3), ''), v_new_att_id::text || '-thumb')
      end;
      perform public._chat_storage_copy(att.bucket_path, v_new_bucket);
      if v_new_thumb is not null then
        perform public._chat_storage_copy(att.thumb_path, v_new_thumb);
      end if;
      insert into public.message_attachments (
        id, message_id, bucket_path, thumb_path, file_name, mime_type,
        size_bytes, width, height
      ) values (
        v_new_att_id, v_new_id, v_new_bucket, v_new_thumb, att.file_name,
        att.mime_type, att.size_bytes, att.width, att.height
      );
    end loop;
  end loop;

  -- Tytuł wątku na nowym rootcie (opcjonalnie)
  if v_root.thread_title is not null then
    update public.messages
    set thread_title = v_root.thread_title
    where id = v_new_root_id;
  end if;

  update public.conversations
  set last_message_at = now()
  where id = p_target_conversation_id;

  return jsonb_build_object(
    'newRootId', v_new_root_id,
    'targetConversationId', p_target_conversation_id,
    'count', v_order
  );
end;
$$;

revoke all on function public.forward_message_thread(uuid, uuid) from public;
grant execute on function public.forward_message_thread(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- PRZENIEŚ: te same id → nowa rozmowa; stub w źródle
-- ---------------------------------------------------------------------------
create or replace function public.move_message_thread(
  p_root_id uuid,
  p_target_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_caller uuid := auth.uid();
  v_root public.messages%rowtype;
  v_src_conv uuid;
  v_stub_id uuid := gen_random_uuid();
  v_ids uuid[];
  v_id uuid;
  att record;
  v_new_bucket text;
  v_new_thumb text;
  v_preview jsonb;
  v_seg text;
begin
  if v_caller is null then
    raise exception 'Brak sesji.';
  end if;

  select * into v_root from public.messages where id = p_root_id;
  if not found then
    raise exception 'Wiadomość nie istnieje.';
  end if;
  if v_root.thread_root_id is not null then
    p_root_id := v_root.thread_root_id;
    select * into v_root from public.messages where id = p_root_id;
  end if;
  if v_root.deleted_at is not null then
    raise exception 'Nie można przenieść usuniętej wiadomości.';
  end if;
  if coalesce(v_root.payload->>'movedStub', '') = 'true' then
    raise exception 'To już jest znacznik przeniesienia.';
  end if;
  if v_root.author_user_id <> v_caller then
    raise exception 'Tylko autor może przenieść wiadomość.';
  end if;

  v_src_conv := v_root.conversation_id;
  if v_src_conv = p_target_conversation_id then
    raise exception 'Wybierz inną rozmowę docelową.';
  end if;
  if not public.is_conversation_member(v_src_conv) then
    raise exception 'Nie jesteś członkiem rozmowy źródłowej.';
  end if;
  if not public.is_active_conversation_member(p_target_conversation_id, v_root.author_user_id) then
    raise exception 'Nadawca musi być członkiem rozmowy docelowej.';
  end if;
  if not public.is_conversation_member(p_target_conversation_id) then
    raise exception 'Nie jesteś członkiem rozmowy docelowej.';
  end if;

  select array_agg(m.id order by m.created_at, m.id)
  into v_ids
  from public.messages m
  where m.deleted_at is null
    and (m.id = p_root_id or m.thread_root_id = p_root_id);

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'Brak wiadomości do przeniesienia.';
  end if;

  v_preview := public._message_preview_payload(v_root);

  -- Stub w źródle (zostaje widoczny, przygaszony w UI)
  insert into public.messages (
    id, conversation_id, author_user_id, kind, body, payload, mentions, created_at
  ) values (
    v_stub_id,
    v_src_conv,
    v_caller,
    'system',
    'Przeniesiono wiadomość',
    jsonb_build_object(
      'movedStub', true,
      'moved', jsonb_build_object(
        'toConversationId', p_target_conversation_id,
        'toMessageId', p_root_id,
        'movedAt', now(),
        'movedBy', v_caller,
        'preview', v_preview
      )
    ),
    '{}'::uuid[],
    now()
  );

  -- Przenieś wiadomości
  update public.messages
  set conversation_id = p_target_conversation_id
  where id = any (v_ids);

  -- Galerie powiązane z tymi wiadomościami
  update public.galleries
  set conversation_id = p_target_conversation_id,
      updated_at = now()
  where message_id = any (v_ids)
     or id in (
       select (m.payload->'gallery'->>'galleryId')::uuid
       from public.messages m
       where m.id = any (v_ids)
         and m.payload->'gallery'->>'galleryId' is not null
     );

  -- Storage: przepisz ścieżki {src}/{msg}/… → {target}/{msg}/…
  for att in
    select a.*
    from public.message_attachments a
    where a.message_id = any (v_ids)
  loop
    v_seg := substring(att.bucket_path from position('/' in att.bucket_path) + 1);
    -- po pierwszym slashu: {messageId}/…
    if v_seg not like att.message_id::text || '/%' then
      v_seg := att.message_id::text || '/' || coalesce(nullif(split_part(att.bucket_path, '/', 3), ''), att.id::text);
    end if;
    v_new_bucket := p_target_conversation_id::text || '/' || v_seg;
    perform public._chat_storage_move(att.bucket_path, v_new_bucket);

    v_new_thumb := null;
    if att.thumb_path is not null then
      v_seg := substring(att.thumb_path from position('/' in att.thumb_path) + 1);
      if v_seg not like att.message_id::text || '/%' then
        v_seg := att.message_id::text || '/' || coalesce(nullif(split_part(att.thumb_path, '/', 3), ''), att.id::text || '-thumb');
      end if;
      v_new_thumb := p_target_conversation_id::text || '/' || v_seg;
      perform public._chat_storage_move(att.thumb_path, v_new_thumb);
    end if;

    update public.message_attachments
    set bucket_path = v_new_bucket,
        thumb_path = v_new_thumb
    where id = att.id;
  end loop;

  update public.conversations set last_message_at = now() where id = p_target_conversation_id;
  update public.conversations set last_message_at = now() where id = v_src_conv;

  return jsonb_build_object(
    'rootId', p_root_id,
    'stubId', v_stub_id,
    'fromConversationId', v_src_conv,
    'toConversationId', p_target_conversation_id,
    'count', array_length(v_ids, 1)
  );
end;
$$;

revoke all on function public.move_message_thread(uuid, uuid) from public;
grant execute on function public.move_message_thread(uuid, uuid) to authenticated;
