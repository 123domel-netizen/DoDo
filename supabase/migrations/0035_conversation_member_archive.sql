-- Per-user archiwizacja rozmów (jak pin/mute).
-- conversations.archived_at zostaje dla cross-org / blokady pisania.

alter table public.conversation_members
  add column if not exists archived_at timestamptz;

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
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a member';
  end if;
  insert into public.conversation_members (conversation_id, user_id, archived_at)
  values (p_conversation_id, caller, case when p_archived then now() end)
  on conflict (conversation_id, user_id) do update
    set archived_at = case when p_archived then now() else null end,
        left_at = null;
end;
$$;

grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;

-- Return type zmienia się → trzeba dropnąć poprzednią wersję.
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
  my_archived_at timestamptz,
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
           cm.marked_unread as r_marked_unread,
           cm.archived_at as r_archived_at
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id
     and cm.user_id = auth.uid()
     and cm.left_at is null
    where c.archived_at is null
    union all
    select c.*, null::timestamptz, 'all'::text, 'member'::text,
           null::timestamptz, null::timestamptz, false, null::timestamptz
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
    my.r_archived_at,
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

grant execute on function public.get_conversation_overview() to authenticated;
