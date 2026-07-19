-- Orgs (zespoły) + plany/miejsca + app admins.
-- Nie koliduje z public.groups (kategorie kalendarza) ani team_members (kontakty).

-- ---------------------------------------------------------------------------
-- Katalog planów (stałe limity; custom = dowolny limit w RPC)
-- ---------------------------------------------------------------------------
create or replace function public.org_plan_default_limit(p_plan text)
returns int
language sql
immutable
as $$
  select case lower(p_plan)
    when 'demo' then 2
    when 'basic' then 10
    when 'pro' then 20
    when 'team' then 50
    when 'custom' then null
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- app_admins
-- ---------------------------------------------------------------------------
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

drop policy if exists "app admins read self or peer" on public.app_admins;
create policy "app admins read self or peer" on public.app_admins
  for select using (
    user_id = auth.uid()
    or public.is_app_admin()
  );

grant select on public.app_admins to authenticated;
grant all on public.app_admins to service_role;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_app_admin() to authenticated;

-- Seed / bootstrap: email → user_id gdy konto już istnieje; inaczej przy profilu
create or replace function public.ensure_app_admin_by_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  select id into uid
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
  if uid is not null then
    insert into public.app_admins (user_id) values (uid)
    on conflict (user_id) do nothing;
  end if;
end;
$$;

select public.ensure_app_admin_by_email('lukaszewicz.dominik@gmail.com');

-- Przy tworzeniu profilu: jeśli email to app admin seed → dodaj
create or replace function public.maybe_seed_app_admin_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  select lower(email) into em from auth.users where id = new.user_id;
  if em = 'lukaszewicz.dominik@gmail.com' then
    insert into public.app_admins (user_id) values (new.user_id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_maybe_app_admin on public.profiles;
create trigger profiles_maybe_app_admin
  after insert on public.profiles
  for each row execute function public.maybe_seed_app_admin_from_profile();

-- ---------------------------------------------------------------------------
-- orgs
-- ---------------------------------------------------------------------------
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_code text not null default 'demo'
    check (plan_code in ('demo', 'basic', 'pro', 'team', 'custom')),
  seat_limit int not null default 2 check (seat_limit >= 1),
  plan_ends_at timestamptz,
  admin_note text,
  invites_locked boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists orgs_touch on public.orgs;
create trigger orgs_touch before update on public.orgs
  for each row execute function public.touch_updated_at();

create table if not exists public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create unique index if not exists org_members_one_admin_idx
  on public.org_members (org_id)
  where role = 'admin';

create index if not exists org_members_user_idx on public.org_members (user_id);

create table if not exists public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  cancelled_at timestamptz
);

create unique index if not exists org_invitations_pending_email_idx
  on public.org_invitations (org_id, lower(email))
  where status = 'pending';

create index if not exists org_invitations_email_idx
  on public.org_invitations (lower(email));

create table if not exists public.org_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs (id) on delete set null,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists org_audit_log_org_idx on public.org_audit_log (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

create or replace function public.org_expire_invites(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.org_invitations
  set status = 'expired'
  where org_id = p_org_id
    and status = 'pending'
    and expires_at < now();
end;
$$;

create or replace function public.org_seat_usage(p_org_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.org_members where org_id = p_org_id)
    + (select count(*)::int from public.org_invitations
       where org_id = p_org_id and status = 'pending' and expires_at >= now());
$$;

create or replace function public.org_can_invite(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orgs o
    where o.id = p_org_id
      and not o.invites_locked
      and public.org_seat_usage(p_org_id) < o.seat_limit
  );
$$;

create or replace function public.org_audit(
  p_org_id uuid,
  p_action text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.org_audit_log (org_id, actor_user_id, action, meta)
  values (p_org_id, auth.uid(), p_action, coalesce(p_meta, '{}'::jsonb));
end;
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.org_seat_usage(uuid) to authenticated;
grant execute on function public.org_can_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invitations enable row level security;
alter table public.org_audit_log enable row level security;

drop policy if exists "orgs select member or app admin" on public.orgs;
create policy "orgs select member or app admin" on public.orgs
  for select using (public.is_org_member(id) or public.is_app_admin());

-- Brak INSERT/UPDATE/DELETE dla authenticated — tylko RPC

drop policy if exists "org members select" on public.org_members;
create policy "org members select" on public.org_members
  for select using (public.is_org_member(org_id) or public.is_app_admin());

drop policy if exists "org invitations select" on public.org_invitations;
create policy "org invitations select" on public.org_invitations
  for select using (
    public.is_org_member(org_id)
    or public.is_app_admin()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "org audit select app admin" on public.org_audit_log;
create policy "org audit select app admin" on public.org_audit_log
  for select using (public.is_app_admin());

grant select on public.orgs to authenticated;
grant select on public.org_members to authenticated;
grant select on public.org_invitations to authenticated;
grant select on public.org_audit_log to authenticated;
grant all on public.orgs to service_role;
grant all on public.org_members to service_role;
grant all on public.org_invitations to service_role;
grant all on public.org_audit_log to service_role;

-- ---------------------------------------------------------------------------
-- RPC: app admin
-- ---------------------------------------------------------------------------
create or replace function public.app_find_user_by_email(p_email text)
returns table (user_id uuid, email text, display_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  norm text := lower(trim(p_email));
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  return query
  select u.id, u.email::text, p.display_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where lower(u.email) = norm
  limit 1;
end;
$$;

create or replace function public.app_list_orgs()
returns table (
  id uuid,
  name text,
  plan_code text,
  seat_limit int,
  plan_ends_at timestamptz,
  admin_note text,
  invites_locked boolean,
  created_at timestamptz,
  seat_used int,
  admin_user_id uuid,
  admin_email text,
  admin_display_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  return query
  select
    o.id,
    o.name,
    o.plan_code,
    o.seat_limit,
    o.plan_ends_at,
    o.admin_note,
    o.invites_locked,
    o.created_at,
    public.org_seat_usage(o.id) as seat_used,
    m.user_id as admin_user_id,
    u.email::text as admin_email,
    p.display_name as admin_display_name
  from public.orgs o
  left join public.org_members m on m.org_id = o.id and m.role = 'admin'
  left join auth.users u on u.id = m.user_id
  left join public.profiles p on p.user_id = m.user_id
  order by o.created_at desc;
end;
$$;

create or replace function public.app_create_org(
  p_name text,
  p_admin_user_id uuid,
  p_plan_code text default 'demo',
  p_custom_limit int default null,
  p_admin_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower(trim(p_plan_code));
  v_limit int;
  v_org_id uuid;
  v_name text := nullif(trim(p_name), '');
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  if v_name is null then
    raise exception 'invalid name';
  end if;
  if v_plan not in ('demo', 'basic', 'pro', 'team', 'custom') then
    raise exception 'invalid plan';
  end if;
  if not exists (select 1 from auth.users where id = p_admin_user_id) then
    raise exception 'admin user not found';
  end if;

  if v_plan = 'custom' then
    if p_custom_limit is null or p_custom_limit < 1 then
      raise exception 'custom limit required';
    end if;
    v_limit := p_custom_limit;
  else
    v_limit := public.org_plan_default_limit(v_plan);
  end if;

  insert into public.orgs (name, plan_code, seat_limit, admin_note, created_by)
  values (v_name, v_plan, v_limit, nullif(trim(p_admin_note), ''), auth.uid())
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, p_admin_user_id, 'admin');

  -- Whitelist admin email
  insert into public.allowed_users (email)
  select lower(email) from auth.users where id = p_admin_user_id
  on conflict (email) do nothing;

  perform public.org_audit(v_org_id, 'org_created', jsonb_build_object(
    'plan', v_plan, 'seat_limit', v_limit, 'admin_user_id', p_admin_user_id
  ));

  return v_org_id;
end;
$$;

create or replace function public.app_set_org_plan(
  p_org_id uuid,
  p_plan_code text,
  p_custom_limit int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := lower(trim(p_plan_code));
  v_limit int;
  o public.orgs;
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  if v_plan not in ('demo', 'basic', 'pro', 'team', 'custom') then
    raise exception 'invalid plan';
  end if;
  select * into o from public.orgs where id = p_org_id for update;
  if not found then raise exception 'org not found'; end if;

  if v_plan = 'custom' then
    if p_custom_limit is null or p_custom_limit < 1 then
      raise exception 'custom limit required';
    end if;
    v_limit := p_custom_limit;
  else
    v_limit := public.org_plan_default_limit(v_plan);
  end if;

  update public.orgs
  set plan_code = v_plan, seat_limit = v_limit
  where id = p_org_id;

  perform public.org_audit(p_org_id, 'plan_changed', jsonb_build_object(
    'from_plan', o.plan_code, 'to_plan', v_plan,
    'from_limit', o.seat_limit, 'to_limit', v_limit
  ));
end;
$$;

create or replace function public.app_set_org_seat_limit(
  p_org_id uuid,
  p_seat_limit int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orgs;
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  if p_seat_limit is null or p_seat_limit < 1 then
    raise exception 'invalid limit';
  end if;
  select * into o from public.orgs where id = p_org_id for update;
  if not found then raise exception 'org not found'; end if;

  update public.orgs
  set seat_limit = p_seat_limit, plan_code = 'custom'
  where id = p_org_id;

  perform public.org_audit(p_org_id, 'limit_changed', jsonb_build_object(
    'from_limit', o.seat_limit, 'to_limit', p_seat_limit
  ));
end;
$$;

create or replace function public.app_set_org_admin(
  p_org_id uuid,
  p_new_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_admin uuid;
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from auth.users where id = p_new_admin_user_id) then
    raise exception 'user not found';
  end if;

  perform 1 from public.orgs where id = p_org_id for update;
  if not found then raise exception 'org not found'; end if;

  select user_id into old_admin
  from public.org_members
  where org_id = p_org_id and role = 'admin';

  if old_admin is not null and old_admin = p_new_admin_user_id then
    return;
  end if;

  -- Ensure new admin is a member
  insert into public.org_members (org_id, user_id, role)
  values (p_org_id, p_new_admin_user_id, 'member')
  on conflict (org_id, user_id) do nothing;

  if old_admin is not null then
    update public.org_members set role = 'member'
    where org_id = p_org_id and user_id = old_admin;
  end if;

  update public.org_members set role = 'admin'
  where org_id = p_org_id and user_id = p_new_admin_user_id;

  insert into public.allowed_users (email)
  select lower(email) from auth.users where id = p_new_admin_user_id
  on conflict (email) do nothing;

  perform public.org_audit(p_org_id, 'admin_changed', jsonb_build_object(
    'from_user_id', old_admin, 'to_user_id', p_new_admin_user_id
  ));
end;
$$;

create or replace function public.app_set_org_note(
  p_org_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  update public.orgs set admin_note = nullif(trim(p_note), '') where id = p_org_id;
  if not found then raise exception 'org not found'; end if;
end;
$$;

create or replace function public.app_set_invites_locked(
  p_org_id uuid,
  p_locked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  update public.orgs set invites_locked = coalesce(p_locked, false) where id = p_org_id;
  if not found then raise exception 'org not found'; end if;
  perform public.org_audit(p_org_id, 'invites_locked', jsonb_build_object('locked', p_locked));
end;
$$;

create or replace function public.app_rename_org(
  p_org_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'invalid name';
  end if;
  update public.orgs set name = trim(p_name) where id = p_org_id;
  if not found then raise exception 'org not found'; end if;
end;
$$;

create or replace function public.app_remove_org_member(
  p_org_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r text;
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  select role into r from public.org_members
  where org_id = p_org_id and user_id = p_user_id;
  if not found then raise exception 'member not found'; end if;
  if r = 'admin' then
    raise exception 'cannot remove org admin';
  end if;
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public.org_audit(p_org_id, 'member_removed', jsonb_build_object('user_id', p_user_id));
end;
$$;

create or replace function public.app_cancel_org_invite(
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.org_invitations;
begin
  if not public.is_app_admin() then
    raise exception 'forbidden';
  end if;
  select * into inv from public.org_invitations where id = p_invitation_id for update;
  if not found then raise exception 'invite not found'; end if;
  if inv.status <> 'pending' then
    raise exception 'invite not pending';
  end if;
  update public.org_invitations
  set status = 'cancelled', cancelled_at = now()
  where id = p_invitation_id;
  perform public.org_audit(inv.org_id, 'invite_cancelled', jsonb_build_object(
    'invitation_id', p_invitation_id, 'email', inv.email
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: org admin / members
-- ---------------------------------------------------------------------------
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
  my_role text
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
    m.role
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

create or replace function public.org_rename(p_org_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_org_admin(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'invalid name';
  end if;
  update public.orgs set name = trim(p_name) where id = p_org_id;
end;
$$;

create or replace function public.org_invite(p_org_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  norm text := lower(trim(p_email));
  inv_id uuid;
  existing_user uuid;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'forbidden';
  end if;
  if norm = '' or position('@' in norm) = 0 then
    raise exception 'invalid email';
  end if;

  perform 1 from public.orgs where id = p_org_id for update;
  if not found then raise exception 'org not found'; end if;

  perform public.org_expire_invites(p_org_id);

  if exists (select 1 from public.orgs where id = p_org_id and invites_locked) then
    raise exception 'invites locked';
  end if;
  if public.org_seat_usage(p_org_id) >= (
    select seat_limit from public.orgs where id = p_org_id
  ) then
    raise exception 'seat limit reached';
  end if;

  select id into existing_user from auth.users where lower(email) = norm limit 1;
  if existing_user is not null and exists (
    select 1 from public.org_members where org_id = p_org_id and user_id = existing_user
  ) then
    raise exception 'already a member';
  end if;

  if exists (
    select 1 from public.org_invitations
    where org_id = p_org_id and lower(email) = norm and status = 'pending'
  ) then
    raise exception 'invite already pending';
  end if;

  insert into public.allowed_users (email) values (norm)
  on conflict (email) do nothing;

  insert into public.org_invitations (org_id, email, invited_by)
  values (p_org_id, norm, auth.uid())
  returning id into inv_id;

  -- Jeśli user już ma konto — dołącz od razu (miejsce: member zamiast pending)
  if existing_user is not null then
    insert into public.org_members (org_id, user_id, role)
    values (p_org_id, existing_user, 'member')
    on conflict do nothing;
    update public.org_invitations
    set status = 'accepted', accepted_at = now()
    where id = inv_id;
    perform public.org_audit(p_org_id, 'member_joined', jsonb_build_object(
      'user_id', existing_user, 'via', 'invite_existing'
    ));
  else
    perform public.org_audit(p_org_id, 'invite_sent', jsonb_build_object(
      'invitation_id', inv_id, 'email', norm
    ));
  end if;

  return inv_id;
end;
$$;

create or replace function public.org_cancel_invite(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.org_invitations;
begin
  select * into inv from public.org_invitations where id = p_invitation_id for update;
  if not found then raise exception 'invite not found'; end if;
  if not (public.is_org_admin(inv.org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;
  if inv.status <> 'pending' then
    raise exception 'invite not pending';
  end if;
  update public.org_invitations
  set status = 'cancelled', cancelled_at = now()
  where id = p_invitation_id;
  perform public.org_audit(inv.org_id, 'invite_cancelled', jsonb_build_object(
    'invitation_id', p_invitation_id, 'email', inv.email
  ));
end;
$$;

create or replace function public.org_remove_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r text;
begin
  if not public.is_org_admin(p_org_id) then
    raise exception 'forbidden';
  end if;
  select role into r from public.org_members
  where org_id = p_org_id and user_id = p_user_id;
  if not found then raise exception 'member not found'; end if;
  if r = 'admin' then
    raise exception 'cannot remove org admin';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot remove self';
  end if;
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public.org_audit(p_org_id, 'member_removed', jsonb_build_object('user_id', p_user_id));
end;
$$;

create or replace function public.org_accept_pending_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  uid uuid := auth.uid();
  inv record;
  n int := 0;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(email) into em from auth.users where id = uid;
  if em is null then return 0; end if;

  for inv in
    select * from public.org_invitations
    where lower(email) = em and status = 'pending' and expires_at >= now()
    for update
  loop
    perform 1 from public.orgs where id = inv.org_id for update;
    -- Accept even if over limit (invite already reserved seat when sent;
    -- if expired races, still allow join for valid pending)
    insert into public.org_members (org_id, user_id, role)
    values (inv.org_id, uid, 'member')
    on conflict do nothing;
    update public.org_invitations
    set status = 'accepted', accepted_at = now()
    where id = inv.id;
    perform public.org_audit(inv.org_id, 'member_joined', jsonb_build_object(
      'user_id', uid, 'via', 'accept_invite'
    ));
    n := n + 1;
  end loop;

  -- Expire stale
  update public.org_invitations
  set status = 'expired'
  where lower(email) = em and status = 'pending' and expires_at < now();

  return n;
end;
$$;

grant execute on function public.app_find_user_by_email(text) to authenticated;
grant execute on function public.app_list_orgs() to authenticated;
grant execute on function public.app_create_org(text, uuid, text, int, text) to authenticated;
grant execute on function public.app_set_org_plan(uuid, text, int) to authenticated;
grant execute on function public.app_set_org_seat_limit(uuid, int) to authenticated;
grant execute on function public.app_set_org_admin(uuid, uuid) to authenticated;
grant execute on function public.app_set_org_note(uuid, text) to authenticated;
grant execute on function public.app_set_invites_locked(uuid, boolean) to authenticated;
grant execute on function public.app_rename_org(uuid, text) to authenticated;
grant execute on function public.app_remove_org_member(uuid, uuid) to authenticated;
grant execute on function public.app_cancel_org_invite(uuid) to authenticated;
grant execute on function public.org_my_orgs() to authenticated;
grant execute on function public.org_get_detail(uuid) to authenticated;
grant execute on function public.org_rename(uuid, text) to authenticated;
grant execute on function public.org_invite(uuid, text) to authenticated;
grant execute on function public.org_cancel_invite(uuid) to authenticated;
grant execute on function public.org_remove_member(uuid, uuid) to authenticated;
grant execute on function public.org_accept_pending_invites() to authenticated;
