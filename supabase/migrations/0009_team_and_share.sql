-- Zespół + uczestnicy itemów + dostęp SHARE (bez niszczenia istniejących danych).

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users (id) on delete cascade,
  member_user_id  uuid references auth.users (id) on delete set null,
  email           text not null,
  display_name    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_user_id, email)
);

create index if not exists team_members_owner_idx on public.team_members (owner_user_id);
create index if not exists team_members_email_idx on public.team_members (lower(email));

drop trigger if exists team_members_touch on public.team_members;
create trigger team_members_touch before update on public.team_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- item_participants
-- ---------------------------------------------------------------------------
create table if not exists public.item_participants (
  id                        uuid primary key default gen_random_uuid(),
  item_id                   uuid not null references public.items (id) on delete cascade,
  owner_user_id             uuid not null references auth.users (id) on delete cascade,
  participant_user_id       uuid references auth.users (id) on delete set null,
  participant_email         text not null,
  participant_display_name  text,
  status                    text not null default 'invited'
    check (status in ('invited', 'accepted', 'rejected', 'active')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (item_id, participant_email)
);

create index if not exists item_participants_item_idx on public.item_participants (item_id);
create index if not exists item_participants_email_idx on public.item_participants (lower(participant_email));
create index if not exists item_participants_user_idx on public.item_participants (participant_user_id);
create index if not exists item_participants_owner_idx on public.item_participants (owner_user_id);

drop trigger if exists item_participants_touch on public.item_participants;
create trigger item_participants_touch before update on public.item_participants
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: team_members
-- ---------------------------------------------------------------------------
alter table public.team_members enable row level security;

drop policy if exists "own team members" on public.team_members;
create policy "own team members" on public.team_members
  for all using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

grant all on public.team_members to service_role;
grant select, insert, update, delete on public.team_members to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: item_participants
-- ---------------------------------------------------------------------------
alter table public.item_participants enable row level security;

drop policy if exists "owner manages item participants" on public.item_participants;
create policy "owner manages item participants" on public.item_participants
  for all using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "participant read item participants" on public.item_participants;
create policy "participant read item participants" on public.item_participants
  for select using (
    participant_user_id = auth.uid()
    or lower(participant_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "participant update own participation" on public.item_participants;

grant all on public.item_participants to service_role;
grant select, insert, update, delete on public.item_participants to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: items — uczestnik: tylko SELECT (edycja treści przez RPC)
-- ---------------------------------------------------------------------------
drop policy if exists "participant read shared items" on public.items;
create policy "participant read shared items" on public.items
  for select using (
    exists (
      select 1 from public.item_participants ip
      where ip.item_id = items.id
        and ip.status <> 'rejected'
        and (
          ip.participant_user_id = auth.uid()
          or lower(ip.participant_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    )
  );

drop policy if exists "participant update shared items" on public.items;

-- ---------------------------------------------------------------------------
-- RPC: dodaj członka zespołu + whitelist (allowed_users)
-- ---------------------------------------------------------------------------
create or replace function public.add_team_member(
  p_email text,
  p_display_name text default null
)
returns public.team_members
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_email text := lower(trim(p_email));
  rec public.team_members;
begin
  if norm_email = '' or position('@' in norm_email) = 0 then
    raise exception 'invalid email';
  end if;

  insert into public.allowed_users (email)
  values (norm_email)
  on conflict (email) do nothing;

  insert into public.team_members (owner_user_id, email, display_name)
  values (
    auth.uid(),
    norm_email,
    nullif(trim(p_display_name), '')
  )
  on conflict (owner_user_id, email) do update set
    display_name = coalesce(
      excluded.display_name,
      public.team_members.display_name
    ),
    updated_at = now()
  returning * into rec;

  return rec;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: uczestnik aktualizuje wyłącznie description + checklist (+ updated_at)
-- ---------------------------------------------------------------------------
create or replace function public.update_shared_item_content(
  p_item_id uuid,
  p_description text default null,
  p_checklist jsonb default null
)
returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_uid uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  prev_payload jsonb;
  rec public.items;
begin
  if caller_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.item_participants ip
    where ip.item_id = p_item_id
      and ip.status <> 'rejected'
      and (
        ip.participant_user_id = caller_uid
        or lower(ip.participant_email) = caller_email
      )
  ) then
    raise exception 'not a participant';
  end if;

  select payload into prev_payload
  from public.items
  where id = p_item_id;

  if not found then
    raise exception 'item not found';
  end if;

  update public.items
  set
    description = coalesce(p_description, description),
    payload = jsonb_set(
      coalesce(prev_payload, '{}'::jsonb),
      '{checklist}',
      coalesce(
        p_checklist,
        coalesce(prev_payload, '{}'::jsonb) -> 'checklist',
        '[]'::jsonb
      ),
      true
    ),
    updated_at = now()
  where id = p_item_id
  returning * into rec;

  return rec;
end;
$$;

grant execute on function public.add_team_member(text, text) to authenticated;
grant execute on function public.update_shared_item_content(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: uczestnik zmienia wyłącznie własny status (np. rejected)
-- ---------------------------------------------------------------------------
create or replace function public.update_own_participation_status(
  p_item_id uuid,
  p_status text
)
returns public.item_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_uid uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rec public.item_participants;
begin
  if caller_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_status is null or p_status not in ('invited', 'accepted', 'rejected', 'active') then
    raise exception 'invalid status';
  end if;

  update public.item_participants
  set
    status = p_status,
    updated_at = now()
  where item_id = p_item_id
    and (
      participant_user_id = caller_uid
      or lower(participant_email) = caller_email
    )
  returning * into rec;

  if not found then
    raise exception 'participation not found';
  end if;

  return rec;
end;
$$;

grant execute on function public.update_own_participation_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (idempotentne dodanie tabel do publikacji)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'item_participants'
  ) then
    alter publication supabase_realtime add table public.item_participants;
  end if;
end $$;
