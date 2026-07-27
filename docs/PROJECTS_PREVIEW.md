# PROJECTS PREVIEW — lekki moduł Projektów (prototyp UX)

## Cel

Interaktywny prototyp do oceny:

- lekkich projektów (`#114 Nazwa`),
- oznaczania projektu w czacie (sandbox),
- czynności Nadzoru budowy + kolejki „Do wpisania”,
- prostego planera ekip dla Budowy.

**Nie jest to wdrożenie produkcyjne.**

## Izolacja

| Element | Zachowanie |
|---------|------------|
| Flaga | `VITE_PROJECTS_PREVIEW=1` (build mode `projects-preview`) |
| Dane | wyłącznie `localStorage` klucz `dodo-projects-preview-v1` |
| Adapter | `ProjectsPreviewRepository` — zero Supabase / Graph / R2 / sync |
| Czat # | sandbox w module preview — **nie** zmienia produkcyjnego MessageComposer ani tabeli `messages` |
| Branch | `feature/projects-preview` |
| Deploy | osobny branch Pages `projects-preview` — **nie** zmienia aliasu `dodo-c39.pages.dev` |

Produkcyjny build **bez** flagi:

- nie pokazuje pozycji „Projekty”,
- nie ładuje chunka preview,
- nie rejestruje adaptera.

## Uruchomienie lokalne

```bash
# z flagą (Vite mode ładuje .env.projects-preview)
npx vite --mode projects-preview
```

Albo:

```bash
# PowerShell
$env:VITE_PROJECTS_PREVIEW="1"; npm run dev
```

## Build i deploy preview

```bash
npm run build:projects-preview
npm run deploy:projects-preview
```

`deploy:projects-preview` **nie** wywołuje `release:sync` i używa `--branch projects-preview`.

## Dane demonstracyjne

Przykładowe projekty: `#114`, `#115`, `#121`, `#130`.

Menu ⋮ w module:

- **Resetuj dane demonstracyjne** — przywraca seed
- **Wczytaj przykładowe projekty** — dokłada seed
- **Eksportuj dane preview do JSON** — tylko do oceny prototypu

„Podgląd jako” — przełączanie syntetycznych użytkowników (widoczność uczestników).

## Zakres zaimplementowany

- lista / filtry / wyszukiwanie (PL bez ogonków),
- dodawanie pojedyncze + bulk A/B,
- widoczność tylko uczestników,
- sandbox czat z pickerem `#` i chipami,
- Nadzór: checklista, stany, „Do wpisania”,
- katalog preset „Nadzór budowy - podstawowy”,
- Budowa: planer (projekt / wszystkie / ekipy), konflikty ekip (ostrzeżenie),
- symulacja „Utwórz zadanie / wydarzenie” (bez zapisu do store produkcyjnego),
- UX mobilny (fullscreen, collapsible kategorie, sheet edycji bloku).

## Niezaimplementowane (świadomie)

- migracje SQL / RLS / sync,
- produkcyjny push i powiadomienia,
- osobny czat projektu,
- automatyczne tworzenie realnych Zadań/Wydarzeń,
- galerie/pliki projektowe,
- pełny Gantt / zależności,
- dziennik budowy / integracje zewnętrzne.

## Kryteria akceptacji

1. Lista projektów jest lekka.
2. `#114` w sandbox czacie porządkuje komunikację.
3. Bulk pozwala szybko założyć projekty.
4. Czynności Nadzoru + „Do wpisania” są praktyczne.
5. Planer Budów układa ekipy bez pełnego Gantta.
6. Produkcyjny Czat / Zadania / Kalendarz bez zmian zachowania (bez flagi).
7. Mobile jest używalne.

## Reset danych

W module: ⋮ → Resetuj dane demonstracyjne  
Lub w DevTools: `localStorage.removeItem('dodo-projects-preview-v1')`

## Całkowite odrzucenie preview

1. Usuń branch `feature/projects-preview` (lokalnie i remote, jeśli był push).
2. Usuń deployment Cloudflare Pages dla brancha `projects-preview`.
3. Usuń lokalny klucz `dodo-projects-preview-v1`.
4. **Brak** migracji do cofania — nic nie trafiło do produkcyjnego Supabase.
5. Alias produkcyjny Pages pozostaje nietknięty.

## Szkic modelu (tylko dokumentacja — bez migracji)

```
projects(id, org_id, number, name, kind, admin_user_id, status, created_at)
project_members(project_id, user_id)
message_entity_refs(message_id, entity_type, entity_id, label_snapshot)  -- przyszłość
supervision_items(...)
schedule_blocks(...)
```

Po akceptacji preview: istniejące Zadania/Wydarzenia DoDo, bez kopii projektowych.

## Akceptacja produkcyjna

Wdrożenie produkcyjne **tylko** po jednoznacznym poleceniu:

> „Akceptuję PROJECTS PREVIEW i przechodzimy do implementacji produkcyjnej”
