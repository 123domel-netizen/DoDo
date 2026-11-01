-- Miejscowość włączana per tablica (nie per zespół).

alter table public.boards
  add column if not exists locality_enabled boolean not null default false;

-- Migracja: org, które miały włączone miejscowości → wszystkie ich tablice.
update public.boards b
set locality_enabled = true
from public.orgs o
where o.id = b.org_id
  and o.boards_topic_locality_enabled = true
  and b.locality_enabled = false;

create or replace function public.board_set_locality_enabled(
  p_board_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_owner(p_board_id) then
    raise exception 'not a board owner';
  end if;
  update public.boards
  set locality_enabled = coalesce(p_enabled, false)
  where id = p_board_id;
end;
$$;

revoke all on function public.board_set_locality_enabled(uuid, boolean) from public;
revoke all on function public.board_set_locality_enabled(uuid, boolean) from anon;
grant execute on function public.board_set_locality_enabled(uuid, boolean) to authenticated;

drop function if exists public.get_my_boards(uuid);

create or replace function public.get_my_boards(p_org_id uuid)
returns table (
  id uuid,
  org_id uuid,
  name text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  my_role text,
  unread_count bigint,
  members jsonb,
  locality_enabled boolean
)
language sql
stable
set search_path = public
as $$
  select
    b.id, b.org_id, b.name, b.created_by, b.created_at, b.updated_at,
    (select bm.role from public.board_members bm
       where bm.board_id = b.id and bm.user_id = auth.uid()) as my_role,
    coalesce((
      select count(*)
      from public.board_topics t
      join public.conversations c on c.board_topic_id = t.id and c.kind = 'board_topic'
      left join public.conversation_members cm
        on cm.conversation_id = c.id and cm.user_id = auth.uid()
      join public.messages m on m.conversation_id = c.id
      where t.board_id = b.id
        and m.deleted_at is null
        and m.kind <> 'system'
        and m.author_user_id <> auth.uid()
        and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
    ), 0) as unread_count,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', bm.user_id,
        'role', bm.role,
        'displayName', coalesce(p.display_name, ''),
        'avatarUrl', p.avatar_url
      ) order by bm.created_at), '[]'::jsonb)
      from public.board_members bm
      left join public.profiles p on p.user_id = bm.user_id
      where bm.board_id = b.id
    ) as members,
    b.locality_enabled
  from public.boards b
  where b.org_id = p_org_id
    and b.archived_at is null
  order by b.created_at;
$$;

revoke all on function public.get_my_boards(uuid) from public;
revoke all on function public.get_my_boards(uuid) from anon;
grant execute on function public.get_my_boards(uuid) to authenticated;
