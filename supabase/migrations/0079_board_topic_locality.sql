-- Miejscowość tematu (opcjonalna) + flaga org: czy zespół korzysta z miejscowości.

alter table public.orgs
  add column if not exists boards_topic_locality_enabled boolean not null default false;

alter table public.board_topics
  add column if not exists locality text;

alter table public.board_topics
  drop constraint if exists board_topics_locality_len;

alter table public.board_topics
  add constraint board_topics_locality_len
  check (locality is null or char_length(locality) <= 80);

-- ---------------------------------------------------------------------------
-- Normalizacja: trim, pusty → null
-- ---------------------------------------------------------------------------
create or replace function public.board_topics_normalize_locality()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.locality is not null then
    new.locality := nullif(btrim(regexp_replace(new.locality, '\s+', ' ', 'g')), '');
    if new.locality is not null and char_length(new.locality) > 80 then
      new.locality := left(new.locality, 80);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists board_topics_normalize_locality_trg on public.board_topics;
create trigger board_topics_normalize_locality_trg
  before insert or update of locality on public.board_topics
  for each row execute function public.board_topics_normalize_locality();

grant update (title, description, pinned_at, snoozed_until, closed_at, code, sort_order, locality)
  on public.board_topics to authenticated;

-- ---------------------------------------------------------------------------
-- Org RPC: włącz/wyłącz miejscowość na tablicach
-- ---------------------------------------------------------------------------
create or replace function public.org_set_boards_topic_locality_enabled(
  p_org_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_org_admin(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  update public.orgs
  set boards_topic_locality_enabled = p_enabled
  where id = p_org_id;
end;
$$;

revoke all on function public.org_set_boards_topic_locality_enabled(uuid, boolean) from public;
revoke all on function public.org_set_boards_topic_locality_enabled(uuid, boolean) from anon;
grant execute on function public.org_set_boards_topic_locality_enabled(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- org_my_orgs + org_get_detail: + boards_topic_locality_enabled
-- ---------------------------------------------------------------------------
drop function if exists public.org_my_orgs();

create or replace function public.org_my_orgs()
returns table (
  id uuid,
  name text,
  plan_code text,
  seat_limit int,
  plan_ends_at timestamptz,
  invites_locked boolean,
  created_at timestamptz,
  seat_used int,
  my_role text,
  schedules_enabled boolean,
  boards_topic_locality_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    o.id,
    o.name,
    o.plan_code,
    o.seat_limit,
    o.plan_ends_at,
    o.invites_locked,
    o.created_at,
    public.org_seat_usage(o.id),
    m.role,
    o.schedules_enabled,
    o.boards_topic_locality_enabled
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name;
end;
$$;

create or replace function public.org_get_detail(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orgs;
  result jsonb;
begin
  if not (public.is_org_member(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  perform public.org_expire_invites(p_org_id);
  select * into o from public.orgs where id = p_org_id;
  if not found then raise exception 'org not found'; end if;

  result := jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'planCode', o.plan_code,
    'seatLimit', o.seat_limit,
    'planEndsAt', o.plan_ends_at,
    'adminNote', case when public.is_app_admin() then o.admin_note else null end,
    'invitesLocked', o.invites_locked,
    'schedulesEnabled', o.schedules_enabled,
    'boardsTopicLocalityEnabled', o.boards_topic_locality_enabled,
    'createdAt', o.created_at,
    'seatUsed', public.org_seat_usage(p_org_id),
    'canInvite', public.org_can_invite(p_org_id),
    'overLimit', public.org_seat_usage(p_org_id) > o.seat_limit,
    'myRole', (
      select m.role from public.org_members m
      where m.org_id = p_org_id and m.user_id = auth.uid()
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'role', m.role,
        'joinedAt', m.joined_at,
        'email', u.email,
        'displayName', p.display_name,
        'avatarUrl', p.avatar_url
      ) order by m.role asc, p.display_name nulls last)
      from public.org_members m
      left join auth.users u on u.id = m.user_id
      left join public.profiles p on p.user_id = m.user_id
      where m.org_id = p_org_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.email,
        'status', i.status,
        'expiresAt', i.expires_at,
        'createdAt', i.created_at,
        'invitedBy', i.invited_by
      ) order by i.created_at desc)
      from public.org_invitations i
      where i.org_id = p_org_id and i.status = 'pending'
    ), '[]'::jsonb)
  );
  return result;
end;
$$;

revoke all on function public.org_my_orgs() from public;
revoke all on function public.org_my_orgs() from anon;
grant execute on function public.org_my_orgs() to authenticated;

revoke all on function public.org_get_detail(uuid) from public;
revoke all on function public.org_get_detail(uuid) from anon;
grant execute on function public.org_get_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_board_topics: + locality
-- ---------------------------------------------------------------------------
drop function if exists public.get_board_topics(uuid);

create or replace function public.get_board_topics(p_board_id uuid)
returns table (
  id uuid,
  board_id uuid,
  title text,
  description text,
  created_by uuid,
  pinned_at timestamptz,
  snoozed_until timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  code text,
  sort_order int,
  locality text,
  conversation_id uuid,
  last_activity_at timestamptz,
  comment_count bigint,
  unread_count bigint,
  last_comment jsonb,
  items jsonb,
  field_values jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.board_id, t.title, t.description, t.created_by,
    t.pinned_at, t.snoozed_until, t.closed_at, t.closed_by,
    t.created_at, t.updated_at,
    t.code, t.sort_order, t.locality,
    c.id as conversation_id,
    greatest(t.created_at, coalesce(c.last_message_at, t.created_at)) as last_activity_at,
    coalesce((
      select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.kind <> 'system'
    ), 0) as comment_count,
    coalesce((
      select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.kind <> 'system'
        and m.author_user_id <> auth.uid()
        and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
    ), 0) as unread_count,
    (
      select jsonb_build_object(
        'id', m.id,
        'kind', m.kind,
        'body', left(m.body, 300),
        'authorUserId', m.author_user_id,
        'createdAt', m.created_at
      )
      from public.messages m
      where m.conversation_id = c.id
        and m.deleted_at is null
        and m.kind <> 'system'
      order by m.created_at desc, m.id desc
      limit 1
    ) as last_comment,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'itemId', i.item_id,
        'itemType', i.item_type
      ) order by i.created_at), '[]'::jsonb)
      from public.board_topic_items i
      join public.items it on it.id = i.item_id and it.deleted_at is null
      where i.topic_id = t.id
    ) as items,
    (
      select coalesce(jsonb_object_agg(
        v.field_id::text,
        jsonb_build_object(
          'text', v.text_value,
          'optionIds', to_jsonb(v.option_ids)
        )
      ), '{}'::jsonb)
      from public.board_topic_field_values v
      where v.topic_id = t.id
        and public.can_see_board_field(v.field_id)
    ) as field_values
  from public.board_topics t
  join public.conversations c on c.board_topic_id = t.id and c.kind = 'board_topic'
  left join public.conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid()
  where t.board_id = p_board_id
    and public.is_board_member(p_board_id);
$$;

revoke all on function public.get_board_topics(uuid) from public;
revoke all on function public.get_board_topics(uuid) from anon;
grant execute on function public.get_board_topics(uuid) to authenticated;
