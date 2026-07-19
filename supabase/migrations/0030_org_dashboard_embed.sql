-- Dashboard embed URL per org (admin zespołu ustawia; członkowie widzą).

alter table public.orgs
  add column if not exists dashboard_embed_url text;

-- org_my_orgs: dodajemy kolumnę → trzeba drop + recreate
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
  dashboard_embed_url text
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
    o.dashboard_embed_url
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
    'dashboardEmbedUrl', o.dashboard_embed_url,
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

create or replace function public.org_set_dashboard_embed(p_org_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if not (public.is_org_admin(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;

  cleaned := nullif(trim(coalesce(p_url, '')), '');
  if cleaned is null then
    update public.orgs set dashboard_embed_url = null where id = p_org_id;
    return;
  end if;

  if cleaned !~* '^https://' then
    raise exception 'invalid dashboard url';
  end if;

  -- Basic length guard
  if char_length(cleaned) > 2000 then
    raise exception 'invalid dashboard url';
  end if;

  update public.orgs set dashboard_embed_url = cleaned where id = p_org_id;
end;
$$;

grant execute on function public.org_my_orgs() to authenticated;
grant execute on function public.org_get_detail(uuid) to authenticated;
grant execute on function public.org_set_dashboard_embed(uuid, text) to authenticated;
