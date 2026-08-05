-- Optional note only; project overrides live in the UI and are split into
-- separate attendance rows (unique crew+project+day) on save.
-- Workers jsonb may include optional projectId for mid-edit drafts / legacy.

comment on column public.construction_crew_attendance.workers is
  'Array of {id, startTime, endTime, projectId?} — projectId optional override; usually split into separate attendance rows per project.';
