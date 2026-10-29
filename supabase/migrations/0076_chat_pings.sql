-- Chat PING: urgent attention request without a history message.
-- Separate table (not messages) so chat feed / unread stay clean.
-- Push is sent by Edge Function send-ping (JWT of the caller), not pg_net.

create table if not exists public.chat_pings (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_user_id  uuid not null references auth.users (id) on delete cascade,
  target_user_id  uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  constraint chat_pings_not_self check (sender_user_id <> target_user_id)
);

create index if not exists chat_pings_sender_target_created_idx
  on public.chat_pings (sender_user_id, target_user_id, created_at desc);

create index if not exists chat_pings_target_created_idx
  on public.chat_pings (target_user_id, created_at desc);

alter table public.chat_pings enable row level security;

drop policy if exists "ping parties can read" on public.chat_pings;
create policy "ping parties can read" on public.chat_pings
  for select using (
    sender_user_id = auth.uid()
    or target_user_id = auth.uid()
  );

-- No insert/update/delete policies for authenticated — only SECURITY DEFINER RPC writes.

grant select on public.chat_pings to authenticated;
grant all on public.chat_pings to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_pings'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_pings';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- send_ping: validate members, rate-limit, insert one row per target
-- ---------------------------------------------------------------------------
create or replace function public.send_ping(
  p_conversation_id uuid,
  p_target_ids uuid[]
)
returns setof public.chat_pings
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv record;
  v_targets uuid[];
  tid uuid;
  v_board_id uuid;
  v_org_id uuid;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if p_conversation_id is null then
    raise exception 'ping no conversation';
  end if;

  select c.id, c.kind, c.dm_key, c.archived_at, c.channel_archived_at, c.board_topic_id
    into conv
  from public.conversations c
  where c.id = p_conversation_id;

  if not found then
    raise exception 'ping no conversation';
  end if;
  if conv.archived_at is not null or conv.channel_archived_at is not null then
    raise exception 'ping conversation archived';
  end if;
  -- Notebook (solo DM): no one to ping.
  if conv.kind = 'dm' and conv.dm_key = caller::text then
    raise exception 'ping notebook';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a conversation member';
  end if;

  -- Unique targets, drop nulls and self.
  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_targets
  from unnest(coalesce(p_target_ids, '{}'::uuid[])) as x
  where x is not null and x <> caller;

  if coalesce(array_length(v_targets, 1), 0) = 0 then
    raise exception 'ping no targets';
  end if;
  if array_length(v_targets, 1) > 20 then
    raise exception 'ping too many targets';
  end if;

  if conv.kind = 'board_topic' then
    select t.board_id, b.org_id into v_board_id, v_org_id
    from public.board_topics t
    join public.boards b on b.id = t.board_id
    where t.id = conv.board_topic_id;
    if v_board_id is null then
      raise exception 'ping invalid target';
    end if;
    foreach tid in array v_targets loop
      if not exists (
        select 1
        from public.board_members bm
        join public.org_members om
          on om.org_id = v_org_id and om.user_id = bm.user_id
        where bm.board_id = v_board_id
          and bm.user_id = tid
      ) then
        raise exception 'ping invalid target';
      end if;
    end loop;
  else
    foreach tid in array v_targets loop
      if not exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id = p_conversation_id
          and cm.user_id = tid
          and cm.left_at is null
      ) then
        raise exception 'ping invalid target';
      end if;
    end loop;
  end if;

  -- Rate limit: same sender -> same target within 60s.
  if exists (
    select 1
    from public.chat_pings p
    where p.sender_user_id = caller
      and p.target_user_id = any (v_targets)
      and p.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'ping rate limited';
  end if;

  -- Housekeeping: drop sender rows older than 1 day.
  delete from public.chat_pings
  where sender_user_id = caller
    and created_at < now() - interval '1 day';

  return query
  insert into public.chat_pings (conversation_id, sender_user_id, target_user_id)
  select p_conversation_id, caller, t
  from unnest(v_targets) as t
  returning *;
end;
$$;

revoke all on function public.send_ping(uuid, uuid[]) from public;
revoke all on function public.send_ping(uuid, uuid[]) from anon;
grant execute on function public.send_ping(uuid, uuid[]) to authenticated;
