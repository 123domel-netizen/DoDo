-- Harmonogramy (construction schedules) — production tables + RLS.
-- Feature flag: orgs.schedules_enabled (default false).

alter table public.orgs
  add column if not exists schedules_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- Org-level schedule settings
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_org_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  next_number_hint int not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.schedule_org_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Construction projects (budowy)
-- ---------------------------------------------------------------------------
create table if not exists public.construction_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  number text not null,
  name text not null,
  admin_user_id uuid not null references auth.users (id),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  constraint construction_projects_number_nonempty check (char_length(trim(number)) > 0)
);

create unique index if not exists construction_projects_org_number_lower_idx
  on public.construction_projects (org_id, lower(trim(number)));

create index if not exists construction_projects_org_id_idx
  on public.construction_projects (org_id);

-- ---------------------------------------------------------------------------
-- Project members
-- ---------------------------------------------------------------------------
create table if not exists public.construction_project_members (
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (project_id, user_id)
);

create index if not exists construction_project_members_user_idx
  on public.construction_project_members (user_id);

-- ---------------------------------------------------------------------------
-- Shared crews (org scope)
-- ---------------------------------------------------------------------------
create table if not exists public.construction_crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  headcount int,
  supervisor text not null default '',
  company text not null default '',
  phone text not null default ''
);

create index if not exists construction_crews_org_id_idx
  on public.construction_crews (org_id);

-- ---------------------------------------------------------------------------
-- Schedule blocks (categories / subcategories / works)
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  title text not null default '',
  category_id text not null default 'stan-0',
  scope text not null default '',
  role text not null default 'work' check (role in ('work', 'subcategory')),
  parent_id uuid references public.schedule_blocks (id) on delete set null,
  crew_id uuid references public.construction_crews (id) on delete set null,
  start_date date not null,
  end_date date not null,
  status text not null default 'planowane',
  color text not null default '#64748b',
  note text not null default ''
);

create index if not exists schedule_blocks_project_dates_idx
  on public.schedule_blocks (project_id, start_date);

-- ---------------------------------------------------------------------------
-- Schedule events (budowlane + dokumentacyjne)
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  block_id uuid references public.schedule_blocks (id) on delete set null,
  kind text not null check (kind in ('budowlane', 'dokumentacyjne')),
  title text not null default '',
  event_date date not null,
  note text not null default '',
  category_id text,
  status text,
  activity text,
  custom_label text,
  written_at timestamptz,
  reported_by_user_id uuid references auth.users (id) on delete set null,
  written_by_user_id uuid references auth.users (id) on delete set null
);

create index if not exists schedule_events_project_date_idx
  on public.schedule_events (project_id, event_date);

-- ---------------------------------------------------------------------------
-- Category row overrides per project
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_category_meta (
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  category_id text not null,
  title text not null default '',
  note text not null default '',
  start_date date,
  end_date date,
  primary key (project_id, category_id)
);

-- ---------------------------------------------------------------------------
-- Org catalogs (schedule + supervision presets)
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_catalogs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null check (kind in ('schedule', 'supervision')),
  payload jsonb not null,
  unique (org_id, kind)
);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_construction_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.construction_projects p
    where p.id = p_project_id
      and (
        p.admin_user_id = auth.uid()
        or exists (
          select 1 from public.construction_project_members m
          where m.project_id = p.id and m.user_id = auth.uid()
        )
        or public.is_org_admin(p.org_id)
      )
  );
$$;

create or replace function public.can_manage_construction_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.construction_projects p
    where p.id = p_project_id
      and (
        p.admin_user_id = auth.uid()
        or public.is_org_admin(p.org_id)
      )
  );
$$;

create or replace function public.construction_project_org_id(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.construction_projects where id = p_project_id;
$$;

grant execute on function public.is_construction_project_member(uuid) to authenticated;
grant execute on function public.can_manage_construction_project(uuid) to authenticated;
grant execute on function public.construction_project_org_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.construction_projects enable row level security;
alter table public.construction_project_members enable row level security;
alter table public.construction_crews enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.schedule_events enable row level security;
alter table public.schedule_category_meta enable row level security;
alter table public.schedule_catalogs enable row level security;

-- Projects: members + org admins see all org projects
drop policy if exists "construction projects select" on public.construction_projects;
create policy "construction projects select" on public.construction_projects
  for select using (
    public.is_org_admin(org_id)
    or admin_user_id = auth.uid()
    or exists (
      select 1 from public.construction_project_members m
      where m.project_id = id and m.user_id = auth.uid()
    )
    or public.is_app_admin()
  );

drop policy if exists "construction projects insert" on public.construction_projects;
create policy "construction projects insert" on public.construction_projects
  for insert with check (
    public.is_org_member(org_id)
    and admin_user_id = auth.uid()
  );

drop policy if exists "construction projects update" on public.construction_projects;
create policy "construction projects update" on public.construction_projects
  for update using (public.can_manage_construction_project(id));

drop policy if exists "construction projects delete" on public.construction_projects;
create policy "construction projects delete" on public.construction_projects
  for delete using (public.can_manage_construction_project(id));

-- Members
drop policy if exists "construction project members select" on public.construction_project_members;
create policy "construction project members select" on public.construction_project_members
  for select using (public.is_construction_project_member(project_id));

drop policy if exists "construction project members write" on public.construction_project_members;
create policy "construction project members write" on public.construction_project_members
  for all using (public.can_manage_construction_project(project_id))
  with check (public.can_manage_construction_project(project_id));

-- Crews: any org member read/write (shared list)
drop policy if exists "construction crews select" on public.construction_crews;
create policy "construction crews select" on public.construction_crews
  for select using (public.is_org_member(org_id) or public.is_app_admin());

drop policy if exists "construction crews write" on public.construction_crews;
create policy "construction crews write" on public.construction_crews
  for all using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

-- Blocks / events / meta: project members
drop policy if exists "schedule blocks all" on public.schedule_blocks;
create policy "schedule blocks all" on public.schedule_blocks
  for all using (public.is_construction_project_member(project_id))
  with check (public.is_construction_project_member(project_id));

drop policy if exists "schedule events all" on public.schedule_events;
create policy "schedule events all" on public.schedule_events
  for all using (public.is_construction_project_member(project_id))
  with check (public.is_construction_project_member(project_id));

drop policy if exists "schedule category meta all" on public.schedule_category_meta;
create policy "schedule category meta all" on public.schedule_category_meta
  for all using (public.is_construction_project_member(project_id))
  with check (public.is_construction_project_member(project_id));

-- Catalogs: read org members, write org admins
drop policy if exists "schedule catalogs select" on public.schedule_catalogs;
create policy "schedule catalogs select" on public.schedule_catalogs
  for select using (public.is_org_member(org_id) or public.is_app_admin());

drop policy if exists "schedule catalogs write" on public.schedule_catalogs;
create policy "schedule catalogs write" on public.schedule_catalogs
  for all using (public.is_org_admin(org_id) or public.is_app_admin())
  with check (public.is_org_admin(org_id) or public.is_app_admin());

drop policy if exists "schedule org settings select" on public.schedule_org_settings;
create policy "schedule org settings select" on public.schedule_org_settings
  for select using (public.is_org_member(org_id) or public.is_app_admin());

drop policy if exists "schedule org settings write" on public.schedule_org_settings;
create policy "schedule org settings write" on public.schedule_org_settings
  for all using (public.is_org_admin(org_id) or public.is_app_admin())
  with check (public.is_org_admin(org_id) or public.is_app_admin());

grant select, insert, update, delete on public.construction_projects to authenticated;
grant select, insert, update, delete on public.construction_project_members to authenticated;
grant select, insert, update, delete on public.construction_crews to authenticated;
grant select, insert, update, delete on public.schedule_blocks to authenticated;
grant select, insert, update, delete on public.schedule_events to authenticated;
grant select, insert, update, delete on public.schedule_category_meta to authenticated;
grant select, insert, update, delete on public.schedule_catalogs to authenticated;
grant select, insert, update, delete on public.schedule_org_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Org RPC: toggle schedules module
-- ---------------------------------------------------------------------------
create or replace function public.org_set_schedules_enabled(p_org_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_org_admin(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  update public.orgs set schedules_enabled = p_enabled where id = p_org_id;
end;
$$;

grant execute on function public.org_set_schedules_enabled(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Extend org_my_orgs + org_get_detail with schedules_enabled
-- ---------------------------------------------------------------------------
drop function if exists public.org_my_orgs();

create or replace function public.org_my_orgs()
returns table (
  id uuid,
  name text,
  plan_code text,
  seat_limit int,
  plan_ends_at timestamptz,
  invites_locked boolean,
  created_at timestamptz,
  seat_used int,
  my_role text,
  schedules_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    o.id,
    o.name,
    o.plan_code,
    o.seat_limit,
    o.plan_ends_at,
    o.invites_locked,
    o.created_at,
    public.org_seat_usage(o.id),
    m.role,
    o.schedules_enabled
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name;
end;
$$;

create or replace function public.org_get_detail(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orgs;
  result jsonb;
begin
  if not (public.is_org_member(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  perform public.org_expire_invites(p_org_id);
  select * into o from public.orgs where id = p_org_id;
  if not found then raise exception 'org not found'; end if;

  result := jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'planCode', o.plan_code,
    'seatLimit', o.seat_limit,
    'planEndsAt', o.plan_ends_at,
    'adminNote', case when public.is_app_admin() then o.admin_note else null end,
    'invitesLocked', o.invites_locked,
    'schedulesEnabled', o.schedules_enabled,
    'createdAt', o.created_at,
    'seatUsed', public.org_seat_usage(p_org_id),
    'canInvite', public.org_can_invite(p_org_id),
    'overLimit', public.org_seat_usage(p_org_id) > o.seat_limit,
    'myRole', (
      select m.role from public.org_members m
      where m.org_id = p_org_id and m.user_id = auth.uid()
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'role', m.role,
        'joinedAt', m.joined_at,
        'email', u.email,
        'displayName', p.display_name,
        'avatarUrl', p.avatar_url
      ) order by m.role asc, p.display_name nulls last)
      from public.org_members m
      left join auth.users u on u.id = m.user_id
      left join public.profiles p on p.user_id = m.user_id
      where m.org_id = p_org_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.email,
        'status', i.status,
        'expiresAt', i.expires_at,
        'createdAt', i.created_at,
        'invitedBy', i.invited_by
      ) order by i.created_at desc)
      from public.org_invitations i
      where i.org_id = p_org_id and i.status = 'pending'
    ), '[]'::jsonb)
  );
  return result;
end;
$$;

grant execute on function public.org_my_orgs() to authenticated;
grant execute on function public.org_get_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap catalogs for org (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.schedule_ensure_catalogs(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_org_member(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  insert into public.schedule_org_settings (org_id) values (p_org_id)
  on conflict (org_id) do nothing;
end;
$$;

grant execute on function public.schedule_ensure_catalogs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Create project with optional schedule preset (transactional)
-- p_blocks / p_category_meta: jsonb arrays matching client seed output
-- ---------------------------------------------------------------------------
create or replace function public.create_project_with_schedule_preset(
  p_org_id uuid,
  p_number text,
  p_name text,
  p_member_ids uuid[],
  p_schedule_preset boolean default false,
  p_start_date date default null,
  p_end_date date default null,
  p_blocks jsonb default '[]'::jsonb,
  p_category_meta jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_number text := trim(p_number);
  v_block jsonb;
  v_meta jsonb;
  v_members uuid[];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_org_member(p_org_id) then raise exception 'forbidden'; end if;
  if v_number = '' then raise exception 'empty number'; end if;
  if exists (
    select 1 from public.construction_projects
    where org_id = p_org_id and lower(number) = lower(v_number)
  ) then
    raise exception 'number exists';
  end if;

  v_members := array(select distinct unnest(array_append(coalesce(p_member_ids, '{}'), v_uid)));

  insert into public.construction_projects (org_id, number, name, admin_user_id)
  values (p_org_id, v_number, trim(p_name), v_uid)
  returning id into v_project_id;

  insert into public.construction_project_members (project_id, user_id)
  select v_project_id, m
  from unnest(v_members) as m;

  if p_schedule_preset and p_start_date is not null and p_end_date is not null then
    for v_block in select * from jsonb_array_elements(p_blocks)
    loop
      insert into public.schedule_blocks (
        id, project_id, title, category_id, scope, role, parent_id,
        crew_id, start_date, end_date, status, color, note
      ) values (
        (v_block->>'id')::uuid,
        v_project_id,
        coalesce(v_block->>'title', ''),
        coalesce(v_block->>'categoryId', 'stan-0'),
        coalesce(v_block->>'scope', ''),
        coalesce(v_block->>'role', 'work'),
        nullif(v_block->>'parentId', '')::uuid,
        nullif(v_block->>'crewId', '')::uuid,
        (v_block->>'startDate')::date,
        (v_block->>'endDate')::date,
        coalesce(v_block->>'status', 'planowane'),
        coalesce(v_block->>'color', '#64748b'),
        coalesce(v_block->>'note', '')
      );
    end loop;

    for v_meta in select * from jsonb_array_elements(p_category_meta)
    loop
      insert into public.schedule_category_meta (
        project_id, category_id, title, note, start_date, end_date
      ) values (
        v_project_id,
        v_meta->>'categoryId',
        coalesce(v_meta->>'title', ''),
        coalesce(v_meta->>'note', ''),
        nullif(v_meta->>'startDate', '')::date,
        nullif(v_meta->>'endDate', '')::date
      );
    end loop;
  end if;

  update public.schedule_org_settings
  set next_number_hint = greatest(
    next_number_hint,
    case when v_number ~ '^\d+$' then (v_number::int + 1) else next_number_hint end
  ),
  updated_at = now()
  where org_id = p_org_id;

  return jsonb_build_object(
    'id', v_project_id,
    'orgId', p_org_id,
    'number', v_number,
    'name', trim(p_name),
    'adminUserId', v_uid,
    'memberIds', to_jsonb(v_members),
    'createdAt', now(),
    'status', 'active'
  );
end;
$$;

grant execute on function public.create_project_with_schedule_preset(
  uuid, text, text, uuid[], boolean, date, date, jsonb, jsonb
) to authenticated;

-- Dashboard hints: upcoming events for current user
create or replace function public.schedule_dashboard_hints(
  p_org_id uuid,
  p_from date default current_date,
  p_limit int default 50
)
returns table (
  event_id uuid,
  project_id uuid,
  project_number text,
  project_name text,
  kind text,
  title text,
  event_date date,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    p.id,
    p.number,
    p.name,
    e.kind,
    e.title,
    e.event_date,
    e.status
  from public.schedule_events e
  join public.construction_projects p on p.id = e.project_id
  where p.org_id = p_org_id
    and e.event_date >= p_from
    and public.is_construction_project_member(p.id)
  order by e.event_date asc, p.number asc
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function public.schedule_dashboard_hints(uuid, date, int) to authenticated;
