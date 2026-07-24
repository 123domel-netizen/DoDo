-- Harmonogram przypomnień: co minutę wywołuje Edge Function `send-reminders`.
-- Wymaga rozszerzeń pg_cron i pg_net (Supabase: Database -> Extensions -> włącz).
--
-- PRZED URUCHOMIENIEM podmień:
--   <PROJECT_REF> -> ref projektu (np. mutxxlnhxripsvjndgyr)
-- Funkcja ma verify_jwt=false — Authorization nie jest wymagane.
--
-- Diagnostyka:
--   select jobid, jobname, schedule, command from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   POST https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders  → {"ok":true,"sent":N}
--   select * from reminder_log order by fire_at desc limit 20;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Usuń poprzedni harmonogram o tej nazwie (jeśli istnieje).
select cron.unschedule('send-reminders-every-minute')
where exists (select 1 from cron.job where jobname = 'send-reminders-every-minute');

select cron.schedule(
  'send-reminders-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);
