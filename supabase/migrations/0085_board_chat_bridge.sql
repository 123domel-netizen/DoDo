-- Most tablica → kanał czatu: opcjonalny kanał docelowy + delikatne
-- lustrzane komentarze tematów jako odpowiedzi w wątku (adnotacje w feedzie).

-- ---------------------------------------------------------------------------
-- Kolumny na tablicy
-- ---------------------------------------------------------------------------
alter table public.boards
  add column if not exists chat_bridge_enabled boolean not null default false;

alter table public.boards
  add column if not exists chat_bridge_conversation_id uuid
    references public.conversations (id) on delete set null;

comment on column public.boards.chat_bridge_enabled is
  'Gdy true, komentarze w tematach są lustrzane do wskazanego kanału czatu.';
comment on column public.boards.chat_bridge_conversation_id is
  'Kanał (conversations.kind = channel) docelowy dla mostu tablica→czat.';

create index if not exists boards_chat_bridge_conv_idx
  on public.boards (chat_bridge_conversation_id)
  where chat_bridge_enabled and chat_bridge_conversation_id is not null;

-- ---------------------------------------------------------------------------
-- Mapowanie temat → root wątku w kanale (jeden root na temat)
-- ---------------------------------------------------------------------------
create table if not exists public.board_topic_channel_roots (
  topic_id          uuid primary key references public.board_topics (id) on delete cascade,
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  root_message_id   uuid not null references public.messages (id) on delete cascade,
  created_at        timestamptz not null default now()
);

create index if not exists board_topic_channel_roots_conv_idx
  on public.board_topic_channel_roots (conversation_id);

alter table public.board_topic_channel_roots enable row level security;

-- Odczyt dla członków tablicy (temat → board). Zapis tylko przez trigger/RPC (definer).
drop policy if exists "board topic channel roots readable" on public.board_topic_channel_roots;
create policy "board topic channel roots readable"
  on public.board_topic_channel_roots for select
  using (
    exists (
      select 1
      from public.board_topics t
      where t.id = topic_id
        and public.is_board_member(t.board_id)
    )
  );

grant select on public.board_topic_channel_roots to authenticated;
grant all on public.board_topic_channel_roots to service_role;

-- ---------------------------------------------------------------------------
-- RPC: ustaw most (właściciel tablicy)
-- ---------------------------------------------------------------------------
create or replace function public.board_set_chat_bridge(
  p_board_id uuid,
  p_enabled boolean,
  p_conversation_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_conv public.conversations;
  v_prev uuid;
  v_next uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_board_owner(p_board_id) then
    raise exception 'not a board owner';
  end if;

  select chat_bridge_conversation_id into v_prev
  from public.boards where id = p_board_id;

  if v_enabled then
    if p_conversation_id is null then
      raise exception 'chat bridge requires channel';
    end if;
    select * into v_conv from public.conversations where id = p_conversation_id;
    if not found then
      raise exception 'channel not found';
    end if;
    if v_conv.kind is distinct from 'channel' then
      raise exception 'chat bridge target must be channel';
    end if;
    if v_conv.archived_at is not null then
      raise exception 'channel is archived';
    end if;
    if not public.is_conversation_member(p_conversation_id) then
      raise exception 'not a channel member';
    end if;
    v_next := p_conversation_id;
  else
    v_next := null;
  end if;

  update public.boards
  set
    chat_bridge_enabled = v_enabled,
    chat_bridge_conversation_id = v_next
  where id = p_board_id;

  -- Zmiana / wyłączenie kanału → stare rooty nie mają sensu.
  if (not v_enabled) or (v_prev is distinct from v_next) then
    delete from public.board_topic_channel_roots r
    using public.board_topics t
    where r.topic_id = t.id
      and t.board_id = p_board_id;
  end if;
end;
$$;

revoke all on function public.board_set_chat_bridge(uuid, boolean, uuid) from public;
revoke all on function public.board_set_chat_bridge(uuid, boolean, uuid) from anon;
grant execute on function public.board_set_chat_bridge(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_boards: + chat_bridge_*
-- ---------------------------------------------------------------------------
drop function if exists public.get_my_boards(uuid);

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
  members jsonb,
  locality_enabled boolean,
  default_topic_view jsonb,
  default_topic_view_rev integer,
  chat_bridge_enabled boolean,
  chat_bridge_conversation_id uuid
)
language sql
stable
set search_path = public
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
    ) as members,
    b.locality_enabled,
    b.default_topic_view,
    b.default_topic_view_rev,
    b.chat_bridge_enabled,
    b.chat_bridge_conversation_id
  from public.boards b
  where b.org_id = p_org_id
    and b.archived_at is null
  order by b.created_at;
$$;

revoke all on function public.get_my_boards(uuid) from public;
revoke all on function public.get_my_boards(uuid) from anon;
grant execute on function public.get_my_boards(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Mirror: po INSERT komentarza w board_topic → adnotacja w kanale
-- ---------------------------------------------------------------------------
create or replace function public.board_mirror_topic_comment_to_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic_id uuid;
  v_board_id uuid;
  v_topic_title text;
  v_channel_id uuid;
  v_root_id uuid;
  v_root_exists boolean;
  v_body text;
  v_mirror_id uuid;
  v_payload jsonb;
begin
  -- Tylko świeże, nieusunięte, niesystemowe wiadomości w rozmowie tematu.
  if tg_op <> 'INSERT' then
    return new;
  end if;
  if new.deleted_at is not null or new.kind = 'system' then
    return new;
  end if;
  -- Pętla: nie lustrzuj już zmirrorowanych / rootów mostu.
  if coalesce(new.payload, '{}'::jsonb) ? 'boardMirror' then
    return new;
  end if;

  select c.board_topic_id into v_topic_id
  from public.conversations c
  where c.id = new.conversation_id
    and c.kind = 'board_topic';
  if v_topic_id is null then
    return new;
  end if;

  select t.board_id, t.title into v_board_id, v_topic_title
  from public.board_topics t
  where t.id = v_topic_id;
  if v_board_id is null then
    return new;
  end if;

  select b.chat_bridge_conversation_id into v_channel_id
  from public.boards b
  where b.id = v_board_id
    and b.chat_bridge_enabled
    and b.chat_bridge_conversation_id is not null
    and b.archived_at is null;
  if v_channel_id is null then
    return new;
  end if;

  -- Kanał musi nadal istnieć i być kanałem.
  if not exists (
    select 1 from public.conversations c
    where c.id = v_channel_id
      and c.kind = 'channel'
      and c.archived_at is null
  ) then
    return new;
  end if;

  v_body := case new.kind
    when 'gif' then 'GIF'
    when 'voice' then 'Wiadomość głosowa'
    when 'poll' then coalesce(nullif(btrim(new.body), ''), 'Ankieta')
    when 'checklist' then coalesce(nullif(btrim(new.body), ''), 'Checklista')
    when 'gallery' then 'Galeria'
    else coalesce(nullif(btrim(new.body), ''), 'Wiadomość')
  end;
  -- Skróć długie komentarze — w kanale to tylko sygnał.
  if char_length(v_body) > 400 then
    v_body := left(v_body, 397) || '…';
  end if;

  begin
    select r.root_message_id into v_root_id
    from public.board_topic_channel_roots r
    where r.topic_id = v_topic_id
      and r.conversation_id = v_channel_id;

    if v_root_id is null then
      v_root_id := gen_random_uuid();
      insert into public.messages (
        id, conversation_id, author_user_id, kind, body, payload,
        mentions, thread_root_id, thread_title, created_at
      ) values (
        v_root_id,
        v_channel_id,
        new.author_user_id,
        'text',
        coalesce(nullif(btrim(v_topic_title), ''), 'Temat'),
        jsonb_build_object(
          'boardMirror', jsonb_build_object(
            'role', 'root',
            'boardId', v_board_id,
            'topicId', v_topic_id
          )
        ),
        '{}'::uuid[],
        null,
        left(coalesce(nullif(btrim(v_topic_title), ''), 'Temat'), 120),
        new.created_at
      );
      insert into public.board_topic_channel_roots (
        topic_id, conversation_id, root_message_id
      ) values (
        v_topic_id, v_channel_id, v_root_id
      )
      on conflict (topic_id) do update
        set conversation_id = excluded.conversation_id,
            root_message_id = excluded.root_message_id;
    else
      -- Root mógł zostać usunięty — odtwórz mapowanie.
      select exists(
        select 1 from public.messages m
        where m.id = v_root_id and m.deleted_at is null
      ) into v_root_exists;
      if not v_root_exists then
        v_root_id := gen_random_uuid();
        insert into public.messages (
          id, conversation_id, author_user_id, kind, body, payload,
          mentions, thread_root_id, thread_title, created_at
        ) values (
          v_root_id,
          v_channel_id,
          new.author_user_id,
          'text',
          coalesce(nullif(btrim(v_topic_title), ''), 'Temat'),
          jsonb_build_object(
            'boardMirror', jsonb_build_object(
              'role', 'root',
              'boardId', v_board_id,
              'topicId', v_topic_id
            )
          ),
          '{}'::uuid[],
          null,
          left(coalesce(nullif(btrim(v_topic_title), ''), 'Temat'), 120),
          new.created_at
        );
        update public.board_topic_channel_roots
        set root_message_id = v_root_id,
            conversation_id = v_channel_id
        where topic_id = v_topic_id;
      end if;
    end if;

    v_mirror_id := gen_random_uuid();
    v_payload := jsonb_build_object(
      'boardMirror', jsonb_build_object(
        'role', 'reply',
        'boardId', v_board_id,
        'topicId', v_topic_id,
        'sourceMessageId', new.id
      )
    );

    insert into public.messages (
      id, conversation_id, author_user_id, kind, body, payload,
      mentions, thread_root_id, reply_to_message_id, created_at
    ) values (
      v_mirror_id,
      v_channel_id,
      new.author_user_id,
      'text',
      v_body,
      v_payload,
      '{}'::uuid[],
      v_root_id,
      null,
      -- Lekko po źródle, żeby kolejność w feedzie była stabilna względem rootu.
      new.created_at + interval '1 millisecond'
    );
  exception when others then
    raise warning 'board_mirror_topic_comment_to_channel: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists board_mirror_topic_comment_trg on public.messages;
create trigger board_mirror_topic_comment_trg
  after insert on public.messages
  for each row
  execute function public.board_mirror_topic_comment_to_channel();
