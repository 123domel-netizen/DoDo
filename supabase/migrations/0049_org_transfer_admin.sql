-- Admin zespołu może przekazać rolę admina innemu członkowi (1 admin na org).

create or replace function public.org_transfer_admin(
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not (public.is_org_admin(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;

  perform 1 from public.orgs where id = p_org_id for update;
  if not found then raise exception 'org not found'; end if;

  select user_id into old_admin
  from public.org_members
  where org_id = p_org_id and role = 'admin';

  if old_admin is null then
    raise exception 'org admin missing';
  end if;

  if old_admin = p_new_admin_user_id then
    return;
  end if;

  -- Org admin (nie app_admin) może przekazać tylko swoją rolę.
  if not public.is_app_admin() and old_admin <> auth.uid() then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_new_admin_user_id
  ) then
    raise exception 'member not found';
  end if;

  update public.org_members set role = 'member'
  where org_id = p_org_id and user_id = old_admin;

  update public.org_members set role = 'admin'
  where org_id = p_org_id and user_id = p_new_admin_user_id;

  perform public.org_audit(p_org_id, 'admin_transferred', jsonb_build_object(
    'from_user_id', old_admin,
    'to_user_id', p_new_admin_user_id
  ));
end;
$$;

grant execute on function public.org_transfer_admin(uuid, uuid) to authenticated;
