-- Harmonogram przypomnień: co minutę wywołuje Edge Function `send-reminders`.
-- Wymaga rozszerzeń pg_cron i pg_net (Supabase: Database -> Extensions -> włącz).
--
-- PRZED URUCHOMIENIEM podmień:
--   <PROJECT_REF>      -> ref Twojego projektu (np. abcdxyz)
--   <SERVICE_ROLE_KEY> -> Service Role key (Settings -> API)
-- Najlepiej trzymać klucz w Vault zamiast wpisywać go na stałe.

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
    url     := 'https://<PROJECT_REF>.functions.supabase.co/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
