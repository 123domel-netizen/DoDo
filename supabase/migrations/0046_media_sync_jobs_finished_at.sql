-- media_sync_jobs: finished_at for audit/monitoring after Worker marks done/dead.
-- Additive only — does not change Site URL / Pages / org flags.

alter table public.media_sync_jobs
  add column if not exists finished_at timestamptz;

comment on column public.media_sync_jobs.finished_at is
  'Set when state becomes done or dead (permanent failure). Cleared on admin re-queue.';

create index if not exists media_sync_jobs_ref_state_idx
  on public.media_sync_jobs (ref_id, kind, state);
