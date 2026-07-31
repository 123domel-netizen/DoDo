-- Globalna archiwizacja kanału (admin): widoczna u wszystkich członków, blokuje pisanie.
-- conversations.archived_at pozostaje dla archiwum systemowego (cross-org) — ukryte w overview.
-- conversation_members.archived_at — nadal osobiste archiwum DM / item.

alter table public.conversations
  add column if not exists channel_archived_at timestamptz;

comment on column public.conversations.channel_archived_at is
  'Archiwizacja kanału przez admina — wspólna dla wszystkich członków; blokuje nowe wiadomości.';

create index if not exists conversations_channel_archived_idx
  on public.conversations (channel_archived_at)
  where channel_archived_at is not null;

-- ---------------------------------------------------------------------------
-- Blokada INSERT gdy kanał zarchiwizowany przez admina
-- ---------------------------------------------------------------------------
drop policy if exists "member sends own messages" on public.messages;
create policy "member sends own messages" on public.messages
  for insert with check (
    author_user_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.archived_at is null
        and c.channel_archived_at is null
    )
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

-- ---------------------------------------------------------------------------
-- RPC: kanał = globalnie (admin); DM/item = per-user
-- ---------------------------------------------------------------------------
create or replace function public.set_conversation_archived(
  p_conversation_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv_kind text;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select c.kind into conv_kind
  from public.conversations c
  where c.id = p_conversation_id;

  if conv_kind is null then
    raise exception 'conversation not found';
  end if;

  if conv_kind = 'channel' then
    if not public.is_conversation_admin(p_conversation_id) then
      raise exception 'not an admin';
    end if;
    update public.conversations
    set channel_archived_at = case when p_archived then now() else null end
    where id = p_conversation_id;
    return;
  end if;

  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a member';
  end if;

  insert into public.conversation_members (conversation_id, user_id, archived_at)
  values (p_conversation_id, caller, case when p_archived then now() end)
  on conflict (conversation_id, user_id) do update
    set archived_at = case when p_archived then now() else null end,
        left_at = null;
end;
$$;

grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Overview: my_archived_at = osobiste LUB globalne archiwum kanału
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

grant execute on function public.get_conversation_overview() to authenticated;

drop policy if exists "member or public channel read" on public.conversations;
create policy "member or public channel read" on public.conversations
  for select using (
    public.is_conversation_member(id)
    or (
      kind = 'channel'
      and is_public
      and archived_at is null
      and channel_archived_at is null
      and public.shares_org_with_channel(id)
    )
  );
