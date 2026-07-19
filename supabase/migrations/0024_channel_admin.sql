-- Kanały: ikona + zarządzanie członkami/adminami (zawsze ≥1 admin).

alter table public.conversations
  add column if not exists icon_url text;

-- ---------------------------------------------------------------------------
-- Licznik aktywnych adminów (owner | admin)
-- ---------------------------------------------------------------------------
create or replace function public.count_conversation_admins(p_conversation_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.left_at is null
    and cm.role in ('owner', 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Usunięcie członka (tylko admin kanału)
-- ---------------------------------------------------------------------------
create or replace function public.remove_from_conversation(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  admin_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_conversation_admin(p_conversation_id) then
    raise exception 'not an admin';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.kind = 'channel'
  ) then
    raise exception 'remove only for channels';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'use leave_conversation to leave';
  end if;

  select cm.role into target_role
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id = p_user_id
    and cm.left_at is null;

  if target_role is null then
    raise exception 'not a member';
  end if;

  if target_role in ('owner', 'admin') then
    admin_count := public.count_conversation_admins(p_conversation_id);
    if admin_count <= 1 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  update public.conversation_members
  set left_at = now()
  where conversation_id = p_conversation_id
    and user_id = p_user_id
    and left_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nadanie / odebranie roli admin (tylko admin kanału)
-- ---------------------------------------------------------------------------
create or replace function public.set_member_role(
  p_conversation_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
  admin_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_conversation_admin(p_conversation_id) then
    raise exception 'not an admin';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.kind = 'channel'
  ) then
    raise exception 'roles only for channels';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'role must be admin or member';
  end if;

  select cm.role into current_role
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id = p_user_id
    and cm.left_at is null;

  if current_role is null then
    raise exception 'not a member';
  end if;

  -- Odebranie admina: zostaw ≥1 (owner liczy się jako admin)
  if current_role in ('owner', 'admin') and p_role = 'member' then
    admin_count := public.count_conversation_admins(p_conversation_id);
    if admin_count <= 1 then
      raise exception 'at least one admin required';
    end if;
  end if;

  update public.conversation_members
  set role = p_role
  where conversation_id = p_conversation_id
    and user_id = p_user_id
    and left_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- leave: nie pozwól opuścić kanału jako ostatni admin
-- ---------------------------------------------------------------------------
create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_role text;
  conv_kind text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select c.kind into conv_kind
  from public.conversations c
  where c.id = p_conversation_id;

  select cm.role into my_role
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id = auth.uid()
    and cm.left_at is null;

  if my_role is null then
    return;
  end if;

  if conv_kind = 'channel'
     and my_role in ('owner', 'admin')
     and public.count_conversation_admins(p_conversation_id) <= 1 then
    raise exception 'cannot leave as the last admin — promote someone first';
  end if;

  update public.conversation_members
  set left_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid()
    and left_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overview + icon_url
-- ---------------------------------------------------------------------------
drop function if exists public.get_conversation_overview();

create function public.get_conversation_overview()
returns table (
  id uuid,
  kind text,
  name text,
  description text,
  is_public boolean,
  item_id uuid,
  created_by uuid,
  last_message_at timestamptz,
  created_at timestamptz,
  icon_url text,
  my_last_read_at timestamptz,
  my_notify text,
  my_role text,
  my_pinned_at timestamptz,
  my_muted_until timestamptz,
  my_marked_unread boolean,
  unread_count bigint,
  last_message jsonb,
  members jsonb
)
language sql stable
security definer
set search_path = public
as $$
  with my as (
    select c.*,
           cm.last_read_at as r_last_read,
           cm.notify as r_notify,
           cm.role as r_role,
           cm.pinned_at as r_pinned_at,
           cm.muted_until as r_muted_until,
           cm.marked_unread as r_marked_unread
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id
     and cm.user_id = auth.uid()
     and cm.left_at is null
    where c.archived_at is null
    union all
    select c.*, null::timestamptz, 'all'::text, 'member'::text,
           null::timestamptz, null::timestamptz, false
    from public.conversations c
    where c.kind = 'item'
      and c.archived_at is null
      and public.can_access_item(c.item_id)
      and not exists (
        select 1 from public.conversation_members cm2
        where cm2.conversation_id = c.id and cm2.user_id = auth.uid()
      )
  )
  select
    my.id, my.kind, my.name, my.description, my.is_public,
    my.item_id, my.created_by, my.last_message_at, my.created_at,
    my.icon_url,
    my.r_last_read, my.r_notify, my.r_role,
    my.r_pinned_at, my.r_muted_until, my.r_marked_unread,
    coalesce((
      select count(*)
      from public.messages m
      where m.conversation_id = my.id
        and m.deleted_at is null
        and m.thread_root_id is null
        and m.author_user_id <> auth.uid()
        and m.created_at > coalesce(my.r_last_read, 'epoch'::timestamptz)
    ), 0) as unread_count,
    (
      select to_jsonb(x)
      from (
        select m.id, m.kind, m.body, m.author_user_id, m.created_at, m.deleted_at
        from public.messages m
        where m.conversation_id = my.id
          and m.thread_root_id is null
        order by m.created_at desc, m.id desc
        limit 1
      ) x
    ) as last_message,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', cm.user_id,
        'role', cm.role,
        'displayName', coalesce(p.display_name, ''),
        'avatarUrl', p.avatar_url
      )), '[]'::jsonb)
      from public.conversation_members cm
      left join public.profiles p on p.user_id = cm.user_id
      where cm.conversation_id = my.id and cm.left_at is null
    ) as members
  from my
  order by coalesce(my.last_message_at, my.created_at) desc;
$$;

grant execute on function public.count_conversation_admins(uuid) to authenticated;
grant execute on function public.remove_from_conversation(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.leave_conversation(uuid) to authenticated;
grant execute on function public.get_conversation_overview() to authenticated;

-- Załączniki wiadomości: bez folderu _icon (ikony tylko dla admina)
drop policy if exists "chat attachments insert" on storage.objects;
create policy "chat attachments insert" on storage.objects
  for insert with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] is distinct from '_icon'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

-- Ikony kanału: admin może wgrywać/usuwać w folderze {conversation_id}/_icon/
drop policy if exists "chat channel icon insert" on storage.objects;
create policy "chat channel icon insert" on storage.objects
  for insert with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = '_icon'
    and public.is_conversation_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat channel icon update" on storage.objects;
create policy "chat channel icon update" on storage.objects
  for update using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = '_icon'
    and public.is_conversation_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "chat channel icon delete" on storage.objects;
create policy "chat channel icon delete" on storage.objects
  for delete using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = '_icon'
    and public.is_conversation_admin(((storage.foldername(name))[1])::uuid)
  );
