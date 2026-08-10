-- Roster of people on a construction crew (for attendance quick-picks).

alter table public.construction_crews
  add column if not exists members jsonb not null default '[]'::jsonb;

comment on column public.construction_crews.members is
  'Array of {id, name, pinAttendance} — pinAttendance = show in attendance form quick-picks.';
