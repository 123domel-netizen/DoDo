# Harmonogramy

Moduł budów w DoDo — UI z preview, dane lokalne (DEV) lub Supabase (flaga org).

## Widoczność

Zakładka **Harmonogramy** jest zawsze w UI.

| Dane | Warunek |
|------|---------|
| Supabase (wspólne dla zespołu) | zalogowany użytkownik + aktywna org + migracje `0054` + `0057` + `0058` |
| LocalAdapter (przeglądarka) | brak sesji / sandbox `VITE_PROJECTS_PREVIEW=1` / brak cloud config |

## Adaptery

- Port: `src/lib/schedules/scheduleRepositoryPort.ts`
- Local: `LocalPreviewAdapter` — klucz `dodo-schedules-local-v1`
- Cloud: `SupabaseScheduleRepository` + migracje `0054_schedules.sql`, `0057_crew_attendance.sql`, `0058_crew_attendance_workers.sql`

## Obecność / RH

Zakładka **Obecność** (obok Brygady):

- Wpis z listy Brygad (klik wiersza): brygada + budowa + dzień → osoby (wiersze start/koniec co 30 min), RH z sumy, sprzęt ciężki
- Domyślne godziny z poprzedniego wpisu firmy; bez historii: 07:00–15:00
- Zakresy: **1** (lista mobilna), **5** (pn–pt), **11** dni, **M** (miesiąc) — jedna brygada = jeden wiersz (osoby + sprzęt w komórce; firma jako podpis)
- Potwierdzenie oświadczeń z komórki / wiersza (`declared` → `confirmed`)

Tabele: `construction_crew_attendance` (+ `workers` jsonb, migracja `0058`), `construction_crew_equipment_logs`.

## Włączenie cloud

1. Migracje `0054`, `0057`, `0058` na remote (`supabase db push`) — bez `0057` obecność **nie zapisuje się w chmurze** (wpis miga i znika po reload).
2. Zaloguj się — Harmonogramy zapisują się w Supabase dla aktywnej org
