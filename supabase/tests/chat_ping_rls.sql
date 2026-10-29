-- RLS / RPC tests for chat PING (migration 0076_chat_pings.sql).
--
-- Usage (NOT on production — fixtures rolled back):
--   psql "$DATABASE_URL" -f supabase/tests/chat_ping_rls.sql

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ping-u1@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 'ping-u2@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e3', 'ping-u3@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e4', 'ping-u4@example.invalid')
on conflict (id) do nothing;

insert into public.orgs (id, name) values
  ('00000000-0000-0000-0000-0000000000f1', 'Ping test org');

insert into public.org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e3', 'member');

-- DM between e1 and e2
insert into public.conversations (id, kind, dm_key, created_by)
values (
  '00000000-0000-0000-0000-0000000000a1',
  'dm',
  '00000000-0000-0000-0000-0000000000e1:00000000-0000-0000-0000-0000000000e2',
  '00000000-0000-0000-0000-0000000000e1'
);

insert into public.conversation_members (conversation_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', 'member');

-- Group channel with e1, e2, e3
insert into public.conversations (id, kind, name, is_public, created_by)
values (
  '00000000-0000-0000-0000-0000000000a2',
  'channel',
  'ping-channel',
  false,
  '00000000-0000-0000-0000-0000000000e1'
);

insert into public.conversation_members (conversation_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e3', 'member');

-- Board with e1 (owner) + e2; e3 is org member but NOT board member
create or replace function public._ping_test_act_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $$;
grant execute on function public._ping_test_act_as(uuid) to authenticated;

set local role authenticated;
select public._ping_test_act_as('00000000-0000-0000-0000-0000000000e1');

do $$
begin
  perform public.board_create(
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000f1',
    'Ping board',
    array['00000000-0000-0000-0000-0000000000e2']::uuid[]
  );
  perform public.board_create_topic(
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000b1',
    'Ping topic'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 1. Happy path DM ping
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n from public.send_ping(
    '00000000-0000-0000-0000-0000000000a1',
    array['00000000-0000-0000-0000-0000000000e2']::uuid[]
  );
  if n <> 1 then raise exception 'FAIL: expected 1 ping row'; end if;
  raise notice 'OK: DM ping';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Reject self / non-member / empty
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.send_ping(
      '00000000-0000-0000-0000-0000000000a1',
      array['00000000-0000-0000-0000-0000000000e1']::uuid[]
    );
    raise exception 'FAIL: self ping accepted';
  exception when others then
    if sqlerrm not like '%ping no targets%' then raise; end if;
  end;

  begin
    perform public.send_ping(
      '00000000-0000-0000-0000-0000000000a1',
      array['00000000-0000-0000-0000-0000000000e3']::uuid[]
    );
    raise exception 'FAIL: non-member ping accepted';
  exception when others then
    if sqlerrm not like '%ping invalid target%' then raise; end if;
  end;

  begin
    perform public.send_ping(
      '00000000-0000-0000-0000-0000000000a1',
      '{}'::uuid[]
    );
    raise exception 'FAIL: empty targets accepted';
  exception when others then
    if sqlerrm not like '%ping no targets%' then raise; end if;
  end;
  raise notice 'OK: invalid targets rejected';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Rate limit (same pair within 60s)
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.send_ping(
      '00000000-0000-0000-0000-0000000000a1',
      array['00000000-0000-0000-0000-0000000000e2']::uuid[]
    );
    raise exception 'FAIL: rate limit not enforced';
  exception when others then
    if sqlerrm not like '%ping rate limited%' then raise; end if;
  end;
  raise notice 'OK: rate limited';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Direct insert blocked by RLS
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.chat_pings (conversation_id, sender_user_id, target_user_id)
    values (
      '00000000-0000-0000-0000-0000000000a2',
      '00000000-0000-0000-0000-0000000000e1',
      '00000000-0000-0000-0000-0000000000e3'
    );
    raise exception 'FAIL: direct insert allowed';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%policy%' then
      raise;
    end if;
  end;
  raise notice 'OK: direct insert blocked';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Recipient can read; third party cannot
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  ping_id uuid;
begin
  select id into ping_id
  from public.chat_pings
  where conversation_id = '00000000-0000-0000-0000-0000000000a1'
  limit 1;

  perform public._ping_test_act_as('00000000-0000-0000-0000-0000000000e2');
  select count(*) into n from public.chat_pings where id = ping_id;
  if n <> 1 then raise exception 'FAIL: target cannot read own ping'; end if;

  perform public._ping_test_act_as('00000000-0000-0000-0000-0000000000e3');
  select count(*) into n from public.chat_pings where id = ping_id;
  if n <> 0 then raise exception 'FAIL: third party saw ping'; end if;

  perform public._ping_test_act_as('00000000-0000-0000-0000-0000000000e1');
  raise notice 'OK: RLS select parties only';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Multi-target channel ping (after clearing rate-limit window via backdate)
-- ---------------------------------------------------------------------------
-- Backdate as superuser (authenticated has no UPDATE on chat_pings).
reset role;
update public.chat_pings
set created_at = now() - interval '2 minutes'
where sender_user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select public._ping_test_act_as('00000000-0000-0000-0000-0000000000e1');

do $$
declare
  n int;
begin
  select count(*) into n from public.send_ping(
    '00000000-0000-0000-0000-0000000000a2',
    array[
      '00000000-0000-0000-0000-0000000000e2',
      '00000000-0000-0000-0000-0000000000e3'
    ]::uuid[]
  );
  if n <> 2 then raise exception 'FAIL: expected 2 channel ping rows, got %', n; end if;
  raise notice 'OK: multi-target channel ping';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Board topic: reject non-board org member; accept board member
-- ---------------------------------------------------------------------------
reset role;
update public.chat_pings
set created_at = now() - interval '2 minutes'
where sender_user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select public._ping_test_act_as('00000000-0000-0000-0000-0000000000e1');

do $$
declare
  v_conv uuid;
  n int;
begin
  select c.id into v_conv
  from public.conversations c
  where c.board_topic_id = '00000000-0000-0000-0000-0000000000c1'
    and c.kind = 'board_topic';

  begin
    perform public.send_ping(
      v_conv,
      array['00000000-0000-0000-0000-0000000000e3']::uuid[]
    );
    raise exception 'FAIL: non-board member accepted on topic';
  exception when others then
    if sqlerrm not like '%ping invalid target%' then raise; end if;
  end;

  select count(*) into n from public.send_ping(
    v_conv,
    array['00000000-0000-0000-0000-0000000000e2']::uuid[]
  );
  if n <> 1 then raise exception 'FAIL: board topic ping failed'; end if;
  raise notice 'OK: board topic ping';
end $$;

rollback;
