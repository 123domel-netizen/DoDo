# Harmonogramy

Moduł budów w DoDo — UI z preview, dane lokalne (DEV) lub Supabase (flaga org).

## Widoczność

Zakładka **Harmonogramy** jest zawsze w UI.

| Dane | Warunek |
|------|---------|
| Supabase (wspólne dla zespołu) | zalogowany użytkownik + aktywna org + migracje `0054` + `0057` + `0058` + `0060` + `0062` + `0063` + `0064` |
| LocalAdapter (przeglądarka) | brak sesji / sandbox `VITE_PROJECTS_PREVIEW=1` / brak cloud config |

## Adaptery

- Port: `src/lib/schedules/scheduleRepositoryPort.ts`
- Local: `LocalPreviewAdapter` — klucz `dodo-schedules-local-v1`
- Cloud: `SupabaseScheduleRepository` + migracje `0054_schedules.sql`, `0057_crew_attendance.sql`, `0058_crew_attendance_workers.sql`, `0062_crew_members.sql`, `0063_crew_viewer_user_ids.sql`, `0064_crew_created_by.sql`

## Obecność / RH

Zakładka **Obecność** (obok Brygady):

- Wpis z listy Brygad (klik wiersza): brygada + budowa + dzień → osoby (wiersze start/koniec co 30 min), RH z sumy, sprzęt ciężki
- Domyślne godziny z poprzedniego wpisu firmy; bez historii: 07:00–15:00
- Zakresy: **1** (lista mobilna), **5** (pn–pt), **11** dni, **M** (miesiąc) — jedna brygada = jeden wiersz (osoby + sprzęt w komórce; firma jako podpis)
- Potwierdzenie oświadczeń z komórki / wiersza (`declared` → `confirmed`)

Tabele: `construction_crew_attendance` (+ `workers` jsonb, migracja `0058`), `construction_crew_equipment_logs`.

W `workers`: opcjonalne `label` (Majster / Uczeń / własne imię) — chipy **M** / **U** + free text; opcjonalne `absence` (**U** Urlop / **NU** / **NN** / **W** dzień wolny firmowy) → **0 RH** (w formularzu: ikona przełącza godziny ↔ status); przy nowym dniu kopiowane z poprzedniego wpisu firmy.

**Brygada → osoby:** w edycji brygady lista `members` (`0062`) z flagą **Przypnij obecności**. Przypięci pojawiają się w formularzu obecności jako mini-przyciski **Dodaj {imię}** (gdy jeszcze nie ma takiego labela).

**Widoczność brygady:** `viewer_user_ids` (`0063`) — pusta lista = cały zespół; niepusta = tylko wskazani widzą brygadę i jej obecności. Panel w edycji brygady widzą tylko **twórca** (`created_by` / `0064`) i **admin org**.

**RLS:** członek org widzi i edytuje obecność całej firmy (`0060_crew_attendance_org_visibility.sql`) — wcześniej tylko uczestnik budowy, więc wpisy koleżanki znikały u osób spoza tej budowy. Od `0063` obecność jest dodatkowo ograniczona widocznością brygady.

## Włączenie cloud

1. Migracje `0054`, `0057`, `0058`, `0060`, `0062`, `0063`, `0064` na remote (`supabase db push`) — bez `0057` obecność **nie zapisuje się w chmurze** (wpis miga i znika po reload); bez `0060` obecność widać tylko na budowach, w których jesteś uczestnikiem; bez `0062` lista osób brygady nie zapisze się w chmurze; bez `0063` ograniczenie widoczności brygady nie zapisze się / RLS zostaje bez limitu; bez `0064` twórca brygady nie zapisze się w chmurze.
2. Zaloguj się — Harmonogramy zapisują się w Supabase dla aktywnej org
