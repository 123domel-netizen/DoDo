-- KOMUNIKATOR (CHAT5): pakiet funkcji — wzmianki, reakcje, ankiety, historia
-- edycji, decyzje, ulubione/wyciszenia/nieprzeczytane, obecność online,
-- payload wiadomości (GIF / głosówki / podgląd linków).

-- ---------------------------------------------------------------------------
-- messages: payload (poll/gif/voice/linkPreview), wzmianki, nowe kindy
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists mentions uuid[] not null default '{}'::uuid[];

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'system', 'poll', 'gif', 'voice'));

-- Filtr „wiadomości, w których mnie oznaczono".
create index if not exists messages_mentions_idx
  on public.messages using gin (mentions);

-- ---------------------------------------------------------------------------
-- message_reactions (👍 ❤️ 😂 👀 ✅ 🎉)
-- ---------------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions visible to members" on public.message_reactions;
create policy "reactions visible to members" on public.message_reactions
  for select using (
    public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
  );

drop policy if exists "member reacts as self" on public.message_reactions;
create policy "member reacts as self" on public.message_reactions
  for insert with check (
    user_id = auth.uid()
    and public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.deleted_at is null
    )
  );

drop policy if exists "own reaction removable" on public.message_reactions;
create policy "own reaction removable" on public.message_reactions
  for delete using (user_id = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

-- ---------------------------------------------------------------------------
-- poll_votes (ankiety: kind='poll', opcje w messages.payload.poll.options)
-- Jeden głos na użytkownika (zmiana = upsert), option_id z payloadu.
-- ---------------------------------------------------------------------------
create table if not exists public.poll_votes (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  option_id  text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.poll_votes enable row level security;

drop policy if exists "votes visible to members" on public.poll_votes;
create policy "votes visible to members" on public.poll_votes
  for select using (
    public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
  );

drop policy if exists "member votes as self" on public.poll_votes;
create policy "member votes as self" on public.poll_votes
  for insert with check (
    user_id = auth.uid()
    and public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.kind = 'poll' and m.deleted_at is null
    )
  );

drop policy if exists "own vote changeable" on public.poll_votes;
create policy "own vote changeable" on public.poll_votes
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own vote removable" on public.poll_votes;
create policy "own vote removable" on public.poll_votes
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.poll_votes to authenticated;
grant all on public.poll_votes to service_role;

-- ---------------------------------------------------------------------------
-- message_revisions — historia edycji (zapis triggerem, tylko odczyt)
-- ---------------------------------------------------------------------------
create table if not exists public.message_revisions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  body       text not null,
  edited_at  timestamptz not null default now(),
  edited_by  uuid
);

create index if not exists message_revisions_message_idx
  on public.message_revisions (message_id, edited_at);

alter table public.message_revisions enable row level security;

drop policy if exists "revisions visible to members" on public.message_revisions;
create policy "revisions visible to members" on public.message_revisions
  for select using (
    public.is_conversation_member(
      (select m.conversation_id from public.messages m where m.id = message_id)
    )
  );

grant select on public.message_revisions to authenticated;
grant all on public.message_revisions to service_role;

-- Poprzednia wersja treści trafia do rewizji przy każdej zmianie body.
create or replace function public.messages_record_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.body is distinct from new.body and old.deleted_at is null then
    insert into public.message_revisions (message_id, body, edited_at, edited_by)
    values (old.id, old.body, coalesce(old.edited_at, old.created_at), old.author_user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists messages_record_revision on public.messages;
create trigger messages_record_revision before update on public.messages
  for each row execute function public.messages_record_revision();

-- ---------------------------------------------------------------------------
-- decisions — rejestr ustaleń per rozmowa (konwersja: wiadomość → decyzja)
-- ---------------------------------------------------------------------------
create table if not exists public.decisions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id      uuid references public.messages (id) on delete set null,
  body            text not null,
  created_by      uuid not null references auth.users (id) on delete cascade,
  decided_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists decisions_conversation_idx
  on public.decisions (conversation_id, decided_at desc);

alter table public.decisions enable row level security;

drop policy if exists "decisions visible to members" on public.decisions;
create policy "decisions visible to members" on public.decisions
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists "member records decision" on public.decisions;
create policy "member records decision" on public.decisions
  for insert with check (
    created_by = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "author removes decision" on public.decisions;
create policy "author removes decision" on public.decisions
  for delete using (created_by = auth.uid());

grant select, insert, delete on public.decisions to authenticated;
grant all on public.decisions to service_role;

-- ---------------------------------------------------------------------------
-- conversation_members: ulubione / wyciszenie czasowe / oznacz nieprzeczytane
-- ---------------------------------------------------------------------------
alter table public.conversation_members
  add column if not exists pinned_at timestamptz,
  add column if not exists muted_until timestamptz,
  add column if not exists marked_unread boolean not null default false;

-- ---------------------------------------------------------------------------
-- profiles: obecność online (heartbeat klienta; online = < 5 min temu)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- RPC: prefs własnego członkostwa (upsert — działa też dla dostępu pochodnego
-- z wątków itemowych, wzorzec z mark_conversation_read)
-- ---------------------------------------------------------------------------
create or replace function public.set_conversation_pinned(
  p_conversation_id uuid,
  p_pinned boolean
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
  insert into public.conversation_members (conversation_id, user_id, pinned_at)
  values (p_conversation_id, caller, case when p_pinned then now() end)
  on conflict (conversation_id, user_id) do update
    set pinned_at = case when p_pinned then now() end,
        left_at = null;
end;
$$;

-- p_muted_until: null = wyłącz wyciszenie; 'infinity' = na zawsze.
create or replace function public.set_conversation_mute(
  p_conversation_id uuid,
  p_muted_until timestamptz
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
  insert into public.conversation_members (conversation_id, user_id, muted_until)
  values (p_conversation_id, caller, p_muted_until)
  on conflict (conversation_id, user_id) do update
    set muted_until = excluded.muted_until,
        left_at = null;
end;
$$;

create or replace function public.mark_conversation_unread(p_conversation_id uuid)
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
  insert into public.conversation_members (conversation_id, user_id, marked_unread)
  values (p_conversation_id, caller, true)
  on conflict (conversation_id, user_id) do update
    set marked_unread = true,
        left_at = null;
end;
$$;

-- Otwarcie rozmowy czyści też flagę „oznaczone jako nieprzeczytane".
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
        marked_unread = false,
        left_at = null;
end;
$$;

grant execute on function public.set_conversation_pinned(uuid, boolean) to authenticated;
grant execute on function public.set_conversation_mute(uuid, timestamptz) to authenticated;
grant execute on function public.mark_conversation_unread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_conversation_overview: + pinned_at / muted_until / marked_unread
-- (zmiana sygnatury zwrotu wymaga DROP)
-- ---------------------------------------------------------------------------
drop function if exists public.get_conversation_overview();

create function public.get_conversation_overview()
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
  my_pinned_at timestamptz,
  my_muted_until timestamptz,
  my_marked_unread boolean,
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
           cm.marked_unread as r_marked_unread
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id
     and cm.user_id = auth.uid()
     and cm.left_at is null
    where c.archived_at is null
    union all
    select c.*, null::timestamptz, 'all'::text, 'member'::text,
           null::timestamptz, null::timestamptz, false
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
    my.r_pinned_at, my.r_muted_until, my.r_marked_unread,
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

grant execute on function public.get_conversation_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- Wyszukiwarka: treści ankiet też wyszukiwalne
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
      and public.f_unaccent(ma.file_name) ilike '%' || q.raw || '%'
    order by ma.created_at desc
    limit p_limit
  );
$$;

-- ---------------------------------------------------------------------------
-- Realtime: reakcje i głosy w ankietach
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'poll_votes'
  ) then
    alter publication supabase_realtime add table public.poll_votes;
  end if;
end $$;
