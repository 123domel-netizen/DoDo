-- Synchronizacja grup między urządzeniami.
-- Dotąd grupy żyły wyłącznie lokalnie (IndexedDB per urządzenie), więc na telefonie
-- i na komputerze były różne i „resetowały się". Klient (src/lib/cloud.ts) synchronizuje
-- teraz tabelę `groups` tak samo jak `items`. Te kolumny przechowują pola, których
-- wcześniej nie było w schemacie.
--
-- Uruchom w Supabase: SQL Editor -> wklej i Run, albo `supabase db push`.

alter table public.groups add column if not exists system        text;
alter table public.groups add column if not exists hide_from_all boolean not null default false;
alter table public.groups add column if not exists updated_at     timestamptz not null default now();

-- auto-aktualizacja updated_at (funkcja public.touch_updated_at zdefiniowana w 0001)
drop trigger if exists groups_touch on public.groups;
create trigger groups_touch before update on public.groups
  for each row execute function public.touch_updated_at();
