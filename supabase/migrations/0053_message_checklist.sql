-- Mini checklista w czacie: kind + wspólne odhaczanie punktów (RPC).

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text', 'system', 'poll', 'gif', 'voice', 'gallery', 'checklist'));

create or replace function public.toggle_message_checklist_item(
  p_message_id uuid,
  p_item_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages%rowtype;
  v_items jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_found boolean := false;
  v_done boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_msg
  from public.messages
  where id = p_message_id
  for update;

  if not found then
    raise exception 'message not found';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'message deleted';
  end if;
  if v_msg.kind <> 'checklist' then
    raise exception 'not a checklist';
  end if;
  if not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'not a member';
  end if;

  v_items := coalesce(v_msg.payload #> '{checklist,items}', '[]'::jsonb);

  for v_elem in select value from jsonb_array_elements(v_items) as t(value)
  loop
    if v_elem->>'id' = p_item_id then
      v_found := true;
      v_done := not coalesce((v_elem->>'done')::boolean, false);
      v_elem := jsonb_set(v_elem, '{done}', to_jsonb(v_done), true);
    end if;
    v_new_items := v_new_items || jsonb_build_array(v_elem);
  end loop;

  if not v_found then
    raise exception 'item not found';
  end if;

  update public.messages
  set payload = jsonb_set(
    coalesce(payload, '{}'::jsonb),
    '{checklist}',
    jsonb_build_object('items', v_new_items),
    true
  )
  where id = p_message_id;

  return jsonb_build_object('items', v_new_items);
end;
$$;

revoke all on function public.toggle_message_checklist_item(uuid, text) from public;
grant execute on function public.toggle_message_checklist_item(uuid, text) to authenticated;
grant execute on function public.toggle_message_checklist_item(uuid, text) to service_role;

-- Preview przy forward/move: etykieta checklisty
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
    when p_msg.kind = 'checklist' then coalesce(nullif(trim(p_msg.body), ''), 'Checklista')
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
