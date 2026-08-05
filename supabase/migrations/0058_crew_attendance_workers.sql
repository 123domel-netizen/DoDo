-- Per-person shifts on crew attendance (start/end times).
-- Stored as jsonb on attendance so one upsert keeps people + RH in sync.

alter table public.construction_crew_attendance
  add column if not exists workers jsonb not null default '[]'::jsonb;

comment on column public.construction_crew_attendance.workers is
  'Array of {id, startTime, endTime} HH:mm half-hour slots per person on site.';
