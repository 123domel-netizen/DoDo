-- Testy RLS / RPC modułu Tablice (migracja 0074_boards.sql).
--
-- Użycie (psql na bazie z zastosowanymi migracjami; NIE używać na produkcji —
-- skrypt tworzy dane testowe, ale całość jest wycofywana na końcu przez ROLLBACK):
--   psql "$DATABASE_URL" -f supabase/tests/boards_rls.sql
--
-- Scenariusze:
--   * osoba spoza tablicy (także z tej samej organizacji) nie widzi tablicy,
--     tematów ani komentarzy i nie może komentować,
--   * tylko właściciel zarządza uczestnikami,
--   * rozmowy tablic nie pojawiają się w get_conversation_overview() ani search_all(),
--   * usunięty z tablicy / z organizacji traci dostęp (mimo wiersza conversation_members),
--   * unread jest per użytkownik, odczyt zeruje tylko własny licznik,
--   * brak rekurencji RLS (42P17) — każde zapytanie poniżej przechodzi przez polityki.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (superuser)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'boards-u1@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'boards-u2@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'boards-u3@example.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 'boards-u4@example.invalid')
on conflict (id) do nothing;

insert into public.orgs (id, name) values
  ('00000000-0000-0000-0000-0000000000b1', 'Boards test org 1'),
  ('00000000-0000-0000-0000-0000000000b2', 'Boards test org 2');

insert into public.org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'member'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'member'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a4', 'admin');

-- Trigger pushu (0017) woła pg_net z adresem funkcji; w bazie testowej to placeholder,
-- więc INSERT do messages by się wywrócił. Wyłączenie jest cofane przez ROLLBACK.
alter table public.messages disable trigger messages_notify_push;

create or replace function public._boards_test_act_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $$;

grant execute on function public._boards_test_act_as(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Właściciel tworzy tablicę i tematy
-- ---------------------------------------------------------------------------
set local role authenticated;
select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a1');

do $$
begin
  perform public.board_create(
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000b1',
    'Jacek + Dominik',
    array['00000000-0000-0000-0000-0000000000a2']::uuid[]
  );
  -- idempotencja po p_id
  perform public.board_create(
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000b1',
    'Jacek + Dominik',
    array['00000000-0000-0000-0000-0000000000a2']::uuid[]
  );
  if (select count(*) from public.board_members
      where board_id = '00000000-0000-0000-0000-0000000000c1') <> 2 then
    raise exception 'FAIL: board should have exactly 2 members';
  end if;

  -- uczestnik spoza organizacji jest odrzucony
  begin
    perform public.board_create(
      '00000000-0000-0000-0000-0000000000c2',
      '00000000-0000-0000-0000-0000000000b1',
      'Zła tablica',
      array['00000000-0000-0000-0000-0000000000a4']::uuid[]
    );
    raise exception 'FAIL: non-org member accepted';
  exception when others then
    if sqlerrm not like '%members must belong%' then raise; end if;
  end;

  perform public.board_create_topic(
    '00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-0000000000c1',
    'Plan miejscowy'
  );
  perform public.board_create_topic(
    '00000000-0000-0000-0000-0000000000d2',
    '00000000-0000-0000-0000-0000000000c1',
    'Refinansowanie'
  );
  -- idempotencja tematu
  perform public.board_create_topic(
    '00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-0000000000c1',
    'Plan miejscowy'
  );

  if (select count(*) from public.board_topics
      where board_id = '00000000-0000-0000-0000-0000000000c1') <> 2 then
    raise exception 'FAIL: expected 2 topics';
  end if;
  raise notice 'OK: tablica i tematy utworzone';
end $$;

-- komentarz właściciela (searchable słowo: "kowalewo")
do $$
declare
  v_conv uuid;
begin
  select conversation_id into v_conv
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
  where id = '00000000-0000-0000-0000-0000000000d1';

  -- now() jest stałe w całej transakcji testu, więc daty komentarzy przesuwamy
  -- jawnie (w produkcji komentarz zawsze powstaje po dołączeniu do rozmowy).
  insert into public.messages (id, conversation_id, author_user_id, body, created_at)
  values ('00000000-0000-0000-0000-0000000000e1', v_conv,
          '00000000-0000-0000-0000-0000000000a1', 'Sprawdzić działkę kowalewo',
          now() + interval '1 second');

  -- autor nie ma unread od własnego komentarza
  if (select unread_count from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
      where id = '00000000-0000-0000-0000-0000000000d1') <> 0 then
    raise exception 'FAIL: author has unread from own comment';
  end if;
  raise notice 'OK: komentarz autora nie generuje unread autorowi';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Uczestnik (u2): widzi, unread tylko u niego, odczyt zeruje tylko jego licznik
-- ---------------------------------------------------------------------------
select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a2');

do $$
declare
  v_conv uuid;
begin
  if (select count(*) from public.boards) <> 1 then
    raise exception 'FAIL: member should see the board';
  end if;
  if (select count(*) from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')) <> 2 then
    raise exception 'FAIL: member should see both topics';
  end if;

  select conversation_id into v_conv
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
  where id = '00000000-0000-0000-0000-0000000000d1';

  if (select count(*) from public.messages where conversation_id = v_conv) <> 1 then
    raise exception 'FAIL: member should read the comment';
  end if;
  if (select unread_count from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
      where id = '00000000-0000-0000-0000-0000000000d1') <> 1 then
    raise exception 'FAIL: member should have 1 unread';
  end if;
  if (select unread_count from public.get_my_boards('00000000-0000-0000-0000-0000000000b1')) <> 1 then
    raise exception 'FAIL: board-level unread should be 1';
  end if;

  perform public.mark_conversation_read(v_conv, now() + interval '1 second');
  if (select unread_count from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
      where id = '00000000-0000-0000-0000-0000000000d1') <> 0 then
    raise exception 'FAIL: read should clear unread for the reader';
  end if;

  -- u2 komentuje → u1 ma unread
  insert into public.messages (id, conversation_id, author_user_id, body, created_at)
  values ('00000000-0000-0000-0000-0000000000e2', v_conv,
          '00000000-0000-0000-0000-0000000000a2', 'Odpowiedź Dominika',
          now() + interval '2 seconds');

  -- członek może zamknąć / przypiąć / odłożyć (wspólny notes)
  update public.board_topics
  set pinned_at = now(), snoozed_until = now() + interval '1 day', closed_at = now()
  where id = '00000000-0000-0000-0000-0000000000d1';
  if (select closed_by from public.board_topics
      where id = '00000000-0000-0000-0000-0000000000d1') <> '00000000-0000-0000-0000-0000000000a2' then
    raise exception 'FAIL: closed_by should be set by trigger';
  end if;

  -- nie jest właścicielem: nie zarządza uczestnikami
  begin
    perform public.board_add_members(
      '00000000-0000-0000-0000-0000000000c1',
      array['00000000-0000-0000-0000-0000000000a3']::uuid[]
    );
    raise exception 'FAIL: non-owner added members';
  exception when others then
    if sqlerrm not like '%not a board owner%' then raise; end if;
  end;

  -- temat z komentarzami nie może być usunięty
  begin
    perform public.board_delete_topic('00000000-0000-0000-0000-0000000000d1');
    raise exception 'FAIL: topic with comments deleted';
  exception when others then
    if sqlerrm not like '%not allowed%' and sqlerrm not like '%topic has comments%' then raise; end if;
  end;

  -- pola niezmienne
  begin
    update public.board_topics
    set board_id = '00000000-0000-0000-0000-0000000000c9'
    where id = '00000000-0000-0000-0000-0000000000d1';
    raise exception 'FAIL: board_id changed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise notice 'OK: uczestnik — odczyt, unread per użytkownik, akcje tematu';
end $$;

select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a1');
do $$
begin
  if (select unread_count from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
      where id = '00000000-0000-0000-0000-0000000000d1') <> 1 then
    raise exception 'FAIL: owner should have 1 unread (member comment); read by member must not clear it';
  end if;
  raise notice 'OK: odczyt innego uczestnika nie zeruje unread właściciela';
end $$;

-- ---------------------------------------------------------------------------
-- 2b. Kod tematu, kolejność, martwe powiązania (0075)
-- ---------------------------------------------------------------------------
select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a1');
do $$
declare
  v_pos_d1 int;
  v_pos_d2 int;
  v_items jsonb;
begin
  -- kod ręczny
  update public.board_topics
  set code = 'N01'
  where id = '00000000-0000-0000-0000-0000000000d1';
  if (select code from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
      where id = '00000000-0000-0000-0000-0000000000d1') is distinct from 'N01' then
    raise exception 'FAIL: topic code not returned by get_board_topics';
  end if;

  update public.board_topics
  set code = '  '
  where id = '00000000-0000-0000-0000-0000000000d1';
  if (select code from public.board_topics
      where id = '00000000-0000-0000-0000-0000000000d1') is not null then
    raise exception 'FAIL: blank code should become null';
  end if;

  update public.board_topics set code = 'N01'
  where id = '00000000-0000-0000-0000-0000000000d1';
  begin
    update public.board_topics set code = 'n01'
    where id = '00000000-0000-0000-0000-0000000000d2';
    raise exception 'FAIL: duplicate code (case-insensitive) accepted';
  exception when unique_violation then
    null;
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    -- unique_violation lub ekwiwalent z indeksu
    if sqlstate not in ('23505') then raise; end if;
  end;

  -- kolejnosc po create: d1=1, d2=2
  select sort_order into v_pos_d1 from public.board_topics
  where id = '00000000-0000-0000-0000-0000000000d1';
  select sort_order into v_pos_d2 from public.board_topics
  where id = '00000000-0000-0000-0000-0000000000d2';
  if v_pos_d1 <> 1 or v_pos_d2 <> 2 then
    raise exception 'FAIL: expected sort_order 1,2 got %, %', v_pos_d1, v_pos_d2;
  end if;

  perform public.board_reorder_topics(
    '00000000-0000-0000-0000-0000000000c1',
    array[
      '00000000-0000-0000-0000-0000000000d2',
      '00000000-0000-0000-0000-0000000000d1'
    ]::uuid[]
  );
  if (select sort_order from public.board_topics
      where id = '00000000-0000-0000-0000-0000000000d2') <> 1
     or (select sort_order from public.board_topics
         where id = '00000000-0000-0000-0000-0000000000d1') <> 2 then
    raise exception 'FAIL: reorder did not swap sort_order';
  end if;

  begin
    perform public.board_reorder_topics(
      '00000000-0000-0000-0000-0000000000c1',
      array['00000000-0000-0000-0000-0000000000d1']::uuid[]
    );
    raise exception 'FAIL: incomplete reorder accepted';
  exception when others then
    if sqlerrm not like '%invalid topic order%' then raise; end if;
  end;

  -- powiązanie → soft-delete → brak w get_board_topics + wyczyszczony wiersz
  insert into public.items (
    id, user_id, type, title, start_at, end_at
  ) values (
    '00000000-0000-0000-0000-0000000000f1',
    '00000000-0000-0000-0000-0000000000a1',
    'task', 'Zadanie z tematu',
    now(), now() + interval '1 hour'
  );
  insert into public.board_topic_items (topic_id, item_id, item_type, created_by)
  values (
    '00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-0000000000f1',
    'task',
    '00000000-0000-0000-0000-0000000000a1'
  );

  select items into v_items
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
  where id = '00000000-0000-0000-0000-0000000000d1';
  if jsonb_array_length(v_items) <> 1 then
    raise exception 'FAIL: expected 1 linked item before delete';
  end if;

  update public.items
  set deleted_at = now(), deleted_by = '00000000-0000-0000-0000-0000000000a1'
  where id = '00000000-0000-0000-0000-0000000000f1';

  if exists (
    select 1 from public.board_topic_items
    where item_id = '00000000-0000-0000-0000-0000000000f1'
  ) then
    raise exception 'FAIL: soft-delete should clean board_topic_items';
  end if;

  select items into v_items
  from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')
  where id = '00000000-0000-0000-0000-0000000000d1';
  if jsonb_array_length(coalesce(v_items, '[]'::jsonb)) <> 0 then
    raise exception 'FAIL: deleted item still in get_board_topics';
  end if;

  raise notice 'OK: kod, reorder, cleanup usuniętych powiązań';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Wykluczenie z Czatu: overview i search_all
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.get_conversation_overview() where kind = 'board_topic') then
    raise exception 'FAIL: board_topic leaked into get_conversation_overview';
  end if;
  if exists (select 1 from public.search_all('kowalewo') where result_type in ('message', 'file')) then
    raise exception 'FAIL: board comment leaked into search_all';
  end if;
  raise notice 'OK: tablice poza Czatem (overview + search_all)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Osoby spoza tablicy (u3 — ta sama org, u4 — inna org)
-- ---------------------------------------------------------------------------
do $$
declare
  v_uid uuid;
  v_conv uuid;
begin
  select id into v_conv from public.conversations
  where board_topic_id = '00000000-0000-0000-0000-0000000000d1';
  if v_conv is null then
    -- właściciel widzi rozmowę (kontrola testu)
    raise exception 'FAIL: owner cannot see topic conversation';
  end if;

  foreach v_uid in array array[
    '00000000-0000-0000-0000-0000000000a3',
    '00000000-0000-0000-0000-0000000000a4'
  ]::uuid[] loop
    perform public._boards_test_act_as(v_uid);
    if (select count(*) from public.boards) <> 0 then
      raise exception 'FAIL: outsider % sees boards', v_uid;
    end if;
    if (select count(*) from public.board_members) <> 0 then
      raise exception 'FAIL: outsider % sees board_members', v_uid;
    end if;
    if (select count(*) from public.board_topics) <> 0 then
      raise exception 'FAIL: outsider % sees topics', v_uid;
    end if;
    if (select count(*) from public.messages where conversation_id = v_conv) <> 0 then
      raise exception 'FAIL: outsider % reads comments', v_uid;
    end if;
    if (select count(*) from public.conversations where id = v_conv) <> 0 then
      raise exception 'FAIL: outsider % reads topic conversation', v_uid;
    end if;
    if (select count(*) from public.get_board_topics('00000000-0000-0000-0000-0000000000c1')) <> 0 then
      raise exception 'FAIL: outsider % gets topics via RPC', v_uid;
    end if;

    begin
      insert into public.messages (id, conversation_id, author_user_id, body)
      values (gen_random_uuid(), v_conv, v_uid, 'włamanie');
      raise exception 'FAIL: outsider % commented', v_uid;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;

    begin
      perform public.board_create_topic(gen_random_uuid(),
        '00000000-0000-0000-0000-0000000000c1', 'włamanie');
      raise exception 'FAIL: outsider % created topic', v_uid;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;

    begin
      perform public.board_add_members('00000000-0000-0000-0000-0000000000c1',
        array[v_uid]::uuid[]);
      raise exception 'FAIL: outsider % added himself', v_uid;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
    end;

    update public.board_topics set title = 'zmieniony'
    where id = '00000000-0000-0000-0000-0000000000d1';
    -- brak widoczności => 0 wierszy zmienionych; sprawdzane niżej jako właściciel
  end loop;
  raise notice 'OK: osoby spoza tablicy bez dostępu';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Utrata członkostwa: usunięcie z tablicy oraz z organizacji
-- ---------------------------------------------------------------------------
select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a1');
do $$
begin
  if (select title from public.board_topics
      where id = '00000000-0000-0000-0000-0000000000d1') <> 'Plan miejscowy' then
    raise exception 'FAIL: outsider changed topic title';
  end if;

  -- ostatniego właściciela nie można usunąć
  begin
    perform public.board_remove_member('00000000-0000-0000-0000-0000000000c1',
      '00000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL: last owner removed';
  exception when others then
    if sqlerrm not like '%last owner%' then raise; end if;
  end;

  perform public.board_remove_member('00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000a2');
  raise notice 'OK: właściciel usunął uczestnika';
end $$;

select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a2');
do $$
declare
  v_conv uuid;
begin
  select id into v_conv from public.conversations
  where board_topic_id = '00000000-0000-0000-0000-0000000000d1';
  if v_conv is not null then
    raise exception 'FAIL: removed member still sees topic conversation';
  end if;
  if (select count(*) from public.messages) <> 0 then
    raise exception 'FAIL: removed member still reads comments';
  end if;
  raise notice 'OK: usunięty z tablicy traci dostęp';
end $$;

-- Powrót do tablicy, a potem usunięcie z organizacji (wiersz board_members zostaje).
reset role;
insert into public.board_members (board_id, user_id, role, added_by)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2',
        'member', '00000000-0000-0000-0000-0000000000a1');
delete from public.org_members
where org_id = '00000000-0000-0000-0000-0000000000b1'
  and user_id = '00000000-0000-0000-0000-0000000000a2';

set local role authenticated;
select public._boards_test_act_as('00000000-0000-0000-0000-0000000000a2');
do $$
begin
  if (select count(*) from public.boards) <> 0
     or (select count(*) from public.board_topics) <> 0
     or (select count(*) from public.messages) <> 0 then
    raise exception 'FAIL: ex-org member keeps access to board data';
  end if;
  raise notice 'OK: usunięty z organizacji traci dostęp mimo wiersza board_members';
end $$;

reset role;
rollback;

\echo 'boards_rls.sql: wszystkie scenariusze OK (zmiany wycofane)'
