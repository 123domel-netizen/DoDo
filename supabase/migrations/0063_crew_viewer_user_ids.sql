-- Ograniczona widoczność brygady (+ obecności): pusta lista = cała org.

alter table public.construction_crews
  add column if not exists viewer_user_ids uuid[] not null default '{}';

comment on column public.construction_crews.viewer_user_ids is
  'Empty = visible to all org members. Non-empty = only these user ids (plus app admin).';

create or replace function public.is_construction_crew_visible(p_crew_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.construction_crews c
    where c.id = p_crew_id
      and (
        public.is_app_admin()
        or (
          public.is_org_member(c.org_id)
          and (
            cardinality(c.viewer_user_ids) = 0
            or auth.uid() = any (c.viewer_user_ids)
          )
        )
      )
  );
$$;

revoke all on function public.is_construction_crew_visible(uuid) from public;
grant execute on function public.is_construction_crew_visible(uuid) to authenticated;

-- SELECT: tylko osoby z dostępem. WRITE: nadal cała org (żeby dało się naprawić ACL).
drop policy if exists "construction crews select" on public.construction_crews;
create policy "construction crews select" on public.construction_crews
  for select using (
    public.is_app_admin()
    or (
      public.is_org_member(org_id)
      and (
        cardinality(viewer_user_ids) = 0
        or auth.uid() = any (viewer_user_ids)
      )
    )
  );

drop policy if exists "crew attendance all" on public.construction_crew_attendance;
create policy "crew attendance all" on public.construction_crew_attendance
  for all using (
    public.is_app_admin()
    or (
      public.is_org_member(org_id)
      and public.is_construction_crew_visible(crew_id)
    )
  )
  with check (
    public.is_app_admin()
    or (
      public.is_org_member(org_id)
      and public.is_construction_crew_visible(crew_id)
    )
  );

drop policy if exists "crew equipment logs all" on public.construction_crew_equipment_logs;
create policy "crew equipment logs all" on public.construction_crew_equipment_logs
  for all using (
    exists (
      select 1
      from public.construction_crew_attendance a
      where a.id = attendance_id
        and (
          public.is_app_admin()
          or (
            public.is_org_member(a.org_id)
            and public.is_construction_crew_visible(a.crew_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.construction_crew_attendance a
      where a.id = attendance_id
        and (
          public.is_app_admin()
          or (
            public.is_org_member(a.org_id)
            and public.is_construction_crew_visible(a.crew_id)
          )
        )
    )
  );
