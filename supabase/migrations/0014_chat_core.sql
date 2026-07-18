-- KOMUNIKATOR (CHAT1): rdzeń — rozmowy, członkowie, wiadomości, linki do itemów.
-- Projekt: docs/KOMUNIKATOR-ARCHITEKTURA-2026-07-17.md (D1–D7).
-- Jedna encja conversations obsługuje kanały, DM-y i wątki kontekstowe itemów.

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('channel', 'dm', 'item')),
  name            text,
  description     text,
  is_public       boolean not null default false,
  -- DM: posortowane user_id złączone ':' — deterministyczny klucz dedupe.
  dm_key          text,
  -- Wątek kontekstowy zadania/wydarzenia.
  item_id         uuid references public.items (id) on delete cascade,
  created_by      uuid not null references auth.users (id) on delete cascade,
  last_message_at timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint conversations_kind_shape check (
    (kind = 'channel' and name is not null and dm_key is null and item_id is null)
    or (kind = 'dm' and dm_key is not null and item_id is null)
    or (kind = 'item' and item_id is not null and dm_key is null)
  )
);

create unique index if not exists conversations_dm_key_idx
  on public.conversations (dm_key) where kind = 'dm';
create unique index if not exists conversations_item_idx
  on public.conversations (item_id) where kind = 'item';
create index if not exists conversations_last_msg_idx
  on public.conversations (last_message_at desc nulls last);

drop trigger if exists conversations_touch on public.conversations;
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- conversation_members (last_read_at = model nieprzeczytanych, D6)
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'admin', 'member')),
  last_read_at    timestamptz not null default now(),
  notify          text not null default 'all' check (notify in ('all', 'mentions', 'none')),
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id) where left_at is null;

-- ---------------------------------------------------------------------------
-- messages (id nadaje KLIENT — idempotentny retry outboxa)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id                  uuid primary key,
  conversation_id     uuid not null references public.conversations (id) on delete cascade,
  author_user_id      uuid not null references auth.users (id) on delete cascade,
  kind                text not null default 'text' check (kind in ('text', 'system')),
  body                text not null default '',
  thread_root_id      uuid references public.messages (id) on delete cascade,
  reply_to_message_id uuid references public.messages (id) on delete set null,
  created_at          timestamptz not null default now(),
  edited_at           timestamptz,
  deleted_at          timestamptz,
  deleted_by          uuid
);

-- Feed + paginacja keyset (najważniejszy indeks czatu).
create index if not exists messages_feed_idx
  on public.messages (conversation_id, created_at desc, id);
create index if not exists messages_thread_idx
  on public.messages (thread_root_id, created_at) where thread_root_id is not null;
-- Licznik nieprzeczytanych.
create index if not exists messages_unread_idx
  on public.messages (conversation_id, created_at)
  where deleted_at is null and thread_root_id is null;

-- ---------------------------------------------------------------------------
-- message_item_links (wiadomość → zadanie/wydarzenie, D7)
-- ---------------------------------------------------------------------------
create table if not exists public.message_item_links (
  message_id uuid not null references public.messages (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  kind       text not null default 'created_from'
    check (kind in ('created_from', 'reference')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, item_id)
);

create index if not exists message_item_links_item_idx
  on public.message_item_links (item_id);

-- ---------------------------------------------------------------------------
-- Funkcje pomocnicze (security definer — przerywają rekurencję RLS)
-- ---------------------------------------------------------------------------

-- Dostęp do itemu: właściciel lub aktywny uczestnik SHARE (także po e-mailu).
create or replace function public.can_access_item(p_item_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.items i
    where i.id = p_item_id
      and i.deleted_at is null
      and (
        i.user_id = auth.uid()
        or exists (
          select 1 from public.item_participants ip
          where ip.item_id = i.id
            and ip.status <> 'rejected'
            and (
              ip.participant_user_id = auth.uid()
              or lower(ip.participant_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
            )
        )
      )
  );
$$;

-- Członkostwo rozmowy: wiersz w conversation_members LUB (dla wątków itemowych)
-- dostęp pochodny od itemu — uczestnik SHARE widzi dyskusję bez materializacji.
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = auth.uid()
      and cm.left_at is null
  )
  or exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.kind = 'item'
      and public.can_access_item(c.item_id)
  );
$$;

create or replace function public.is_conversation_admin(p_conversation_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = auth.uid()
      and cm.left_at is null
      and cm.role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_item_links enable row level security;

-- conversations: INSERT/DELETE wyłącznie przez RPC (security definer).
drop policy if exists "member or public channel read" on public.conversations;
create policy "member or public channel read" on public.conversations
  for select using (
    public.is_conversation_member(id)
    or (kind = 'channel' and is_public)
  );

drop policy if exists "admin updates conversation" on public.conversations;
create policy "admin updates conversation" on public.conversations
  for update using (public.is_conversation_admin(id))
  with check (public.is_conversation_admin(id));

-- conversation_members: INSERT przez RPC; własny wiersz edytowalny
-- (last_read_at, notify, left_at).
drop policy if exists "members visible to members" on public.conversation_members;
create policy "members visible to members" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists "own membership update" on public.conversation_members;
create policy "own membership update" on public.conversation_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- messages
drop policy if exists "member reads messages" on public.messages;
create policy "member reads messages" on public.messages
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists "member sends own messages" on public.messages;
create policy "member sends own messages" on public.messages
  for insert with check (
    author_user_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.archived_at is null
    )
    -- wątek: root musi istnieć w tej samej rozmowie i sam nie być odpowiedzią.
    -- WAŻNE: kwalifikuj messages.thread_root_id — inaczej Postgres bierze
    -- r.thread_root_id z aliasu wewnętrznego i EXISTS nigdy nie przechodzi.
    and (
      messages.thread_root_id is null
      or exists (
        select 1 from public.messages r
        where r.id = messages.thread_root_id
          and r.conversation_id = messages.conversation_id
          and r.thread_root_id is null
      )
    )
  );

drop policy if exists "author edits own message" on public.messages;
create policy "author edits own message" on public.messages
  for update using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

-- message_item_links
drop policy if exists "link visible with message or item" on public.message_item_links;
create policy "link visible with message or item" on public.message_item_links
  for select using (
    public.can_access_item(item_id)
    or public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
  );

drop policy if exists "member links own" on public.message_item_links;
create policy "member links own" on public.message_item_links
  for insert with check (
    created_by = auth.uid()
    and public.can_access_item(item_id)
    and public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
  );

drop policy if exists "creator unlinks" on public.message_item_links;
create policy "creator unlinks" on public.message_item_links
  for delete using (created_by = auth.uid());

grant select, update on public.conversations to authenticated;
grant select, update on public.conversation_members to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select, insert, delete on public.message_item_links to authenticated;
grant all on public.conversations to service_role;
grant all on public.conversation_members to service_role;
grant all on public.messages to service_role;
grant all on public.message_item_links to service_role;

-- ---------------------------------------------------------------------------
-- Trigger: nowa wiadomość podbija conversations.last_message_at
-- (security definer — autor zwykle nie ma prawa UPDATE na conversations).
-- ---------------------------------------------------------------------------
create or replace function public.messages_bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = greatest(coalesce(last_message_at, 'epoch'::timestamptz), new.created_at)
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_conv on public.messages;
create trigger messages_bump_conv after insert on public.messages
  for each row execute function public.messages_bump_conversation();

-- ---------------------------------------------------------------------------
-- Trigger: zmiany uczestników itemu → synchronizacja członkostwa wątku itemowego
-- ---------------------------------------------------------------------------
create or replace function public.sync_item_conversation_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  target_item uuid := coalesce(new.item_id, old.item_id);
  item_owner uuid;
begin
  select id into conv_id
  from public.conversations
  where item_id = target_item and kind = 'item';
  if conv_id is null then
    return coalesce(new, old);
  end if;

  select user_id into item_owner from public.items where id = target_item;

  if tg_op in ('INSERT', 'UPDATE')
     and new.participant_user_id is not null then
    if new.status <> 'rejected' then
      insert into public.conversation_members (conversation_id, user_id)
      values (conv_id, new.participant_user_id)
      on conflict (conversation_id, user_id) do update set left_at = null;
    else
      update public.conversation_members set left_at = now()
      where conversation_id = conv_id
        and user_id = new.participant_user_id
        and user_id is distinct from item_owner;
    end if;
  end if;

  if tg_op = 'DELETE' and old.participant_user_id is not null then
    update public.conversation_members set left_at = now()
    where conversation_id = conv_id
      and user_id = old.participant_user_id
      and user_id is distinct from item_owner;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists item_participants_sync_conv on public.item_participants;
create trigger item_participants_sync_conv
  after insert or update or delete on public.item_participants
  for each row execute function public.sync_item_conversation_members();

-- ---------------------------------------------------------------------------
-- RPC: utwórz kanał lub DM (atomowo, z członkami; DM dedupe po dm_key)
-- ---------------------------------------------------------------------------
create or replace function public.create_conversation(
  p_kind text,
  p_name text default null,
  p_is_public boolean default false,
  p_member_ids uuid[] default '{}'
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  member_ids uuid[];
  v_dm_key text;
  rec public.conversations;
  m uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('channel', 'dm') then
    raise exception 'invalid kind';
  end if;

  select array_agg(distinct u order by u) into member_ids
  from unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), caller)) as u
  where u is not null;

  if p_kind = 'dm' then
    if coalesce(array_length(member_ids, 1), 0) < 2 then
      raise exception 'dm requires at least 2 members';
    end if;
    if array_length(member_ids, 1) > 8 then
      raise exception 'dm too large — create a channel';
    end if;
    v_dm_key := array_to_string(member_ids, ':');

    select * into rec
    from public.conversations
    where kind = 'dm' and dm_key = v_dm_key;

    if not found then
      begin
        insert into public.conversations (kind, dm_key, created_by)
        values ('dm', v_dm_key, caller)
        returning * into rec;
      exception when unique_violation then
        -- wyścig dwóch klientów — zwróć istniejący
        select * into rec
        from public.conversations
        where kind = 'dm' and dm_key = v_dm_key;
      end;
    end if;
  else
    if nullif(trim(p_name), '') is null then
      raise exception 'channel requires a name';
    end if;
    insert into public.conversations (kind, name, is_public, created_by)
    values ('channel', trim(p_name), coalesce(p_is_public, false), caller)
    returning * into rec;
  end if;

  foreach m in array member_ids loop
    insert into public.conversation_members (conversation_id, user_id, role)
    values (rec.id, m, case when m = caller then 'owner' else 'member' end)
    on conflict (conversation_id, user_id) do update set left_at = null;
  end loop;

  return rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: wątek itemu — utwórz leniwie + zmaterializuj członkostwa
-- ---------------------------------------------------------------------------
create or replace function public.ensure_item_conversation(p_item_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  rec public.conversations;
  item_owner uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.can_access_item(p_item_id) then
    raise exception 'no access to item';
  end if;

  select * into rec
  from public.conversations
  where item_id = p_item_id and kind = 'item';

  if not found then
    begin
      insert into public.conversations (kind, item_id, created_by)
      values ('item', p_item_id, caller)
      returning * into rec;
    exception when unique_violation then
      select * into rec
      from public.conversations
      where item_id = p_item_id and kind = 'item';
    end;
  end if;

  select user_id into item_owner from public.items where id = p_item_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  select rec.id, u.uid,
         case when u.uid = item_owner then 'owner' else 'member' end
  from (
    select item_owner as uid
    union
    select ip.participant_user_id
    from public.item_participants ip
    where ip.item_id = p_item_id
      and ip.status <> 'rejected'
      and ip.participant_user_id is not null
  ) u
  where u.uid is not null
  on conflict (conversation_id, user_id) do update set left_at = null;

  return rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: dołącz do publicznego kanału / zaproś / opuść / oznacz przeczytane
-- ---------------------------------------------------------------------------
create or replace function public.join_channel(p_conversation_id uuid)
returns public.conversation_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  rec public.conversation_members;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.kind = 'channel'
      and c.is_public
      and c.archived_at is null
  ) then
    raise exception 'not a public channel';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (p_conversation_id, caller)
  on conflict (conversation_id, user_id) do update set left_at = null
  returning * into rec;
  return rec;
end;
$$;

create or replace function public.invite_to_conversation(
  p_conversation_id uuid,
  p_user_id uuid
)
returns public.conversation_members
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.conversation_members;
begin
  if not public.is_conversation_admin(p_conversation_id) then
    raise exception 'not an admin';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.kind = 'channel'
  ) then
    raise exception 'invites only for channels';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (p_conversation_id, p_user_id)
  on conflict (conversation_id, user_id) do update set left_at = null
  returning * into rec;
  return rec;
end;
$$;

create or replace function public.leave_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_members
  set left_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
end;
$$;

-- Upsert własnego członkostwa (materializuje wiersz dla dostępu pochodnego)
-- + last_read_at tylko w przód.
create or replace function public.mark_conversation_read(
  p_conversation_id uuid,
  p_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a member';
  end if;

  insert into public.conversation_members (conversation_id, user_id, last_read_at)
  values (p_conversation_id, caller, coalesce(p_at, now()))
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(
          public.conversation_members.last_read_at,
          excluded.last_read_at
        ),
        left_at = null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: przegląd rozmów (lista + unread + ostatnia wiadomość + członkowie)
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
  my_last_read_at timestamptz,
  my_notify text,
  my_role text,
  unread_count bigint,
  last_message jsonb,
  members jsonb
)
language sql stable
security definer
set search_path = public
as $$
  with my as (
    select c.*, cm.last_read_at as r_last_read, cm.notify as r_notify, cm.role as r_role
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id
     and cm.user_id = auth.uid()
     and cm.left_at is null
    where c.archived_at is null
    union all
    -- wątki itemowe z dostępem pochodnym (jeszcze bez wiersza członkostwa)
    select c.*, null::timestamptz, 'all'::text, 'member'::text
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
    my.r_last_read, my.r_notify, my.r_role,
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
        select m.id, m.kind, m.body, m.author_user_id, m.created_at, m.deleted_at
        from public.messages m
        where m.conversation_id = my.id
          and m.thread_root_id is null
        order by m.created_at desc, m.id desc
        limit 1
      ) x
    ) as last_message,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', cm.user_id,
        'role', cm.role,
        'displayName', coalesce(p.display_name, ''),
        'avatarUrl', p.avatar_url
      )), '[]'::jsonb)
      from public.conversation_members cm
      left join public.profiles p on p.user_id = cm.user_id
      where cm.conversation_id = my.id and cm.left_at is null
    ) as members
  from my
  order by coalesce(my.last_message_at, my.created_at) desc;
$$;

grant execute on function public.create_conversation(text, text, boolean, uuid[]) to authenticated;
grant execute on function public.ensure_item_conversation(uuid) to authenticated;
grant execute on function public.join_channel(uuid) to authenticated;
grant execute on function public.invite_to_conversation(uuid, uuid) to authenticated;
grant execute on function public.leave_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;
grant execute on function public.get_conversation_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (idempotentnie)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end $$;
