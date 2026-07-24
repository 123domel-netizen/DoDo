-- Admin zespołu może ustawić display_name członka (profiles — globalna nazwa w czacie).
-- Własną nazwę użytkownik zmienia bezpośrednio przez RLS (profiles update own).

create or replace function public.org_set_member_display_name(
  p_org_id uuid,
  p_user_id uuid,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not (public.is_org_admin(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id
  ) then
    raise exception 'member not found';
  end if;

  v_name := nullif(trim(both from coalesce(p_display_name, '')), '');
  if v_name is null or char_length(v_name) > 80 then
    raise exception 'invalid display name';
  end if;

  update public.profiles
  set display_name = v_name
  where user_id = p_user_id;

  if not found then
    insert into public.profiles (user_id, display_name)
    values (p_user_id, v_name);
  end if;

  perform public.org_audit(
    p_org_id,
    'member_display_name_set',
    jsonb_build_object('user_id', p_user_id, 'display_name', v_name)
  );
end;
$$;

grant execute on function public.org_set_member_display_name(uuid, uuid, text) to authenticated;
