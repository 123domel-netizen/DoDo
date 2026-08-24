-- Solo-DM („Notatnik”): DM z jednym członkiem (caller).
-- dm_key = userId (jedna UUID w array_to_string).

create or replace function public.create_conversation(
  p_kind text,
  p_name text default null,
  p_is_public boolean default false,
  p_member_ids uuid[] default '{}'
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  member_ids uuid[];
  v_dm_key text;
  rec public.conversations;
  m uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('channel', 'dm') then
    raise exception 'invalid kind';
  end if;

  if not exists (
    select 1 from public.org_members om where om.user_id = caller
  ) then
    raise exception 'must belong to an org';
  end if;

  select array_agg(distinct u order by u) into member_ids
  from unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), caller)) as u
  where u is not null;

  if exists (
    select 1 from unnest(member_ids) as x(uid)
    where x.uid <> caller and not public.shares_org_with(x.uid)
  ) then
    raise exception 'members must share an org with you';
  end if;

  if p_kind = 'dm' then
    if coalesce(array_length(member_ids, 1), 0) < 1 then
      raise exception 'dm requires at least 1 member';
    end if;
    if array_length(member_ids, 1) > 8 then
      raise exception 'dm too large — create a channel';
    end if;
    v_dm_key := array_to_string(member_ids, ':');

    select * into rec
    from public.conversations
    where kind = 'dm' and dm_key = v_dm_key;

    if not found then
      begin
        insert into public.conversations (kind, dm_key, created_by)
        values ('dm', v_dm_key, caller)
        returning * into rec;
      exception when unique_violation then
        select * into rec
        from public.conversations
        where kind = 'dm' and dm_key = v_dm_key;
      end;
    end if;

    -- Wspólny org już zweryfikowany → wolno wznowić zarchiwizowaną rozmowę.
    -- Solo-DM (Notatnik): zawsze odarchiwizuj przy ensure/create.
    if rec.archived_at is not null then
      update public.conversations
      set archived_at = null
      where id = rec.id
      returning * into rec;
    end if;
  else
    if nullif(trim(p_name), '') is null then
      raise exception 'channel requires a name';
    end if;
    insert into public.conversations (kind, name, is_public, created_by)
    values ('channel', trim(p_name), coalesce(p_is_public, false), caller)
    returning * into rec;
  end if;

  foreach m in array member_ids loop
    insert into public.conversation_members (conversation_id, user_id, role)
    values (rec.id, m, case when m = caller then 'owner' else 'member' end)
    on conflict (conversation_id, user_id) do update set left_at = null;
  end loop;

  -- Notatnik: wyczyść osobiste archiwum członka (żeby ensure zawsze otwierał aktywną rozmowę).
  if p_kind = 'dm' and array_length(member_ids, 1) = 1 then
    update public.conversation_members
    set archived_at = null
    where conversation_id = rec.id
      and user_id = caller
      and archived_at is not null;
  end if;

  return rec;
end;
$$;

revoke all on function public.create_conversation(text, text, boolean, uuid[]) from public;
grant execute on function public.create_conversation(text, text, boolean, uuid[]) to authenticated;

-- Blokada archiwizacji Notatnika (solo-DM).
create or replace function public.set_conversation_archived(
  p_conversation_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv_kind text;
  v_dm_key text;
  active_members integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select c.kind, c.dm_key into conv_kind, v_dm_key
  from public.conversations c
  where c.id = p_conversation_id;

  if conv_kind is null then
    raise exception 'conversation not found';
  end if;

  if conv_kind = 'channel' then
    if not public.is_conversation_admin(p_conversation_id) then
      raise exception 'not an admin';
    end if;
    update public.conversations
    set channel_archived_at = case when p_archived then now() else null end
    where id = p_conversation_id;
    return;
  end if;

  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a member';
  end if;

  -- Solo-DM = Notatnik: nie wolno archiwizować.
  if p_archived and conv_kind = 'dm' and v_dm_key = caller::text then
    raise exception 'cannot archive notebook';
  end if;

  select count(*)::integer into active_members
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.left_at is null;

  if p_archived and conv_kind = 'dm' and active_members <= 1 then
    raise exception 'cannot archive notebook';
  end if;

  insert into public.conversation_members (conversation_id, user_id, archived_at)
  values (p_conversation_id, caller, case when p_archived then now() end)
  on conflict (conversation_id, user_id) do update
    set archived_at = case when p_archived then now() else null end,
        left_at = null;
end;
$$;

revoke all on function public.set_conversation_archived(uuid, boolean) from public;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;
