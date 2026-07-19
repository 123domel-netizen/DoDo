-- Wyciszanie kontaktów z zespołu (per użytkownik): ukrywa osobę w pickerze uczestników,
-- nie usuwa z org_members.

create table if not exists public.org_contact_mutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  muted_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id, muted_user_id)
);

create index if not exists org_contact_mutes_org_idx
  on public.org_contact_mutes (org_id, user_id);

alter table public.org_contact_mutes enable row level security;

drop policy if exists "own contact mutes" on public.org_contact_mutes;
create policy "own contact mutes" on public.org_contact_mutes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, delete on public.org_contact_mutes to authenticated;
grant all on public.org_contact_mutes to service_role;

create or replace function public.org_list_contacts(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (public.is_org_member(p_org_id) or public.is_app_admin()) then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', m.user_id,
      'role', m.role,
      'email', u.email,
      'displayName', p.display_name,
      'avatarUrl', p.avatar_url,
      'joinedAt', m.joined_at,
      'muted', exists (
        select 1 from public.org_contact_mutes cm
        where cm.user_id = uid
          and cm.org_id = p_org_id
          and cm.muted_user_id = m.user_id
      )
    ) order by p.display_name nulls last, u.email)
    from public.org_members m
    left join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org_id
      and m.user_id <> uid
  ), '[]'::jsonb);
end;
$$;

create or replace function public.org_set_contact_mute(
  p_org_id uuid,
  p_muted_user_id uuid,
  p_muted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'forbidden';
  end if;
  if p_muted_user_id is null or p_muted_user_id = uid then
    raise exception 'invalid user';
  end if;
  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_muted_user_id
  ) then
    raise exception 'not a member';
  end if;

  if coalesce(p_muted, false) then
    insert into public.org_contact_mutes (user_id, org_id, muted_user_id)
    values (uid, p_org_id, p_muted_user_id)
    on conflict do nothing;
  else
    delete from public.org_contact_mutes
    where user_id = uid and org_id = p_org_id and muted_user_id = p_muted_user_id;
  end if;
end;
$$;

grant execute on function public.org_list_contacts(uuid) to authenticated;
grant execute on function public.org_set_contact_mute(uuid, uuid, boolean) to authenticated;
