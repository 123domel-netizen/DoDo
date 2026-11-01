-- Podtematy (1 poziom): parent_id, create/reorder sibling-scoped, get_board_topics + parent_id.

alter table public.board_topics
  add column if not exists parent_id uuid references public.board_topics (id) on delete cascade;

create index if not exists board_topics_board_parent_sort_idx
  on public.board_topics (board_id, parent_id, sort_order);

-- parent musi być na tej samej tablicy, bez zagnieżdżania (tylko root → child)
create or replace function public.board_topics_validate_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent public.board_topics;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'topic cannot be its own parent';
  end if;
  select * into v_parent from public.board_topics where id = new.parent_id;
  if not found then
    raise exception 'parent topic not found';
  end if;
  if v_parent.board_id <> new.board_id then
    raise exception 'parent must be on the same board';
  end if;
  if v_parent.parent_id is not null then
    raise exception 'subtopics cannot have children';
  end if;
  return new;
end;
$$;

drop trigger if exists board_topics_validate_parent_trg on public.board_topics;
create trigger board_topics_validate_parent_trg
  before insert or update of parent_id, board_id on public.board_topics
  for each row execute function public.board_topics_validate_parent();

-- parent_id immutable po utworzeniu
create or replace function public.board_topics_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.board_id is distinct from old.board_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.parent_id is distinct from old.parent_id then
    raise exception 'board topic identity fields are immutable';
  end if;
  new.updated_at := now();
  if new.closed_at is distinct from old.closed_at then
    new.closed_by := case when new.closed_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- board_create_topic(+ optional parent)
-- ---------------------------------------------------------------------------
drop function if exists public.board_create_topic(uuid, uuid, text);

create or replace function public.board_create_topic(
  p_id uuid,
  p_board_id uuid,
  p_title text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_conv uuid;
  v_pos int;
  t public.board_topics;
  v_parent public.board_topics;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if p_id is null then
    raise exception 'topic id required';
  end if;
  if not public.is_board_member(p_board_id) then
    raise exception 'not a board member';
  end if;
  if exists (
    select 1 from public.boards b where b.id = p_board_id and b.archived_at is not null
  ) then
    raise exception 'board is archived';
  end if;

  select * into t from public.board_topics where id = p_id;
  if found then
    if t.board_id <> p_board_id or t.created_by is distinct from caller then
      raise exception 'topic id already used';
    end if;
    if t.parent_id is distinct from p_parent_id then
      raise exception 'topic id already used';
    end if;
    select id into v_conv from public.conversations
    where board_topic_id = p_id and kind = 'board_topic';
    return v_conv;
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'invalid topic title';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.board_topics where id = p_parent_id;
    if not found or v_parent.board_id <> p_board_id then
      raise exception 'parent topic not found';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'subtopics cannot have children';
    end if;
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_pos
  from public.board_topics
  where board_id = p_board_id
    and parent_id is not distinct from p_parent_id;

  insert into public.board_topics (id, board_id, title, created_by, sort_order, parent_id)
  values (p_id, p_board_id, v_title, caller, v_pos, p_parent_id);

  insert into public.conversations (kind, board_topic_id, created_by)
  values ('board_topic', p_id, caller)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id, role)
  select v_conv, bm.user_id, 'member'
  from public.board_members bm
  where bm.board_id = p_board_id
  on conflict (conversation_id, user_id) do update set left_at = null;

  return v_conv;
end;
$$;

revoke all on function public.board_create_topic(uuid, uuid, text, uuid) from public;
revoke all on function public.board_create_topic(uuid, uuid, text, uuid) from anon;
grant execute on function public.board_create_topic(uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- board_reorder_topics: kolejność w obrębie rodzeństwa (parent_id)
-- ---------------------------------------------------------------------------
drop function if exists public.board_reorder_topics(uuid, uuid[]);

create or replace function public.board_reorder_topics(
  p_board_id uuid,
  p_topic_ids uuid[],
  p_parent_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_count int;
  v_expected int;
  v_distinct int;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_member(p_board_id) then
    raise exception 'not a board member';
  end if;
  if p_topic_ids is null then
    raise exception 'invalid topic order';
  end if;

  select count(*) into v_expected
  from public.board_topics
  where board_id = p_board_id
    and parent_id is not distinct from p_parent_id;

  v_count := coalesce(cardinality(p_topic_ids), 0);
  if v_count <> v_expected then
    raise exception 'invalid topic order';
  end if;

  select count(distinct x) into v_distinct from unnest(p_topic_ids) as x;
  if v_distinct <> v_count then
    raise exception 'invalid topic order';
  end if;

  if exists (
    select 1
    from unnest(p_topic_ids) as x(id)
    where not exists (
      select 1 from public.board_topics t
      where t.id = x.id
        and t.board_id = p_board_id
        and t.parent_id is not distinct from p_parent_id
    )
  ) then
    raise exception 'invalid topic order';
  end if;

  update public.board_topics t
  set sort_order = o.ord
  from unnest(p_topic_ids) with ordinality as o(id, ord)
  where t.id = o.id
    and t.board_id = p_board_id;
end;
$$;

revoke all on function public.board_reorder_topics(uuid, uuid[], uuid) from public;
revoke all on function public.board_reorder_topics(uuid, uuid[], uuid) from anon;
grant execute on function public.board_reorder_topics(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_board_topics: + parent_id
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
  parent_id uuid,
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
    t.code, t.sort_order, t.locality, t.parent_id,
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
