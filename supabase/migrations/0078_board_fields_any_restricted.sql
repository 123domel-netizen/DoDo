-- Ukryte (visibility=restricted) dla kazdego rodzaju pola: single / multi / text.

alter table public.board_fields
  drop constraint if exists board_fields_restricted_text;

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
  if v_kind = 'text' and p_options is not null and jsonb_typeof(p_options) = 'array'
     and jsonb_array_length(p_options) > 0 then
    raise exception 'text fields cannot have options';
  end if;

  if p_id is not null then
    select f.id into v_id
    from public.board_fields f
    where f.id = p_id and f.board_id = p_board_id;
    if v_id is not null then
      -- kind immutable; visibility mozna zmieniac (wlacz/wylacz ukrycie)
      if exists (
        select 1 from public.board_fields f
        where f.id = v_id and f.kind <> v_kind
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
    visibility = excluded.visibility,
    sort_order = excluded.sort_order,
    updated_at = now();

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
