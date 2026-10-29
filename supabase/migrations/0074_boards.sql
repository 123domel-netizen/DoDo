-- TABLICE (BOARDS): wspólny notes — tablica → tematy → komentarze.
--
-- Komentarze tematu to zwykłe `messages` w rozmowie o nowym rodzaju
-- `conversations.kind = 'board_topic'` (1 rozmowa na temat). Dzięki temu
-- działają: edycja, usuwanie, reakcje, załączniki, realtime, push i unread
-- (`conversation_members.last_read_at`).
--
-- ZASADY BEZPIECZEŃSTWA
--  * Rozmowy `board_topic` NIGDY nie trafiają na listę Czatu: wykluczone w
--    `get_conversation_overview()` i `search_all()` (źródło danych, nie UI).
--  * Dostęp do rozmowy `board_topic` wynika WYŁĄCZNIE z członkostwa w tablicy
--    (`board_members` + członkostwo w organizacji). Wiersze w
--    `conversation_members` są tam tylko nośnikiem stanu odczytu (last_read_at,
--    notify) i nie dają dostępu — dzięki temu osoba usunięta z tablicy/organizacji
--    traci dostęp mimo ewentualnych pozostałych wierszy.
--  * Helpery RLS są SECURITY DEFINER (omijają RLS tabel, więc brak rekurencji).
--  * `board_topic_items.item_id` celowo BEZ FK do `items`: zadanie powstaje przez
--    outbox Sync v3 i może jeszcze nie istnieć w bazie w chwili zapisu powiązania.

-- ---------------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------------
create table if not exists public.boards (
  id          uuid primary key,
  org_id      uuid not null references public.orgs (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  created_by  uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists boards_org_idx on public.boards (org_id);

create table if not exists public.board_members (
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index if not exists board_members_user_idx on public.board_members (user_id);

create table if not exists public.board_topics (
  id            uuid primary key,
  board_id      uuid not null references public.boards (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  description   text not null default '' check (char_length(description) <= 4000),
  created_by    uuid references auth.users (id) on delete set null,
  pinned_at     timestamptz,
  snoozed_until timestamptz,
  closed_at     timestamptz,
  closed_by     uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists board_topics_board_idx on public.board_topics (board_id);

create table if not exists public.board_topic_items (
  topic_id   uuid not null references public.board_topics (id) on delete cascade,
  item_id    uuid not null,
  item_type  text not null check (item_type in ('task', 'event')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (topic_id, item_id)
);

create index if not exists board_topic_items_item_idx on public.board_topic_items (item_id);

drop trigger if exists boards_touch on public.boards;
create trigger boards_touch before update on public.boards
  for each row execute function public.touch_updated_at();

-- Temat: niezmienne pola + automatyczne closed_by/updated_at.
create or replace function public.board_topics_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.board_id is distinct from old.board_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'board topic identity fields are immutable';
  end if;
  new.updated_at := now();
  if new.closed_at is distinct from old.closed_at then
    new.closed_by := case when new.closed_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

drop trigger if exists board_topics_guard_trg on public.board_topics;
create trigger board_topics_guard_trg before update on public.board_topics
  for each row execute function public.board_topics_guard();

-- ---------------------------------------------------------------------------
-- conversations: nowy rodzaj `board_topic` + kolumna board_topic_id
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists board_topic_id uuid
    references public.board_topics (id) on delete cascade;

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('channel', 'dm', 'item', 'board_topic'));

alter table public.conversations drop constraint if exists conversations_kind_shape;
alter table public.conversations
  add constraint conversations_kind_shape check (
    (kind = 'channel' and name is not null and dm_key is null and item_id is null and board_topic_id is null)
    or (kind = 'dm' and dm_key is not null and item_id is null and board_topic_id is null)
    or (kind = 'item' and item_id is not null and dm_key is null and board_topic_id is null)
    or (kind = 'board_topic' and board_topic_id is not null and dm_key is null and item_id is null)
  );

create unique index if not exists conversations_board_topic_idx
  on public.conversations (board_topic_id) where kind = 'board_topic';

-- ---------------------------------------------------------------------------
-- Helpery RLS (SECURITY DEFINER — przerywają rekurencję polityk)
-- ---------------------------------------------------------------------------

-- Członek tablicy = wiersz w board_members ORAZ aktualne członkostwo w organizacji.
create or replace function public.is_board_member(p_board_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    join public.boards b on b.id = bm.board_id
    join public.org_members om on om.org_id = b.org_id and om.user_id = bm.user_id
    where bm.board_id = p_board_id
      and bm.user_id = auth.uid()
  );
$$;

create or replace function public.is_board_owner(p_board_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    join public.boards b on b.id = bm.board_id
    join public.org_members om on om.org_id = b.org_id and om.user_id = bm.user_id
    where bm.board_id = p_board_id
      and bm.user_id = auth.uid()
      and bm.role = 'owner'
  );
$$;

create or replace function public.is_board_topic_member(p_topic_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.is_board_member(t.board_id)
    from public.board_topics t
    where t.id = p_topic_id
  ), false);
$$;

create or replace function public.is_board_topic_owner(p_topic_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.is_board_owner(t.board_id)
    from public.board_topics t
    where t.id = p_topic_id
  ), false);
$$;

revoke all on function public.is_board_member(uuid) from public;
revoke all on function public.is_board_owner(uuid) from public;
revoke all on function public.is_board_topic_member(uuid) from public;
revoke all on function public.is_board_topic_owner(uuid) from public;
grant execute on function public.is_board_member(uuid) to authenticated;
grant execute on function public.is_board_owner(uuid) to authenticated;
grant execute on function public.is_board_topic_member(uuid) to authenticated;
grant execute on function public.is_board_topic_owner(uuid) to authenticated;

-- Dla rozmów `board_topic` dostęp daje WYŁĄCZNIE członkostwo w tablicy.
-- Pozostałe rodzaje: bez zmian względem 0014. coalesce(…, false) — brak rozmowy
-- ma zwracać false (nie NULL), bo wywołujący używają `if not is_conversation_member(…)`.
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      case
        when c.kind = 'board_topic' then
          public.is_board_topic_member(c.board_topic_id)
        else (
          exists (
            select 1 from public.conversation_members cm
            where cm.conversation_id = c.id
              and cm.user_id = auth.uid()
              and cm.left_at is null
          )
          or (c.kind = 'item' and public.can_access_item(c.item_id))
        )
      end
    from public.conversations c
    where c.id = p_conversation_id
  ), false);
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.board_topics enable row level security;
alter table public.board_topic_items enable row level security;

-- INSERT/DELETE na boards, board_members, board_topics wyłącznie przez RPC.
drop policy if exists "board members read boards" on public.boards;
create policy "board members read boards" on public.boards
  for select using (public.is_board_member(id));

drop policy if exists "board members read members" on public.board_members;
create policy "board members read members" on public.board_members
  for select using (public.is_board_member(board_id));

drop policy if exists "board members read topics" on public.board_topics;
create policy "board members read topics" on public.board_topics
  for select using (public.is_board_member(board_id));

-- Wspólny notes: każdy członek może przypiąć / odłożyć / zamknąć / zmienić tytuł.
drop policy if exists "board members update topics" on public.board_topics;
create policy "board members update topics" on public.board_topics
  for update using (public.is_board_member(board_id))
  with check (public.is_board_member(board_id));

drop policy if exists "board members read topic items" on public.board_topic_items;
create policy "board members read topic items" on public.board_topic_items
  for select using (public.is_board_topic_member(topic_id));

drop policy if exists "board members link items" on public.board_topic_items;
create policy "board members link items" on public.board_topic_items
  for insert with check (
    created_by = auth.uid()
    and public.is_board_topic_member(topic_id)
  );

drop policy if exists "creator or owner unlinks items" on public.board_topic_items;
create policy "creator or owner unlinks items" on public.board_topic_items
  for delete using (
    public.is_board_topic_member(topic_id)
    and (created_by = auth.uid() or public.is_board_topic_owner(topic_id))
  );

grant select on public.boards to authenticated;
grant select on public.board_members to authenticated;
grant select on public.board_topics to authenticated;
-- Tylko pola edytowalne przez członków (reszta zmienia się wyłącznie przez RPC/trigger).
grant update (title, description, pinned_at, snoozed_until, closed_at)
  on public.board_topics to authenticated;
grant select, insert, delete on public.board_topic_items to authenticated;

grant all on public.boards to service_role;
grant all on public.board_members to service_role;
grant all on public.board_topics to service_role;
grant all on public.board_topic_items to service_role;

-- ---------------------------------------------------------------------------
-- Trigger: zmiany w board_members → członkostwo rozmów tematów (stan odczytu/push)
-- ---------------------------------------------------------------------------
create or replace function public.sync_board_conversation_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id, role)
    select c.id, new.user_id, 'member'
    from public.conversations c
    join public.board_topics t on t.id = c.board_topic_id
    where c.kind = 'board_topic' and t.board_id = new.board_id
    on conflict (conversation_id, user_id) do update set left_at = null;
  elsif tg_op = 'DELETE' then
    update public.conversation_members cm
    set left_at = now()
    from public.conversations c
    join public.board_topics t on t.id = c.board_topic_id
    where cm.conversation_id = c.id
      and c.kind = 'board_topic'
      and t.board_id = old.board_id
      and cm.user_id = old.user_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists board_members_sync_conv on public.board_members;
create trigger board_members_sync_conv
  after insert or delete on public.board_members
  for each row execute function public.sync_board_conversation_members();

-- ---------------------------------------------------------------------------
-- RPC: tablice
-- ---------------------------------------------------------------------------

-- Utwórz tablicę (idempotentnie po p_id) wraz z uczestnikami. Twórca = owner.
create or replace function public.board_create(
  p_id uuid,
  p_org_id uuid,
  p_name text,
  p_member_ids uuid[] default '{}'
)
returns public.boards
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  rec public.boards;
  v_name text := btrim(coalesce(p_name, ''));
  v_ids uuid[];
  m uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if p_id is null then
    raise exception 'board id required';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'not an org member';
  end if;

  select * into rec from public.boards where id = p_id;
  if found then
    if rec.created_by is distinct from caller or rec.org_id <> p_org_id then
      raise exception 'board id already used';
    end if;
    return rec;
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid board name';
  end if;

  select array_agg(distinct u) into v_ids
  from unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), caller)) as u
  where u is not null;

  if array_length(v_ids, 1) > 50 then
    raise exception 'too many board members';
  end if;

  if exists (
    select 1 from unnest(v_ids) as x(uid)
    where not exists (
      select 1 from public.org_members om
      where om.org_id = p_org_id and om.user_id = x.uid
    )
  ) then
    raise exception 'members must belong to the organization';
  end if;

  insert into public.boards (id, org_id, name, created_by)
  values (p_id, p_org_id, v_name, caller)
  returning * into rec;

  foreach m in array v_ids loop
    insert into public.board_members (board_id, user_id, role, added_by)
    values (p_id, m, case when m = caller then 'owner' else 'member' end, caller);
  end loop;

  return rec;
end;
$$;

create or replace function public.board_rename(p_board_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_owner(p_board_id) then
    raise exception 'not a board owner';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid board name';
  end if;
  update public.boards set name = v_name where id = p_board_id;
end;
$$;

-- Archiwizacja tablicy blokuje też komentowanie (messages INSERT wymaga
-- conversations.archived_at is null).
create or replace function public.board_set_archived(p_board_id uuid, p_archived boolean)
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
  set archived_at = case when p_archived then now() else null end
  where id = p_board_id;
  update public.conversations c
  set archived_at = case when p_archived then now() else null end
  from public.board_topics t
  where c.board_topic_id = t.id
    and c.kind = 'board_topic'
    and t.board_id = p_board_id;
end;
$$;

create or replace function public.board_add_members(p_board_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_org uuid;
  v_count int;
  m uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_owner(p_board_id) then
    raise exception 'not a board owner';
  end if;
  select org_id into v_org from public.boards where id = p_board_id;

  select count(*) into v_count from public.board_members where board_id = p_board_id;
  if v_count + coalesce(array_length(p_user_ids, 1), 0) > 50 then
    raise exception 'too many board members';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_user_ids, '{}'::uuid[])) as x(uid)
    where x.uid is null
       or not exists (
         select 1 from public.org_members om
         where om.org_id = v_org and om.user_id = x.uid
       )
  ) then
    raise exception 'members must belong to the organization';
  end if;

  foreach m in array coalesce(p_user_ids, '{}'::uuid[]) loop
    insert into public.board_members (board_id, user_id, role, added_by)
    values (p_board_id, m, 'member', caller)
    on conflict (board_id, user_id) do nothing;
  end loop;
end;
$$;

-- Właściciel usuwa kogokolwiek; członek może opuścić tablicę sam.
-- Ostatniego właściciela nie można usunąć (tablica nie może zostać bez właściciela).
create or replace function public.board_remove_member(p_board_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_role text;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not (public.is_board_owner(p_board_id) or (caller = p_user_id and public.is_board_member(p_board_id))) then
    raise exception 'not allowed';
  end if;

  select role into v_role
  from public.board_members
  where board_id = p_board_id and user_id = p_user_id;
  if v_role is null then
    return;
  end if;

  if v_role = 'owner' and (
    select count(*) from public.board_members
    where board_id = p_board_id and role = 'owner'
  ) <= 1 then
    raise exception 'cannot remove the last owner';
  end if;

  delete from public.board_members
  where board_id = p_board_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: tematy
-- ---------------------------------------------------------------------------

-- Utwórz temat + jego rozmowę + członków rozmowy. Idempotentne po p_id.
-- Zwraca conversation_id (komentarze).
create or replace function public.board_create_topic(
  p_id uuid,
  p_board_id uuid,
  p_title text
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
  t public.board_topics;
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
    select id into v_conv from public.conversations
    where board_topic_id = p_id and kind = 'board_topic';
    return v_conv;
  end if;

  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'invalid topic title';
  end if;

  insert into public.board_topics (id, board_id, title, created_by)
  values (p_id, p_board_id, v_title, caller);

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

-- Usuń temat BEZ komentarzy (autor tematu lub właściciel tablicy).
-- Temat z historią zamyka się, nie usuwa.
create or replace function public.board_delete_topic(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  t public.board_topics;
  v_conv uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  select * into t from public.board_topics where id = p_topic_id;
  if not found then
    return;
  end if;
  if not public.is_board_member(t.board_id) then
    raise exception 'not a board member';
  end if;
  if not (t.created_by = caller or public.is_board_owner(t.board_id)) then
    raise exception 'not allowed';
  end if;

  select id into v_conv from public.conversations
  where board_topic_id = p_topic_id and kind = 'board_topic';
  if v_conv is not null and exists (
    select 1 from public.messages m
    where m.conversation_id = v_conv
      and m.deleted_at is null
      and m.kind <> 'system'
  ) then
    raise exception 'topic has comments';
  end if;

  delete from public.board_topics where id = p_topic_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC odczytu (SECURITY INVOKER — RLS naturalnie ogranicza wyniki do tablic
-- użytkownika; brak własnych uprawnień funkcji).
-- ---------------------------------------------------------------------------

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
  members jsonb
)
language sql stable
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
    ) as members
  from public.boards b
  where b.org_id = p_org_id
    and b.archived_at is null
  order by b.created_at;
$$;

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
  conversation_id uuid,
  last_activity_at timestamptz,
  comment_count bigint,
  unread_count bigint,
  last_comment jsonb,
  items jsonb
)
language sql stable
as $$
  select
    t.id, t.board_id, t.title, t.description, t.created_by,
    t.pinned_at, t.snoozed_until, t.closed_at, t.closed_by,
    t.created_at, t.updated_at,
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
      where i.topic_id = t.id
    ) as items
  from public.board_topics t
  join public.conversations c on c.board_topic_id = t.id and c.kind = 'board_topic'
  left join public.conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid()
  where t.board_id = p_board_id;
$$;

-- ---------------------------------------------------------------------------
-- Uprawnienia RPC
-- ---------------------------------------------------------------------------
revoke all on function public.board_create(uuid, uuid, text, uuid[]) from public;
revoke all on function public.board_rename(uuid, text) from public;
revoke all on function public.board_set_archived(uuid, boolean) from public;
revoke all on function public.board_add_members(uuid, uuid[]) from public;
revoke all on function public.board_remove_member(uuid, uuid) from public;
revoke all on function public.board_create_topic(uuid, uuid, text) from public;
revoke all on function public.board_delete_topic(uuid) from public;
revoke all on function public.get_my_boards(uuid) from public;
revoke all on function public.get_board_topics(uuid) from public;

-- Supabase domyślnie nadaje EXECUTE roli anon nowym funkcjom (por. 0072) —
-- odbieramy jawnie, żeby przeszło supabase/tests/security_definer_grants.sql.
revoke all on function public.is_board_member(uuid) from anon;
revoke all on function public.is_board_owner(uuid) from anon;
revoke all on function public.is_board_topic_member(uuid) from anon;
revoke all on function public.is_board_topic_owner(uuid) from anon;
revoke all on function public.is_conversation_member(uuid) from anon;
revoke all on function public.board_create(uuid, uuid, text, uuid[]) from anon;
revoke all on function public.board_rename(uuid, text) from anon;
revoke all on function public.board_set_archived(uuid, boolean) from anon;
revoke all on function public.board_add_members(uuid, uuid[]) from anon;
revoke all on function public.board_remove_member(uuid, uuid) from anon;
revoke all on function public.board_create_topic(uuid, uuid, text) from anon;
revoke all on function public.board_delete_topic(uuid) from anon;
revoke all on function public.get_my_boards(uuid) from anon;
revoke all on function public.get_board_topics(uuid) from anon;
revoke all on function public.get_conversation_overview() from anon;
revoke all on function public.search_all(text, int) from anon;

grant execute on function public.board_create(uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.board_rename(uuid, text) to authenticated;
grant execute on function public.board_set_archived(uuid, boolean) to authenticated;
grant execute on function public.board_add_members(uuid, uuid[]) to authenticated;
grant execute on function public.board_remove_member(uuid, uuid) to authenticated;
grant execute on function public.board_create_topic(uuid, uuid, text) to authenticated;
grant execute on function public.board_delete_topic(uuid) to authenticated;
grant execute on function public.get_my_boards(uuid) to authenticated;
grant execute on function public.get_board_topics(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Czat: rozmowy tablic NIE trafiają na listę (wykluczenie u źródła).
-- Treść funkcji jak w 0056 + warunek `c.kind <> 'board_topic'`.
-- ---------------------------------------------------------------------------
create or replace function public.get_conversation_overview()
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
           coalesce(cm.archived_at, c.channel_archived_at) as r_archived_at
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id
     and cm.user_id = auth.uid()
     and cm.left_at is null
    where c.archived_at is null
      and c.kind <> 'board_topic'
    union all
    select c.*, null::timestamptz, 'all'::text, 'member'::text,
           null::timestamptz, null::timestamptz, false, c.channel_archived_at
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
        select
          m.id,
          m.kind,
          m.body,
          m.author_user_id,
          m.created_at,
          m.deleted_at,
          m.thread_root_id,
          case
            when m.thread_root_id is null then null
            else (
              select coalesce(
                nullif(trim(r.thread_title), ''),
                nullif(left(trim(regexp_replace(r.body, '\s+', ' ', 'g')), 80), ''),
                'Wątek'
              )
              from public.messages r
              where r.id = m.thread_root_id
            )
          end as thread_title
        from public.messages m
        where m.conversation_id = my.id
        order by m.created_at desc, m.id desc
        limit 1
      ) x
    ) as last_message,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', cm.user_id,
        'role', cm.role,
        'displayName', coalesce(p.display_name, ''),
        'avatarUrl', p.avatar_url,
        'lastReadAt', cm.last_read_at
      )), '[]'::jsonb)
      from public.conversation_members cm
      left join public.profiles p on p.user_id = cm.user_id
      where cm.conversation_id = my.id and cm.left_at is null
    ) as members
  from my
  order by coalesce(my.last_message_at, my.created_at) desc;
$$;

revoke all on function public.get_conversation_overview() from public;
grant execute on function public.get_conversation_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- Wyszukiwarka: bez wiadomości i plików z rozmów tablic (jak 0018 + wykluczenie).
-- SECURITY INVOKER — RLS dodatkowo ogranicza wyniki do dostępnych rozmów.
-- ---------------------------------------------------------------------------
create or replace function public.search_all(p_query text, p_limit int default 20)
returns table (
  result_type text,
  id uuid,
  conversation_id uuid,
  item_id uuid,
  title text,
  snippet text,
  created_at timestamptz,
  rank real
)
language sql stable
as $$
  with q as (
    select
      websearch_to_tsquery('simple', public.f_unaccent(coalesce(p_query, ''))) as tsq,
      public.f_unaccent(coalesce(p_query, '')) as raw
  )
  (
    select
      'message'::text,
      m.id,
      m.conversation_id,
      null::uuid,
      null::text,
      left(m.body, 200),
      m.created_at,
      ts_rank(m.search_tsv, q.tsq)::real
    from public.messages m
    cross join q
    where m.deleted_at is null
      and m.kind in ('text', 'poll')
      and not exists (
        select 1 from public.conversations bc
        where bc.id = m.conversation_id and bc.kind = 'board_topic'
      )
      and (
        m.search_tsv @@ q.tsq
        or public.f_unaccent(m.body) ilike '%' || q.raw || '%'
      )
    order by m.created_at desc
    limit p_limit
  )
  union all
  (
    select
      'item'::text,
      i.id,
      null::uuid,
      i.id,
      i.title,
      left(i.description, 200),
      i.created_at,
      ts_rank(i.search_tsv, q.tsq)::real
    from public.items i
    cross join q
    where i.deleted_at is null
      and (
        i.search_tsv @@ q.tsq
        or public.f_unaccent(i.title) ilike '%' || q.raw || '%'
      )
    order by i.created_at desc
    limit p_limit
  )
  union all
  (
    select
      'file'::text,
      ma.id,
      m.conversation_id,
      null::uuid,
      ma.file_name,
      null::text,
      ma.created_at,
      0::real
    from public.message_attachments ma
    join public.messages m on m.id = ma.message_id
    cross join q
    where m.deleted_at is null
      and not exists (
        select 1 from public.conversations bc
        where bc.id = m.conversation_id and bc.kind = 'board_topic'
      )
      and public.f_unaccent(ma.file_name) ilike '%' || q.raw || '%'
    order by ma.created_at desc
    limit p_limit
  );
$$;

revoke all on function public.search_all(text, int) from public;
grant execute on function public.search_all(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['boards', 'board_members', 'board_topics', 'board_topic_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
