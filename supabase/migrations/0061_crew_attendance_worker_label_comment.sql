-- workers jsonb: optional person label (Majster / Uczeń / free text).

comment on column public.construction_crew_attendance.workers is
  'Array of {id, startTime, endTime, label?, projectId?} — label = person description; projectId optional override before split.';
