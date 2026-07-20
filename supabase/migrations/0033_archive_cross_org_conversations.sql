-- Cross-org: archiwizacja zamiast usuwania (korekta po 0032 DELETE na remote).
-- Historia zostaje; overview filtruje archived_at; INSERT wiadomości już blokuje RLS.

-- ---------------------------------------------------------------------------
-- Archiwizuj pozostałe DM/kanały cross-org (idempotentne)
-- ---------------------------------------------------------------------------
update public.conversations c
set archived_at = coalesce(c.archived_at, now())
where c.kind in ('dm', 'channel')
  and c.archived_at is null
  and exists (
    select 1
    from public.conversation_members a
    join public.conversation_members b
      on b.conversation_id = a.conversation_id
     and b.user_id > a.user_id
    where a.conversation_id = c.id
      and a.left_at is null
      and b.left_at is null
      and not exists (
        select 1
        from public.org_members oa
        join public.org_members ob on ob.org_id = oa.org_id
        where oa.user_id = a.user_id
          and ob.user_id = b.user_id
      )
  );

-- ---------------------------------------------------------------------------
-- create_conversation: przy ponownym DM ze wspólnym orgem — odarchiwizuj
-- ---------------------------------------------------------------------------
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
    if coalesce(array_length(member_ids, 1), 0) < 2 then
      raise exception 'dm requires at least 2 members';
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

  return rec;
end;
$$;
