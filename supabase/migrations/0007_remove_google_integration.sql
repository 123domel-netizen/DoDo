-- Usunięcie integracji Kalendarz/Zadania Google.
-- Logowanie przez Google (Supabase Auth) NIE jest tym objęte i działa dalej.
--
-- 1) Zatrzymanie serwerowych zadań cron (żeby nic więcej nie importowało).
-- 2) Usunięcie z `items` pozycji zaimportowanych z Google (syncSource=google) —
--    to m.in. rozwinięte cykliczne urodziny/rocznice zaśmiecające bazę.
-- 3) Wyczyszczenie tabel pomocniczych integracji (konta, ustawienia, kolejka,
--    stan sync, mapowania, stany OAuth). Tabele zostają puste — bez DROP, żeby
--    nie wywracać wciąż wdrożonych Edge Functions.

-- 1) Cron --------------------------------------------------------------------
-- Bezpiecznie, nawet gdy pg_cron nie jest włączony (schemat `cron` nie istnieje).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'google-sync-every-five-minutes') then
      perform cron.unschedule('google-sync-every-five-minutes');
    end if;
    if exists (select 1 from cron.job where jobname = 'google-oauth-cleanup-hourly') then
      perform cron.unschedule('google-oauth-cleanup-hourly');
    end if;
  end if;
end $$;

-- 2) Pozycje z Google --------------------------------------------------------
delete from public.items where payload->>'syncSource' = 'google';

-- 3) Tabele pomocnicze (kolejność wg zależności kluczy obcych) ----------------
delete from public.google_sync_queue;
delete from public.item_external_links;
delete from public.google_sync_state;
delete from public.google_sync_settings;
delete from public.google_accounts;
delete from public.google_oauth_states;
