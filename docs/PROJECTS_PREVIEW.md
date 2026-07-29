# HARMONOGRAMY PREVIEW — lekki moduł planowania budów (prototyp UX)

## Cel

Interaktywny prototyp do oceny:

- lekkich budów (`#114 Nazwa`) — jedna budowa = jeden harmonogram,
- tablicy harmonogramu (brygady, podkategorie, roboty),
- zdarzeń na osi czasu (**budowlane** i **dokumentacyjne**) oraz kolejki „Do wpisania”.

**Nie jest to wdrożenie produkcyjne.**

Flaga i nazwy techniczne pozostają historyczne (`VITE_PROJECTS_PREVIEW`,
katalog `projectsPreview`), natomiast cały UI mówi **Harmonogramy**.

## Zakres modelu

Budowa nie ma rodzajów (`kind`), nie ma zakładki Wiadomości i nie ma osobnego
widoku Nadzoru. Relacja jest 1:1: **budowa ↔ harmonogram**, więc otwarcie budowy
to po prostu tablica zawężona do tej budowy.

Zdarzenia są jednym typem (`ScheduleEvent`) z dwoma rodzajami:

| Rodzaj | Znaczenie | Znacznik na osi |
|--------|-----------|-----------------|
| `budowlane` | logistyka i fakty z placu (dźwig, dostawa, przerwa) | ⚡ |
| `dokumentacyjne` | to, co idzie do dziennika budowy / nadzoru | kropka w kolorze statusu |

Status (`DocEventStatus`) dotyczy tylko zdarzeń dokumentacyjnych:
`do_sprawdzenia` · `do_wpisania` · `wpisane` · `nie_dotyczy`.
**„Do wpisania” = zdarzenie dokumentacyjne ze statusem `do_wpisania`** — to jedyne
źródło licznika w nagłówku modułu.

Zdarzenie umieszczane jest przede wszystkim w **kategorii** (`categoryId`) —
na tablicy pojawia się w wierszu tej kategorii. Opcjonalnie można je dodatkowo
powiązać z podkategorią lub robotą (`blockId`); wtedy marker jest też na wierszu
tego bloku. Bez `blockId` zdarzenie żyje wyłącznie na wierszu kategorii
(nie ma osobnego wiersza „Bez roboty”).

`crewId` na robocie może być pusty (`""`) — robota bez przypisanej brygady jest
poprawna.

## Nagłówek modułu (dwa rzędy)

Chrome modułu ma stałą wysokość i nigdy się nie zawija:

- **Rząd 1** (stały): `X` (zamyka moduł) · sekcje **Tablica** · **Zdarzenia** ·
  **Lista** · **Brygady** · plakietka **Do wpisania** (otwiera panel kolejki) · menu `⋮`.
- **Rząd 2** (kontekst bieżącej sekcji):
  - Tablica (zbiorczo): **Filtr budów** (rząd 1, po X) · **Wg budów / Wg brygad**,
    pasek narzędzi tablicy (zoom, Dziś, +Zdarzenie, +Robota),
  - Tablica (budowa): `←`, `#N Nazwa` (klik → edycja budowy), pasek narzędzi tablicy
    (filtr budów w rzędzie 1 jest wtedy nieaktywny),
  - Zdarzenia: **Budowlane / Dokumentacyjne** (tabela, zawężona filtrem budów),
  - Lista: **Aktywne / Archiwum**, licznik budów, **Import**, **+ Budowa**,
  - Brygady: licznik brygad, **+ Brygada**,
  - Katalog: `←` + tytuł.

`Esc`: zamyka panel kolejki → zamyka menu → wraca z katalogu → zdejmuje zawężenie
do budowy → zamyka moduł.

Klik w budowę na liście przechodzi na **Tablicę zawężoną do tej budowy**.

## Panel „Do wpisania”

Plakietka w rzędzie 1 otwiera panel (slide-over) z listą zdarzeń dokumentacyjnych
o statusie `do_wpisania` ze wszystkich widocznych budów, od najstarszej daty.
W panelu można:

- oznaczyć wpis jako **wpisane** (jedno kliknięcie),
- **pokazać w harmonogramie** — panel zamyka się, tablica zawęża do budowy,
  przewija do daty zdarzenia i podświetla robotę.

## Izolacja

| Element | Zachowanie |
|---------|------------|
| Flaga | `VITE_PROJECTS_PREVIEW=1` (build mode `projects-preview`) |
| Dane | wyłącznie `localStorage` klucz `dodo-projects-preview-v7` (starsze `-v6`, `-v5` wczytywane raz przy migracji) |
| Adapter | `ProjectsPreviewRepository` — zero Supabase / Graph / R2 / sync |
| Czat | brak — ani sandbox czatu, ani placeholdera wiadomości |
| Branch | `feature/projects-preview` |
| Deploy | osobny branch Pages `projects-preview` — **nie** zmienia aliasu `dodo-c39.pages.dev` |

Produkcyjny build **bez** flagi:

- nie pokazuje pozycji „Harmonogramy”,
- nie ładuje chunka preview,
- nie rejestruje adaptera.

## Migracja danych (v5 → v6 → v7)

`v7` scala dwie listy w jedną:

- `supervisionItems` → `scheduleEvents` z `kind: "dokumentacyjne"`
  (`title` = `customLabel || activity`, `date` = `noticedAt || writtenAt || dziś`,
  status `brak` → `do_sprawdzenia`),
- stare `scheduleEvents` (logistyka bez pola `kind`) → `kind: "budowlane"`.

Repozytorium czyta `v7`, a jeśli nie ma — `v6`, potem `v5`, migruje i zapisuje
z powrotem pod kluczem `v7`. Stare klucze nie są usuwane.

Usunięcie roboty: zdarzenia **budowlane** podpięte pod nią są usuwane razem z nią,
zdarzenia **dokumentacyjne** zostają i tracą `blockId` (zostają na wierszu kategorii).

## Uruchomienie lokalne

```bash
npm run dev:projects-preview
```

Ładuje `.env.projects-preview` (`VITE_PROJECTS_PREVIEW=1`). Zwykle: http://localhost:5173

Alternatywy: `npx vite --mode projects-preview` albo PowerShell `$env:VITE_PROJECTS_PREVIEW="1"; npm run dev`.

Google OAuth na localhost działa, gdy w Supabase Redirect URLs jest `http://localhost:5173/**` (już w `config.toml`).

## Logowanie Google na preview (ważne)

Aplikacja wysyła `redirectTo` = bieżący origin (`https://projects-preview.dodo-c39.pages.dev/`).

Jeśli ten URL **nie** jest na liście **Additional Redirect URLs** w Supabase Auth,
GoTrue odrzuca go i wraca na **Site URL** = produkcja (`https://dodo-c39.pages.dev`).

**Site URL zostaje produkcyjny** — nie zmieniać.

W Dashboard: Authentication → URL Configuration → Redirect URLs, dodaj:

- `https://projects-preview.dodo-c39.pages.dev`
- `https://projects-preview.dodo-c39.pages.dev/**`

Lokalna kopia: [`supabase/config.toml`](../supabase/config.toml) (`additional_redirect_urls`).

## Build i deploy preview

```bash
npm run build:projects-preview
npm run deploy:projects-preview
```

`deploy:projects-preview` **nie** wywołuje `release:sync` i używa `--branch projects-preview`.

## Dane demonstracyjne

Przykładowe budowy: `#114`, `#115`, `#121` oraz `#140` (celowo bez harmonogramu
i bez zdarzeń — pokazuje zimny start).

Menu ⋮ w module:

- **Edytuj budowę** — tylko przy zawężeniu do budowy i tylko dla administratora
- **Resetuj dane demonstracyjne** — przywraca seed
- **Wczytaj przykładowe projekty** — dokłada seed
- **Eksportuj dane preview do JSON** — tylko do oceny prototypu
- **Katalog czynności** — wraca dokładnie do widoku, z którego został otwarty

„Podgląd jako” — w menu ⋮, przełączanie syntetycznych użytkowników (widoczność uczestników).

## Zakres zaimplementowany

- **Tablica** (`ScheduleTab`) jako główny widok: zbiorczo (wybrane budowy) albo
  zawężona do jednej budowy, grupowanie **Wg budów / Wg brygad**, **zoom osi**
  (presety 2 tyg. → 2 lata + Dopasuj, Ctrl/Cmd+scroll; dzień pozostaje jednostką
  snapa, `dayPx` skaluje widok, nagłówek przełącza ticki dzień/tydzień/miesiąc/kwartał),
  przycisk **Dziś**, klikalny licznik konfliktów brygad z listą par,
- podkategorie z oknem terminów i pracami potomnymi (overflow poza oknem =
  ostrzeżenie + szary fragment), status na pasku (wstrzymane = kreskowanie,
  zakończone = wygaszenie + ptaszek), przeciąganie i zmiana długości pasków,
- **Tablica** zawsze pokazuje pełny harmonogram (roboty + ⚡ budowlane + niebieskie
  kropki dokumentacyjne). Tabele zdarzeń są w sekcji **Zdarzenia**
  (`Budowlane` / `Dokumentacyjne`). Kolejka „Do wpisania” tylko z plakietki w nagłówku,
  jeden wspólny arkusz `ScheduleEventSheet` (najpierw rodzaj, dla dokumentacyjnych
  czynność z katalogu + status), znaczniki respektują filtr i minimalną gęstość osi,
  wiersz „Bez roboty” dla zdarzeń luźnych,
- **pusty plan** → panel „Dodaj pierwszą robotę” / „Szablon etapów” / „Dodaj brygadę”;
  budowa bez planu jest nadal widoczna w widoku zbiorczym,
- **Lista** budów: kolumny **Numer / Nazwa / Etap / Termin / Do wpisania / Ostatnie**,
  filtry numeru i nazwy w nagłówku tabeli, przełącznik **Aktywne / Archiwum**
  (domyślnie tylko aktywne), dodawanie pojedyncze + import zbiorczy
  (`114 Vestino` lub `114; Vestino`),
- **Brygady**: lista brygad z liczebnością, firmą, kierownikiem, telefonem,
  liczbą przypisanych robót i liczbą konfliktów; dodawanie, edycja i usuwanie
  (`CrewEditorSheet` wspólny z tablicą),
- **Panel „Do wpisania”** z oznaczaniem jako wpisane i przeskokiem na tablicę,
- katalog preset „Nadzór budowy - podstawowy” (czynności dokumentacyjne),
- widoczność tylko uczestników,
- UX desktop: moduł w głównym canvasie (obok Przeglądu / widoków kalendarza), nie fullscreen,
- UX mobilny (tab + overlay, arkusze edycji roboty, zdarzenia i brygady).

## Niezaimplementowane (świadomie)

- migracje SQL / RLS / sync,
- produkcyjny push i powiadomienia,
- jakiekolwiek wiązanie z czatem aplikacji (`#N`, `message_entity_refs`, feed
  wiadomości w projekcie) — poza zakresem tej iteracji,
- osobny czat projektu (świadomie nieplanowane — wystarczy czat aplikacji),
- rodzaje projektów inne niż Budowa,
- automatyczne tworzenie realnych Zadań/Wydarzeń (symulacja została usunięta),
- osobny widok „Przegląd budowy” — zastąpiony tablicą zawężoną do budowy
  (sekcja **Zdarzenia** to tabele rodzajów, nie osobna chronologia budowy),
- galerie/pliki projektowe,
- pełny Gantt / zależności,
- dziennik budowy / integracje zewnętrzne.

## Kryteria akceptacji

1. Lista budów mieści etap, termin i zaległości „do wpisania” bez wchodzenia w budowę.
2. Bulk pozwala szybko założyć budowy.
3. Zdarzenia dokumentacyjne + kolejka „Do wpisania” są praktyczne (dodanie, edycja, oznaczenie).
4. Tablica układa brygady bez pełnego Gantta, a pusta budowa ma sensowny start.
5. Przeskok z kolejki na tablicę trafia w budowę, datę i robotę.
6. Produkcyjny Czat / Zadania / Kalendarz bez zmian zachowania (bez flagi).
7. Mobile jest używalne.

## Reset danych

W module: ⋮ → Resetuj dane demonstracyjne  
Lub w DevTools: `localStorage.removeItem('dodo-projects-preview-v7')`

## Całkowite odrzucenie preview

1. Usuń branch `feature/projects-preview` (lokalnie i remote, jeśli był push).
2. Usuń deployment Cloudflare Pages dla brancha `projects-preview`.
3. Usuń lokalne klucze `dodo-projects-preview-v7`, `-v6` i `-v5`.
4. **Brak** migracji do cofania — nic nie trafiło do produkcyjnego Supabase.
5. Alias produkcyjny Pages pozostaje nietknięty.

## Szkic modelu (tylko dokumentacja — bez migracji)

```
projects(id, org_id, number, name, admin_user_id, status, created_at)   -- bez kind: zawsze budowa
project_members(project_id, user_id)
crews(...)
schedule_blocks(..., crew_id nullable/empty)
schedule_events(id, project_id, block_id nullable, kind, title, date, note,
                status, category_id, activity, custom_label,
                written_at, reported_by_user_id, written_by_user_id)
```

Po akceptacji preview: istniejące Zadania/Wydarzenia DoDo, bez kopii projektowych.

## Akceptacja produkcyjna

Wdrożenie produkcyjne **tylko** po jednoznacznym poleceniu:

> „Akceptuję HARMONOGRAMY PREVIEW i przechodzimy do implementacji produkcyjnej”
