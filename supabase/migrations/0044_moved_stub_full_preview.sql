-- Stub przeniesienia: pełniejszy snapshot (body + załączniki po rewrite ścieżek).

create or replace function public._message_preview_payload(p_msg public.messages)
returns jsonb
language plpgsql
stable
as $$
declare
  att_count int;
  preview text;
  atts jsonb;
begin
  select count(*), coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'messageId', a.message_id,
        'bucketPath', a.bucket_path,
        'thumbPath', a.thumb_path,
        'fileName', a.file_name,
        'mimeType', a.mime_type,
        'sizeBytes', a.size_bytes,
        'width', a.width,
        'height', a.height
      )
      order by a.file_name, a.id
    ),
    '[]'::jsonb
  )
  into att_count, atts
  from public.message_attachments a
  where a.message_id = p_msg.id;

  preview := case
    when p_msg.kind = 'voice' then coalesce(nullif(trim(p_msg.body), ''), 'Wiadomość głosowa')
    when p_msg.kind = 'gif' then coalesce(nullif(trim(p_msg.body), ''), 'GIF')
    when p_msg.kind = 'gallery' then coalesce(nullif(trim(p_msg.body), ''), 'Galeria')
    when p_msg.kind = 'poll' then coalesce(nullif(trim(p_msg.body), ''), 'Ankieta')
    else coalesce(p_msg.body, '')
  end;

  return jsonb_build_object(
    'kind', p_msg.kind,
    'body', preview,
    'payload', coalesce(p_msg.payload, '{}'::jsonb),
    'attachmentCount', coalesce(att_count, 0),
    'attachments', coalesce(atts, '[]'::jsonb),
    'authorUserId', p_msg.author_user_id,
    'createdAt', p_msg.created_at
  );
end;
$$;

-- Po przeniesieniu ścieżek Storage — zaktualizuj snapshot stubu (pełny podgląd w źródle).
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
  v_live public.messages%rowtype;
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

  update public.messages
  set conversation_id = p_target_conversation_id
  where id = any (v_ids);

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

  for att in
    select a.*
    from public.message_attachments a
    where a.message_id = any (v_ids)
  loop
    v_seg := substring(att.bucket_path from position('/' in att.bucket_path) + 1);
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

  -- Odśwież preview stubu ścieżkami po przeniesieniu (pełny podgląd plików/voice).
  select * into v_live from public.messages where id = p_root_id;
  if found then
    v_preview := public._message_preview_payload(v_live);
    update public.messages
    set payload = jsonb_set(
      payload,
      '{moved,preview}',
      v_preview,
      true
    )
    where id = v_stub_id;
  end if;

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
