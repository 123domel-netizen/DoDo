-- Testy RLS / RPC pol niestandardowych tablicy (0077_board_fields.sql).
--
--   psql "$DATABASE_URL" -f supabase/tests/board_fields_rls.sql
--
-- Scenariusze:
--   * owner tworzy single/multi/text/ukryte,
--   * member widzi zwykle pola i ustawia wartosci,
--   * member bez listy nie widzi pola ukrytego (get_board_fields / field_values),
--   * viewer na liscie widzi i edytuje ukryte,
--   * nie-owner nie moze upsert/delete definicji.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'fields-owner@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'fields-member@example.invalid'),
  ('00000000-0000-0000-0000-0000000000f3', 'fields-viewer@example.invalid')
on conflict (id) do nothing;

insert into public.orgs (id, name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Fields test org');

insert into public.org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 'member'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f3', 'member');

alter table public.messages disable trigger messages_notify_push;

create or replace function public._fields_test_act_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $$;

grant execute on function public._fields_test_act_as(uuid) to authenticated;

set local role authenticated;
select public._fields_test_act_as('00000000-0000-0000-0000-0000000000f1');

do $$
declare
  v_single uuid := '00000000-0000-0000-0000-0000000000a1';
  v_multi uuid := '00000000-0000-0000-0000-0000000000a2';
  v_text uuid := '00000000-0000-0000-0000-0000000000a3';
  v_hidden uuid := '00000000-0000-0000-0000-0000000000a4';
  v_opt_a uuid;
  v_n int;
  v_fv jsonb;
begin
  perform public.board_create(
    '00000000-0000-0000-0000-0000000000c9',
    '00000000-0000-0000-0000-0000000000e1',
    'Pola test',
    array[
      '00000000-0000-0000-0000-0000000000f2',
      '00000000-0000-0000-0000-0000000000f3'
    ]::uuid[]
  );
  perform public.board_create_topic(
    '00000000-0000-0000-0000-0000000000d9',
    '00000000-0000-0000-0000-0000000000c9',
    'Temat z polami'
  );

  perform public.board_upsert_field(
    v_single,
    '00000000-0000-0000-0000-0000000000c9',
    'Status',
    'single',
    'all',
    null,
    '[{"label":"Nowe"},{"label":"W toku"}]'::jsonb,
    null
  );
  perform public.board_upsert_field(
    v_multi,
    '00000000-0000-0000-0000-0000000000c9',
    'Tagi',
    'multi',
    'all',
    null,
    '[{"label":"A"},{"label":"B"}]'::jsonb,
    null
  );
  perform public.board_upsert_field(
    v_text,
    '00000000-0000-0000-0000-0000000000c9',
    'Notatka',
    'text',
    'all',
    null,
    '[]'::jsonb,
    null
  );
  perform public.board_upsert_field(
    v_hidden,
    '00000000-0000-0000-0000-0000000000c9',
    'Haslo wewnetrzne',
    'text',
    'restricted',
    null,
    '[]'::jsonb,
    array['00000000-0000-0000-0000-0000000000f3']::uuid[]
  );

  select count(*) into v_n from public.get_board_fields('00000000-0000-0000-0000-0000000000c9');
  if v_n <> 4 then
    raise exception 'FAIL: owner should see 4 fields, got %', v_n;
  end if;

  select (o->>'id')::uuid into v_opt_a
  from public.get_board_fields('00000000-0000-0000-0000-0000000000c9') f,
       lateral jsonb_array_elements(f.options) o
  where f.id = v_single
  order by (o->>'sort_order')::int
  limit 1;

  perform public.board_set_topic_field_value(
    '00000000-0000-0000-0000-0000000000d9',
    v_single,
    null,
    array[v_opt_a]::uuid[]
  );
  perform public.board_set_topic_field_value(
    '00000000-0000-0000-0000-0000000000d9',
    v_hidden,
    'sekret',
    null
  );

  select field_values into v_fv
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c9')
  where id = '00000000-0000-0000-0000-0000000000d9';
  if v_fv -> v_hidden::text ->> 'text' is distinct from 'sekret' then
    raise exception 'FAIL: owner should see hidden value';
  end if;

  raise notice 'OK: owner CRUD + values';
end $$;

-- Member: widzi zwykle, nie widzi ukrytego
select public._fields_test_act_as('00000000-0000-0000-0000-0000000000f2');

do $$
declare
  v_n int;
  v_hidden uuid := '00000000-0000-0000-0000-0000000000a4';
  v_text uuid := '00000000-0000-0000-0000-0000000000a3';
  v_fv jsonb;
begin
  select count(*) into v_n from public.get_board_fields('00000000-0000-0000-0000-0000000000c9');
  if v_n <> 3 then
    raise exception 'FAIL: member should see 3 fields (no hidden), got %', v_n;
  end if;

  begin
    perform public.board_set_topic_field_value(
      '00000000-0000-0000-0000-0000000000d9',
      v_hidden,
      'wlamanie',
      null
    );
    raise exception 'FAIL: member set hidden value';
  exception when others then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;

  begin
    perform public.board_upsert_field(
      null,
      '00000000-0000-0000-0000-0000000000c9',
      'Hack',
      'text',
      'all',
      null,
      '[]'::jsonb,
      null
    );
    raise exception 'FAIL: member upsert field';
  exception when others then
    if sqlerrm not like '%not a board owner%' then raise; end if;
  end;

  perform public.board_set_topic_field_value(
    '00000000-0000-0000-0000-0000000000d9',
    v_text,
    'ok',
    null
  );

  select field_values into v_fv
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c9')
  where id = '00000000-0000-0000-0000-0000000000d9';
  if v_fv ? v_hidden::text then
    raise exception 'FAIL: member must not see hidden field_values key';
  end if;
  if v_fv -> v_text::text ->> 'text' is distinct from 'ok' then
    raise exception 'FAIL: member text value missing';
  end if;

  raise notice 'OK: member visibility + value';
end $$;

-- Viewer: widzi ukryte
select public._fields_test_act_as('00000000-0000-0000-0000-0000000000f3');

do $$
declare
  v_n int;
  v_hidden uuid := '00000000-0000-0000-0000-0000000000a4';
  v_fv jsonb;
begin
  select count(*) into v_n from public.get_board_fields('00000000-0000-0000-0000-0000000000c9');
  if v_n <> 4 then
    raise exception 'FAIL: viewer should see 4 fields, got %', v_n;
  end if;

  perform public.board_set_topic_field_value(
    '00000000-0000-0000-0000-0000000000d9',
    v_hidden,
    'z viewerem',
    null
  );

  select field_values into v_fv
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c9')
  where id = '00000000-0000-0000-0000-0000000000d9';
  if v_fv -> v_hidden::text ->> 'text' is distinct from 'z viewerem' then
    raise exception 'FAIL: viewer value not updated';
  end if;

  raise notice 'OK: viewer hidden access';
end $$;

rollback;
