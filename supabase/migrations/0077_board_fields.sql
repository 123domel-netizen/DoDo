-- Pola niestandardowe tablicy: definicje (owner) + wartosci na tematach (czlonkowie).
-- Typy: single / multi / text. Visibility restricted (= "ukryte") tylko dla text.

-- ---------------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------------
create table if not exists public.board_fields (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text not null,
  kind        text not null,
  visibility  text not null default 'all',
  sort_order    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint board_fields_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint board_fields_kind check (kind in ('single', 'multi', 'text')),
  constraint board_fields_visibility check (visibility in ('all', 'restricted')),
  constraint board_fields_restricted_text check (
    visibility = 'all' or kind = 'text'
  )
);

create index if not exists board_fields_board_sort_order_idx
  on public.board_fields (board_id, sort_order, created_at);

create table if not exists public.board_field_options (
  id         uuid primary key default gen_random_uuid(),
  field_id   uuid not null references public.board_fields (id) on delete cascade,
  label      text not null,
  sort_order   int not null default 0,
  created_at timestamptz not null default now(),
  constraint board_field_options_label_len check (char_length(btrim(label)) between 1 and 80)
);

create index if not exists board_field_options_field_sort_order_idx
  on public.board_field_options (field_id, sort_order, created_at);

create table if not exists public.board_field_viewers (
  field_id uuid not null references public.board_fields (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  primary key (field_id, user_id)
);

create table if not exists public.board_topic_field_values (
  topic_id    uuid not null references public.board_topics (id) on delete cascade,
  field_id    uuid not null references public.board_fields (id) on delete cascade,
  text_value  text,
  option_ids  uuid[] not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (topic_id, field_id),
  constraint board_topic_field_values_text_len check (
    text_value is null or char_length(text_value) <= 200
  )
);

create index if not exists board_topic_field_values_field_idx
  on public.board_topic_field_values (field_id);

-- ---------------------------------------------------------------------------
-- Helper: widocznosc pola
-- ---------------------------------------------------------------------------
create or replace function public.can_see_board_field(p_field_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_fields f
    where f.id = p_field_id
      and public.is_board_member(f.board_id)
      and (
        f.visibility = 'all'
        or public.is_board_owner(f.board_id)
        or exists (
          select 1
          from public.board_field_viewers v
          where v.field_id = f.id
            and v.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.can_see_board_field(uuid) from public;
revoke all on function public.can_see_board_field(uuid) from anon;
grant execute on function public.can_see_board_field(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (SELECT dla czlonkow z filtrem; zapis tylko przez RPC)
-- ---------------------------------------------------------------------------
alter table public.board_fields enable row level security;
alter table public.board_field_options enable row level security;
alter table public.board_field_viewers enable row level security;
alter table public.board_topic_field_values enable row level security;

drop policy if exists "board fields readable when visible" on public.board_fields;
create policy "board fields readable when visible" on public.board_fields
  for select using (public.can_see_board_field(id));

drop policy if exists "board field options readable when field visible" on public.board_field_options;
create policy "board field options readable when field visible" on public.board_field_options
  for select using (public.can_see_board_field(field_id));

-- Liste viewerow widza tylko wlasciciele (RPC i tak filtruje dla nie-ownerow).
drop policy if exists "board owners read field viewers" on public.board_field_viewers;
create policy "board owners read field viewers" on public.board_field_viewers
  for select using (
    exists (
      select 1
      from public.board_fields f
      where f.id = field_id
        and public.is_board_owner(f.board_id)
    )
  );

drop policy if exists "board topic field values readable when visible" on public.board_topic_field_values;
create policy "board topic field values readable when visible" on public.board_topic_field_values
  for select using (
    public.is_board_topic_member(topic_id)
    and public.can_see_board_field(field_id)
  );

grant select on public.board_fields to authenticated;
grant select on public.board_field_options to authenticated;
grant select on public.board_field_viewers to authenticated;
grant select on public.board_topic_field_values to authenticated;

grant all on public.board_fields to service_role;
grant all on public.board_field_options to service_role;
grant all on public.board_field_viewers to service_role;
grant all on public.board_topic_field_values to service_role;

-- ---------------------------------------------------------------------------
-- get_board_fields
-- ---------------------------------------------------------------------------
create or replace function public.get_board_fields(p_board_id uuid)
returns table (
  id uuid,
  board_id uuid,
  name text,
  kind text,
  visibility text,
  sort_order int,
  created_at timestamptz,
  updated_at timestamptz,
  options jsonb,
  viewer_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    f.board_id,
    f.name,
    f.kind,
    f.visibility,
    f.sort_order,
    f.created_at,
    f.updated_at,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'label', o.label,
        'sort_order', o.sort_order
      ) order by o.sort_order, o.created_at, o.id), '[]'::jsonb)
      from public.board_field_options o
      where o.field_id = f.id
    ) as options,
    case
      when public.is_board_owner(f.board_id) then
        coalesce((
          select array_agg(v.user_id order by v.user_id)
          from public.board_field_viewers v
          where v.field_id = f.id
        ), '{}'::uuid[])
      else '{}'::uuid[]
    end as viewer_ids
  from public.board_fields f
  where f.board_id = p_board_id
    and public.can_see_board_field(f.id)
  order by f.sort_order, f.created_at, f.id;
$$;

revoke all on function public.get_board_fields(uuid) from public;
revoke all on function public.get_board_fields(uuid) from anon;
grant execute on function public.get_board_fields(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- board_upsert_field (owner)
-- ---------------------------------------------------------------------------
create or replace function public.board_upsert_field(
  p_id uuid,
  p_board_id uuid,
  p_name text,
  p_kind text,
  p_visibility text,
  p_sort_order int,
  p_options jsonb,
  p_viewer_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := coalesce(p_kind, '');
  v_vis text := coalesce(p_visibility, 'all');
  v_pos int;
  v_count int;
  v_is_new boolean := false;
  opt jsonb;
  opt_id uuid;
  opt_label text;
  opt_pos int := 0;
  keep_ids uuid[] := '{}';
  vid uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_owner(p_board_id) then
    raise exception 'not a board owner';
  end if;
  if exists (
    select 1 from public.boards b where b.id = p_board_id and b.archived_at is not null
  ) then
    raise exception 'board is archived';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'invalid field name';
  end if;
  if v_kind not in ('single', 'multi', 'text') then
    raise exception 'invalid field kind';
  end if;
  if v_vis not in ('all', 'restricted') then
    raise exception 'invalid field visibility';
  end if;
  if v_vis = 'restricted' and v_kind <> 'text' then
    raise exception 'restricted fields must be text';
  end if;
  if v_kind = 'text' and p_options is not null and jsonb_typeof(p_options) = 'array'
     and jsonb_array_length(p_options) > 0 then
    raise exception 'text fields cannot have options';
  end if;

  if p_id is not null then
    select f.id into v_id
    from public.board_fields f
    where f.id = p_id and f.board_id = p_board_id;
    if v_id is not null then
      -- kind/visibility immutable after create (simpler values integrity)
      if exists (
        select 1 from public.board_fields f
        where f.id = v_id and (f.kind <> v_kind or f.visibility <> v_vis)
      ) then
        raise exception 'field kind or visibility immutable';
      end if;
    else
      if exists (select 1 from public.board_fields f where f.id = p_id) then
        raise exception 'field id already used';
      end if;
      select count(*) into v_count from public.board_fields where board_id = p_board_id;
      if v_count >= 20 then
        raise exception 'too many board fields';
      end if;
      v_id := p_id;
      v_is_new := true;
    end if;
  else
    select count(*) into v_count from public.board_fields where board_id = p_board_id;
    if v_count >= 20 then
      raise exception 'too many board fields';
    end if;
    v_id := gen_random_uuid();
    v_is_new := true;
  end if;

  if p_sort_order is null then
    if v_is_new then
      select coalesce(max(sort_order), 0) + 1 into v_pos
      from public.board_fields where board_id = p_board_id;
    else
      select sort_order into v_pos from public.board_fields where id = v_id;
    end if;
  else
    v_pos := p_sort_order;
  end if;

  insert into public.board_fields (id, board_id, name, kind, visibility, sort_order)
  values (v_id, p_board_id, v_name, v_kind, v_vis, v_pos)
  on conflict (id) do update set
    name = excluded.name,
    sort_order = excluded.sort_order,
    updated_at = now();

  -- Options (single/multi)
  if v_kind in ('single', 'multi') then
    if p_options is null or jsonb_typeof(p_options) <> 'array' then
      raise exception 'invalid field options';
    end if;
    if jsonb_array_length(p_options) < 1 or jsonb_array_length(p_options) > 20 then
      raise exception 'invalid field options';
    end if;

    for opt in select * from jsonb_array_elements(p_options)
    loop
      opt_pos := opt_pos + 1;
      opt_label := btrim(coalesce(opt->>'label', ''));
      if char_length(opt_label) < 1 or char_length(opt_label) > 80 then
        raise exception 'invalid option label';
      end if;
      if opt ? 'id' and nullif(opt->>'id', '') is not null then
        opt_id := (opt->>'id')::uuid;
        if not exists (
          select 1 from public.board_field_options o
          where o.id = opt_id and o.field_id = v_id
        ) then
          raise exception 'option not found';
        end if;
        update public.board_field_options
        set label = opt_label, sort_order = opt_pos
        where id = opt_id;
      else
        opt_id := gen_random_uuid();
        insert into public.board_field_options (id, field_id, label, sort_order)
        values (opt_id, v_id, opt_label, opt_pos);
      end if;
      keep_ids := array_append(keep_ids, opt_id);
    end loop;

    delete from public.board_field_options o
    where o.field_id = v_id
      and not (o.id = any (keep_ids));

    -- Strip removed options from stored values
    update public.board_topic_field_values v
    set option_ids = coalesce((
      select array_agg(x)
      from unnest(v.option_ids) as x
      where x = any (keep_ids)
    ), '{}'::uuid[]),
    updated_at = now()
    where v.field_id = v_id;
  else
    delete from public.board_field_options where field_id = v_id;
  end if;

  -- Viewers (restricted)
  delete from public.board_field_viewers where field_id = v_id;
  if v_vis = 'restricted' then
    if p_viewer_ids is not null then
      foreach vid in array p_viewer_ids
      loop
        if not exists (
          select 1 from public.board_members bm
          where bm.board_id = p_board_id and bm.user_id = vid
        ) then
          raise exception 'viewers must be board members';
        end if;
        insert into public.board_field_viewers (field_id, user_id)
        values (v_id, vid)
        on conflict do nothing;
      end loop;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.board_upsert_field(uuid, uuid, text, text, text, int, jsonb, uuid[]) from public;
revoke all on function public.board_upsert_field(uuid, uuid, text, text, text, int, jsonb, uuid[]) from anon;
grant execute on function public.board_upsert_field(uuid, uuid, text, text, text, int, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- board_delete_field (owner)
-- ---------------------------------------------------------------------------
create or replace function public.board_delete_field(p_field_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_board uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  select board_id into v_board from public.board_fields where id = p_field_id;
  if v_board is null then
    raise exception 'field not found';
  end if;
  if not public.is_board_owner(v_board) then
    raise exception 'not a board owner';
  end if;
  delete from public.board_fields where id = p_field_id;
end;
$$;

revoke all on function public.board_delete_field(uuid) from public;
revoke all on function public.board_delete_field(uuid) from anon;
grant execute on function public.board_delete_field(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- board_set_topic_field_value (member + can_see)
-- ---------------------------------------------------------------------------
create or replace function public.board_set_topic_field_value(
  p_topic_id uuid,
  p_field_id uuid,
  p_text_value text,
  p_option_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_board uuid;
  v_field_board uuid;
  v_kind text;
  v_text text;
  v_opts uuid[] := coalesce(p_option_ids, '{}'::uuid[]);
  v_empty boolean;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_topic_member(p_topic_id) then
    raise exception 'not a board member';
  end if;
  if not public.can_see_board_field(p_field_id) then
    raise exception 'not allowed';
  end if;

  select t.board_id into v_board from public.board_topics t where t.id = p_topic_id;
  select f.board_id, f.kind into v_field_board, v_kind
  from public.board_fields f where f.id = p_field_id;
  if v_board is null or v_field_board is null or v_board <> v_field_board then
    raise exception 'field not on topic board';
  end if;
  if exists (
    select 1 from public.boards b where b.id = v_board and b.archived_at is not null
  ) then
    raise exception 'board is archived';
  end if;

  v_text := nullif(btrim(coalesce(p_text_value, '')), '');
  if v_text is not null and char_length(v_text) > 200 then
    raise exception 'invalid field value';
  end if;

  -- Deduplicate option ids preserving order
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_opts
  from unnest(v_opts) as x;

  if v_kind = 'text' then
    if cardinality(v_opts) > 0 then
      raise exception 'invalid field value';
    end if;
    v_empty := v_text is null;
  elsif v_kind = 'single' then
    if cardinality(v_opts) > 1 then
      raise exception 'invalid field value';
    end if;
    if v_text is not null then
      raise exception 'invalid field value';
    end if;
    if cardinality(v_opts) = 1 and not exists (
      select 1 from public.board_field_options o
      where o.field_id = p_field_id and o.id = v_opts[1]
    ) then
      raise exception 'invalid field value';
    end if;
    v_empty := cardinality(v_opts) = 0;
  elsif v_kind = 'multi' then
    if v_text is not null then
      raise exception 'invalid field value';
    end if;
    if exists (
      select 1 from unnest(v_opts) as x(id)
      where not exists (
        select 1 from public.board_field_options o
        where o.field_id = p_field_id and o.id = x.id
      )
    ) then
      raise exception 'invalid field value';
    end if;
    v_empty := cardinality(v_opts) = 0;
  else
    raise exception 'invalid field kind';
  end if;

  if v_empty then
    delete from public.board_topic_field_values
    where topic_id = p_topic_id and field_id = p_field_id;
    return;
  end if;

  insert into public.board_topic_field_values (
    topic_id, field_id, text_value, option_ids, updated_at, updated_by
  ) values (
    p_topic_id, p_field_id,
    case when v_kind = 'text' then v_text else null end,
    case when v_kind = 'text' then '{}'::uuid[] else v_opts end,
    now(), caller
  )
  on conflict (topic_id, field_id) do update set
    text_value = excluded.text_value,
    option_ids = excluded.option_ids,
    updated_at = now(),
    updated_by = caller;
end;
$$;

revoke all on function public.board_set_topic_field_value(uuid, uuid, text, uuid[]) from public;
revoke all on function public.board_set_topic_field_value(uuid, uuid, text, uuid[]) from anon;
grant execute on function public.board_set_topic_field_value(uuid, uuid, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- get_board_topics: + field_values (tylko widoczne pola)
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
    t.code, t.sort_order,
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

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'board_fields',
    'board_field_options',
    'board_field_viewers',
    'board_topic_field_values'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
