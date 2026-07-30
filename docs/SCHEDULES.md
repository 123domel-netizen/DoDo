# Harmonogramy

Moduł budów w DoDo — UI z preview, dane lokalne (DEV) lub Supabase (flaga org).

## Widoczność

Zakładka **Harmonogramy** jest zawsze w UI.

| Dane | Warunek |
|------|---------|
| Supabase (wspólne dla zespołu) | zalogowany użytkownik + aktywna org + migracja `0054` |
| LocalAdapter (przeglądarka) | brak sesji / sandbox `VITE_PROJECTS_PREVIEW=1` / brak cloud config |

## Adaptery

- Port: `src/lib/schedules/scheduleRepositoryPort.ts`
- Local: `LocalPreviewAdapter` — klucz `dodo-schedules-local-v1`
- Cloud: `SupabaseScheduleRepository` + migracja `0054_schedules.sql`

## Włączenie cloud

1. Migracja `0054_schedules.sql` na remote (`supabase db push`)
2. Zaloguj się — Harmonogramy zapisują się w Supabase dla aktywnej org
