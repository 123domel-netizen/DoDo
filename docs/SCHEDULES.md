# Harmonogramy

Moduł budów w DoDo — UI z preview, dane lokalne (DEV) lub Supabase (flaga org).

## Widoczność

Zakładka **Harmonogramy** jest zawsze w UI.

| Dane | Warunek |
|------|---------|
| LocalAdapter (przeglądarka) | domyślnie; DEV i produkcja bez flagi org |
| Supabase (wspólne dla zespołu) | `orgs.schedules_enabled = true` + migracja `0054` |
| sandbox preview | `VITE_PROJECTS_PREVIEW=1` |

## Co jest / czego nie ma

**Jest:** Tablica, Zdarzenia, Budowy, Brygady, Katalog czynności, preset „Wypełnij harmonogram z katalogu”, podpowiedzi w Dziś.

**Nie ma:** użytkowników demo, przykładowych budów, „Podgląd jako”, resetu demo, eksportu JSON.

## Adaptery

- Port: `src/lib/schedules/scheduleRepositoryPort.ts`
- Local: `LocalPreviewAdapter` — klucz `dodo-schedules-local-v1` (nie ładuje starych demo z v7)
- Cloud: `SupabaseScheduleRepository` + migracja `0054_schedules.sql`

## Włączenie cloud

1. Migracja `0054_schedules.sql`
2. Ustawienia → Zespół → Harmonogramy budów
