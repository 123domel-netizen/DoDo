-- Domyślny widok listy tematów (kolumny / filtry / sort) — ustawia właściciel tablicy.

alter table public.boards
  add column if not exists default_topic_view jsonb;

alter table public.boards
  add column if not exists default_topic_view_rev integer not null default 0;

create or replace function public.board_set_default_topic_view(
  p_board_id uuid,
  p_view jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rev integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_owner(p_board_id) then
    raise exception 'not a board owner';
  end if;
  if p_view is null or jsonb_typeof(p_view) <> 'object' then
    raise exception 'invalid default topic view';
  end if;

  update public.boards
  set
    default_topic_view = p_view,
    default_topic_view_rev = default_topic_view_rev + 1,
    updated_at = now()
  where id = p_board_id
  returning default_topic_view_rev into v_rev;

  if v_rev is null then
    raise exception 'board not found';
  end if;
  return v_rev;
end;
$$;

revoke all on function public.board_set_default_topic_view(uuid, jsonb) from public;
revoke all on function public.board_set_default_topic_view(uuid, jsonb) from anon;
grant execute on function public.board_set_default_topic_view(uuid, jsonb) to authenticated;

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
  locality_enabled boolean,
  default_topic_view jsonb,
  default_topic_view_rev integer
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
    b.locality_enabled,
    b.default_topic_view,
    b.default_topic_view_rev
  from public.boards b
  where b.org_id = p_org_id
    and b.archived_at is null
  order by b.created_at;
$$;

revoke all on function public.get_my_boards(uuid) from public;
revoke all on function public.get_my_boards(uuid) from anon;
grant execute on function public.get_my_boards(uuid) to authenticated;
