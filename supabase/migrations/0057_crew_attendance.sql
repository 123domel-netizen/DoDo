-- Crew attendance (RH) + heavy equipment logs for construction schedules.

-- ---------------------------------------------------------------------------
-- Daily declaration: one row per (crew, project, day)
-- ---------------------------------------------------------------------------
create table if not exists public.construction_crew_attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  crew_id uuid not null references public.construction_crews (id) on delete cascade,
  project_id uuid not null references public.construction_projects (id) on delete cascade,
  work_date date not null,
  headcount int not null default 0 check (headcount >= 0),
  labor_hours numeric(8, 2) not null default 0 check (labor_hours >= 0),
  status text not null default 'declared'
    check (status in ('declared', 'confirmed')),
  note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crew_id, project_id, work_date)
);

create index if not exists construction_crew_attendance_org_date_idx
  on public.construction_crew_attendance (org_id, work_date);

create index if not exists construction_crew_attendance_project_date_idx
  on public.construction_crew_attendance (project_id, work_date);

-- ---------------------------------------------------------------------------
-- Equipment lines (N per attendance)
-- ---------------------------------------------------------------------------
create table if not exists public.construction_crew_equipment_logs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null
    references public.construction_crew_attendance (id) on delete cascade,
  equipment_key text not null,
  equipment_label text not null default '',
  quantity int not null default 1 check (quantity >= 0),
  hours numeric(8, 2) not null default 0 check (hours >= 0)
);

create index if not exists construction_crew_equipment_logs_attendance_idx
  on public.construction_crew_equipment_logs (attendance_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.construction_crew_attendance enable row level security;
alter table public.construction_crew_equipment_logs enable row level security;

drop policy if exists "crew attendance all" on public.construction_crew_attendance;
create policy "crew attendance all" on public.construction_crew_attendance
  for all using (public.is_construction_project_member(project_id))
  with check (public.is_construction_project_member(project_id));

drop policy if exists "crew equipment logs all" on public.construction_crew_equipment_logs;
create policy "crew equipment logs all" on public.construction_crew_equipment_logs
  for all using (
    exists (
      select 1
      from public.construction_crew_attendance a
      where a.id = attendance_id
        and public.is_construction_project_member(a.project_id)
    )
  )
  with check (
    exists (
      select 1
      from public.construction_crew_attendance a
      where a.id = attendance_id
        and public.is_construction_project_member(a.project_id)
    )
  );

grant select, insert, update, delete on public.construction_crew_attendance to authenticated;
grant select, insert, update, delete on public.construction_crew_equipment_logs to authenticated;
