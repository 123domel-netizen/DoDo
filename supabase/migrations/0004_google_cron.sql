-- Harmonogram synchronizacji Google: co 5 minut + przetwarzanie kolejki
-- Podmień <PROJECT_REF> i <SERVICE_ROLE_KEY> jak w 0002_cron.sql

select cron.unschedule('google-sync-every-five-minutes')
where exists (select 1 from cron.job where jobname = 'google-sync-every-five-minutes');

select cron.schedule(
  'google-sync-every-five-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/google-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{"allUsers": true}'::jsonb
  );
  $$
);

-- Czyszczenie wygasłych stanów OAuth (co godzinę)
select cron.unschedule('google-oauth-cleanup-hourly')
where exists (select 1 from cron.job where jobname = 'google-oauth-cleanup-hourly');

select cron.schedule(
  'google-oauth-cleanup-hourly',
  '0 * * * *',
  $$ delete from public.google_oauth_states where expires_at < now(); $$
);
