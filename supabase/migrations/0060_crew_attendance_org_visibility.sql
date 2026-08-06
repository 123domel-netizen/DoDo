-- Obecność / RH: widoczność jak brygady — wszyscy członkowie org (nie tylko
-- uczestnicy konkretnej budowy). Wcześniej RLS przez
-- is_construction_project_member(project_id) ukrywało wpisy kolegom spoza budowy.

drop policy if exists "crew attendance all" on public.construction_crew_attendance;
create policy "crew attendance all" on public.construction_crew_attendance
  for all using (public.is_org_member(org_id) or public.is_app_admin())
  with check (public.is_org_member(org_id) or public.is_app_admin());

drop policy if exists "crew equipment logs all" on public.construction_crew_equipment_logs;
create policy "crew equipment logs all" on public.construction_crew_equipment_logs
  for all using (
    exists (
      select 1
      from public.construction_crew_attendance a
      where a.id = attendance_id
        and (public.is_org_member(a.org_id) or public.is_app_admin())
    )
  )
  with check (
    exists (
      select 1
      from public.construction_crew_attendance a
      where a.id = attendance_id
        and (public.is_org_member(a.org_id) or public.is_app_admin())
    )
  );
