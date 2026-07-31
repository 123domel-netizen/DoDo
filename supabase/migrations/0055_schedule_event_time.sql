-- Optional wall-clock time for schedule events (date stays date-only).
alter table public.schedule_events
  add column if not exists event_time time without time zone;
