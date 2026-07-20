-- Live chat: publikacja attachmentów/linków + czat tylko w obrębie wspólnego org.

-- ---------------------------------------------------------------------------
-- Realtime publication (subskrypcje w kliencie już istnieją)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_attachments'
  ) then
    alter publication supabase_realtime add table public.message_attachments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_item_links'
  ) then
    alter publication supabase_realtime add table public.message_item_links;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Wspólny zespół (org)
-- ---------------------------------------------------------------------------
create or replace function public.shares_org_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members a
    join public.org_members b on b.org_id = a.org_id
    where a.user_id = auth.uid()
      and b.user_id = p_other
  );
$$;

grant execute on function public.shares_org_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_conversation: tylko członkowie wspólnego org
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

-- ---------------------------------------------------------------------------
-- invite_to_conversation
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_conversation(
  p_conversation_id uuid,
  p_user_id uuid
)
returns public.conversation_members
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.conversation_members;
begin
  if not public.is_conversation_admin(p_conversation_id) then
    raise exception 'not an admin';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.kind = 'channel'
  ) then
    raise exception 'invites only for channels';
  end if;
  if not public.shares_org_with(p_user_id) then
    raise exception 'target not in your org';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (p_conversation_id, p_user_id)
  on conflict (conversation_id, user_id) do update set left_at = null
  returning * into rec;
  return rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- join_channel: publiczny kanał tylko jeśli dzielisz org z członkiem/twórcą
-- ---------------------------------------------------------------------------
create or replace function public.join_channel(p_conversation_id uuid)
returns public.conversation_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  rec public.conversation_members;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.kind = 'channel'
      and c.is_public
      and c.archived_at is null
  ) then
    raise exception 'not a public channel';
  end if;

  if not exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.left_at is null
      and public.shares_org_with(cm.user_id)
  ) and not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.created_by is not null
      and public.shares_org_with(c.created_by)
  ) then
    raise exception 'must share an org with a channel member';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (p_conversation_id, caller)
  on conflict (conversation_id, user_id) do update set left_at = null
  returning * into rec;
  return rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- Archiwizuj istniejące DM/kanały cross-org (historia zostaje; kind=item bez zmian)
-- UWAGA: na remote 0032 mogło wcześniej wykonać DELETE — patrz 0033.
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
-- profiles: katalog tylko współ-członków org (+ własne)
-- ---------------------------------------------------------------------------
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.shares_org_with(user_id)
  );
