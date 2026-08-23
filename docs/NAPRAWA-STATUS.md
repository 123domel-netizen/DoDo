# Program naprawczy DoDo — status realizacji

**Dokumenty źródłowe:** [`audyt23082026.md`](./audyt23082026.md), [`Plannaprawczy23082026.md`](./Plannaprawczy23082026.md)
**Punkt startowy:** commit `a6ea61c`, migracje do `0064`
**Ostatnia aktualizacja:** 23 sierpnia 2026

Ten dokument jest jedynym źródłem prawdy o postępie. Plan naprawczy pozostaje
dokumentem kierunkowym; poniżej odnotowano także **świadome odstępstwa** od
niego wraz z uzasadnieniem.

---

## Etap 1 — ZREALIZOWANY: bezpieczeństwo i powtarzalność

Odpowiada etapom 0–2 planu naprawczego (bramki G0, G1 oraz część G2).

### Co zostało zrobione

| ID | Zakres | Pliki |
|---|---|---|
| SEC-01 | Odebranie `EXECUTE` pięciu niezabezpieczonym funkcjom `SECURITY DEFINER` | `supabase/migrations/0065_revoke_internal_security_definer.sql` |
| SEC-02 | Zbiorcze utwardzenie uprawnień + `ALTER DEFAULT PRIVILEGES` | `supabase/migrations/0066_function_execute_hardening.sql` |
| SEC-02 | Audyt uprawnień uruchamialny na dowolnym środowisku | `supabase/tests/security_definer_grants.sql` |
| SEC-03 | Polityka URL / guard SSRF z obsługą przekierowań | `supabase/functions/_shared/urlPolicy.ts`, `supabase/functions/link-preview/index.ts` |
| SEC-03 | 23 testy regresyjne polityki SSRF | `src/lib/security/urlPolicy.test.ts` |
| SEC-04 | Nagłówki bezpieczeństwa + CSP report-only + cache | `public/_headers` |
| BUILD-01 | Przypięcie wersji Node, `engines`, skrypty `typecheck` / `verify` | `.nvmrc`, `package.json` |
| CI-01 | Workflow z czterema jobami (frontend, worker, guards, database) | `.github/workflows/ci.yml` |
| CI-01 | Statyczne kontrole repozytorium | `scripts/check-repo-guards.mjs` |
| A11Y-01 | Dostępny bazowy `Modal` | `src/components/ui/Modal.tsx` |
| SEC-01 | Test negatywny ekspozycji RPC + kontrola regresji helperów RLS | `scripts/verify-rpc-exposure.mjs` |
| SEC-01 | Przegląd poincydentowy bazy (admini, audyt, ścieżki załączników) | `scripts/audit-security-incident.mjs` |
| SEC-02 | Dowód behawioralny modelu wywołań zagnieżdżonych | `supabase/tests/nested_call_model.sql` |
| DEP-01 | Aktualizacja toolchainu workera — 11 podatności → 0 | `worker/package.json` |
| — | Runbook operacyjny bezpieczeństwa | `docs/SECURITY.md` |
| — | Naprawa błędu typów blokującego build | `src/components/projectsPreview/CrewEditorSheet.tsx` |

### Znalezisko spoza audytu — `ensure_app_admin_by_email`

Pełna inwentaryzacja `pg_proc` (a nie tylko historii migracji) ujawniła funkcję
**groźniejszą niż zgłoszone SEC-01**:

```sql
create or replace function public.ensure_app_admin_by_email(p_email text)
returns void language plpgsql security definer …
  insert into public.app_admins (user_id) values (uid) on conflict do nothing;
```

`SECURITY DEFINER`, zero weryfikacji wywołującego, zero `REVOKE`. Anonimowy
klient mógł wywołać `POST /rest/v1/rpc/ensure_app_admin_by_email` z własnym
adresem e-mail i uzyskać **trwałe uprawnienia administratora aplikacji**.
Helpery Storage pozwalały manipulować plikami; ta funkcja pozwalała przejąć
panel administracyjny. Objęta migracją `0065`.

Przy okazji, poza audytem: `0004_google_cron.sql` zawiera aktywny placeholder
`<SERVICE_ROLE_KEY>` (audyt wskazywał tylko `0002` i `0017`).

### Odstępstwa od planu naprawczego

| Plan | Realizacja | Uzasadnienie |
|---|---|---|
| Migracja `0064_revoke_internal_storage_helpers.sql` | `0065` + `0066` | `0064` był już zajęty przez trwającą pracę nad `crew_created_by`. Historii migracji się nie nadpisuje. |
| Rewokacja tylko dwóch helperów Storage | Pięć funkcji w `0065` + przegląd katalogowy w `0066` | Dwie pozostałe krytyczne funkcje (w tym eskalacja uprawnień) nie były w audycie. Zamykanie połowy wektora nie miałoby sensu. |
| Ręczna lista ~80 sygnatur w `REVOKE`/`GRANT` | Blok `DO` iterujący po `pg_proc` | Lista sygnatur rozjeżdża się przy każdym przedefiniowaniu funkcji z inną liczbą argumentów (a takich przypadków w repo jest kilka, np. `update_shared_item_content`). Sterowanie katalogiem jest samonaprawiające. |
| Regeneracja `package-lock.json` | Lock zostawiony bez zmian, przypięta wersja Node | `npm ci` **działa** na obecnym locku (npm 11.13.0, Node 24.16.0) — problem był środowiskowy, nie w locku. Regeneracja bez powodu wprowadziłaby niekontrolowaną zmianę setek zależności. Prawdziwą przyczyną był brak przypiętego toolchainu i to zostało naprawione. |
| Pin Node `22.22.3` / npm `10.9.8`, pole `packageManager` | `.nvmrc` = `24.16.0`, `engines: node >=22`, bez `packageManager` | Pin do wersji, która realnie działa na maszynie deweloperskiej i w CI. `packageManager` dla npm wymaga Corepacka, który bywa zawodny przy weryfikacji podpisów — `node-version-file` w CI daje ten sam efekt bez dodatkowego punktu awarii. |
| ESLint w etapie 1 | Przesunięty do etapu 2 | Wprowadzenie lintera na 73 tys. linii wygeneruje duży baseline. Nie należy tego mieszać z wdrożeniem hotfixu bezpieczeństwa — plan sam zaleca małe PR-y dla zmian krytycznych. |

### Stan weryfikacji

```
npm ci                        OK
npm run check:guards          OK — 66 migracji
npm run typecheck             OK
npm test                      OK — 28 plików, 332 testy (było 309)
npm run build                 OK
npm run typecheck --prefix worker  OK
npm test --prefix worker           OK — 9 testów
npm audit --omit=dev          0 podatności (aplikacja i worker)
npm run check:rpc-exposure    OK — na produkcji, po wdrożeniu
npm run audit:incident        OK — brak śladów nadużycia
```

### Wdrożenie — 23 sierpnia 2026

1. [x] **`supabase db push` na produkcji** — projekt `mutxxlnhxripsvjndgyr`,
       migracje `0065` i `0066` zastosowane, wbudowane bramki weryfikacyjne
       przeszły. Środowiska preview: patrz „Pozostało ręcznie" niżej.
2. [x] **Weryfikacja negatywna jako `anon`** — zautomatyzowana skryptem
       `npm run check:rpc-exposure`.

   **Pomiar przed wdrożeniem potwierdził, że luka była realnie
   wykorzystywalna na produkcji.** Wszystkie pięć funkcji odpowiedziało
   wykonaniem: `ensure_app_admin_by_email` → `204`, helpery Storage → `200`,
   `org_audit` → `409` z naruszeniem klucza obcego (czyli `INSERT` się wykonał).
   Po wdrożeniu wszystkie zwracają `42501 permission denied`.

3. [x] **Kontrola regresji** (poza pierwotną listą) — jedenaście helperów RLS
       nadal odpowiada `200` dla roli zaufanej. To był największy ryzykowny
       scenariusz utwardzenia: odebranie `EXECUTE` helperom RLS zablokowałoby
       każde zapytanie do tabeli chronionej RLS.
4. [x] **Przegląd poincydentowy bazy** — `npm run audit:incident`:
       `app_admins` zawiera **1 konto** nadane 2026-07-19 przy zakładaniu
       środowiska (brak śladów eskalacji), 21 wpisów `org_audit_log` z samymi
       znanymi akcjami, 68 załączników bez ani jednej niezgodnej ścieżki.
5. [x] **Testy funkcjonalne forward/move — zabezpieczone automatycznie.**
       Zamiast jednorazowego klikania dodano dwie stałe kontrole niezmiennika
       (`security_definer_grants.sql` §4b i `nested_call_model.sql`, oba w CI).
       Ręczny przebieg przez UI nadal wskazany — pokrywa Storage i signed URL.
6. [x] **DEP-01** (przesunięty z etapu 3, bo wchodził bez ryzyka) — worker:
       Vitest `2.1.9` → `4.1.11`, Wrangler `4.113.0` → `4.125.0`,
       `@cloudflare/workers-types` → `5.20260823.1`. **11 podatności → 0.**
       Aplikacja: `npm audit fix` bez `--force`, **7 → 3** (pozostałe to łańcuch
       `esbuild`/`vite` w devDependencies, wymaga zrywającego Vite 8).

7. [x] **Deploy `_headers` na produkcję** — decyzja właściciela: wdrożyć razem
       z pracą w toku. Wdrożenie `169b68c4`, `_headers` wgrane.

   `release:sync` wyprowadza wersję z `git rev-parse HEAD`, a praca jest
   niezacommitowana — HEAD się nie ruszył, więc `app_release.client` zostałby
   bez zmian i **klienci nie dostaliby sygnału odświeżenia**. Wdrożono z jawnym
   `APP_BUILD_VERSION=a6ea61c-wip-20260823-2145`.

   Nagłówki potwierdzone na żywo na `dodo-c39.pages.dev`:

   | Nagłówek | Wartość |
   |---|---|
   | `content-security-policy-report-only` | aktywny |
   | `x-content-type-options` | `nosniff` |
   | `x-frame-options` | `DENY` |
   | `referrer-policy` | `strict-origin-when-cross-origin` |
   | `cross-origin-opener-policy` / `-resource-policy` | `same-origin` |
   | `permissions-policy` | aktywny |
   | `index.html`, `sw.js` | `no-cache, must-revalidate` |
   | `/assets/*` | `public, max-age=31536000, immutable` |

8. [x] **Branch protection na `main`** — polityka trzymana jako kod
       w `.github/branch-protection.json`, zastosowana przez
       `gh api -X PUT repos/123domel-netizen/DoDo/branches/main/protection
       --input .github/branch-protection.json`.

   | Ustawienie | Wartość |
   |---|---|
   | Wymagane statusy | `Frontend (test, typecheck, build)`, `Media sync worker`, `Repository guards`, `Supabase migrations from scratch` |
   | `strict` (gałąź aktualna z `main`) | `true` |
   | `enforce_admins` | `true` |
   | `allow_force_pushes` / `allow_deletions` | `false` |
   | Wymagane review | **brak** |

   Review celowo nie jest wymagane: przy jednoosobowym zespole nie da się
   zatwierdzić własnego PR-a, więc wymóg zablokowałby każdy merge.
   CI jest bramką, nie druga para oczu.

   > **Zmiana sposobu pracy.** `enforce_admins=true` oznacza, że
   > `git push origin main` jest teraz odrzucany także dla właściciela.
   > Nowy obieg:
   >
   > ```bash
   > git switch -c feat/crew-created-by
   > git add -A && git commit -m "..."
   > git push -u origin feat/crew-created-by
   > gh pr create --fill
   > gh pr merge --squash   # dostępne po zielonym CI
   > ```
   >
   > Awaryjne poluzowanie:
   > `gh api -X PUT repos/123domel-netizen/DoDo/branches/main/protection
   > --input .github/branch-protection.json -F enforce_admins=false`

   Sieć: `github.com` rozkłada ruch na kilka adresów, a `140.82.121.3` i
   `.5` nie odpowiadają z tej sieci (`.4` działa). `git`, `gh` i `npm`
   potrafią się z tego powodu wywalić na timeout — **wystarczy ponowić**.
   Logowanie `gh` i wywołanie API udały się dopiero za którymś podejściem.

   > **Mylący komunikat.** Przy takim timeoucie `gh auth status` pisze
   > *„The token in keyring is invalid"* i podpowiada `gh auth refresh`.
   > To nieprawda — token jest poprawny (`gist`, `read:org`, `repo`),
   > a `gh` myli błąd sieci z błędem uwierzytelnienia. **Nie logować się
   > ponownie, tylko ponowić polecenie.**

### Pozostało ręcznie

Wymagają uprawnień lub decyzji, których nie da się załatwić z repozytorium:

1. [ ] **`supabase db push` na środowiskach preview** — jeśli istnieją osobne
       projekty Supabase dla preview. Konto ma dowiązany tylko projekt
       produkcyjny (`supabase/.temp/project-ref`).
2. [ ] **Logi API** — Supabase Dashboard → Logs → API: wywołania
       `/rest/v1/rpc/ensure_app_admin_by_email`, `/_chat_storage_copy`,
       `/_chat_storage_move` sprzed wdrożenia `0065`. Jedyny ślad, którego nie
       ma w bazie; retencja jest ograniczona planem, więc im wcześniej, tym
       lepiej.
3. [ ] **Zebranie naruszeń CSP przez tydzień** — CSP działa w trybie
       report-only od 23.08.2026 (procedura: `docs/SECURITY.md` §3.1).
4. [ ] **Ręczny przebieg forward/move/zaproszenia przez UI** —
       `docs/SECURITY.md` §1.5.
5. [ ] **Zacommitować pracę w toku** (`crew_created_by`, obecności,
       harmonogramy) — produkcja działa dziś na kodzie, którego nie ma
       w historii gita. **Od teraz przez gałąź i PR** (patrz niżej).

---

## Etap 2 — DO ZROBIENIA: niezawodność zapisu Harmonogramów

Odpowiada etapowi 3 planu (brama G3). **Największe ryzyko produktowe po
zamknięciu spraw bezpieczeństwa: użytkownik widzi „zapisano", a dane giną.**

### Dlaczego nie zostało zrobione teraz

`src/lib/schedules/supabaseScheduleRepository.ts` (1775 linii) ma **niezacommitowane
zmiany** związane z pracą nad `crew_created_by` i obecnościami. Duży refactor
tego pliku równolegle z trwającą pracą oznaczałby konflikt i utrudnione review.
Etap 1 był celowo tak dobrany, żeby nie dotykać plików w toku.

### Rozpoznanie (gotowe do wykonania)

Stan obecny:

- ~24 wywołania `void this.syncX(...)` — zapisy fire-and-forget bez śledzenia.
- Stan oczekujący żyje w **pamięci** instancji: `pendingDeletedBlockIds`,
  `pendingDeletedEventIds`, `pendingDeletedCrewIds`, `pendingDeletedCategoryKeys`,
  `pendingDeletedAttendanceIds`, `pendingAttendance`, `pendingEquipment`,
  `pendingBlockDates`, `pendingCategoryMeta` (linie 97–111).
- `flushPendingOptimistic()` (linia 1142) już potrafi ponowić **całą** tę
  kolekcję — brakuje wyłącznie trwałości i wyzwalaczy.
- Flush odpala się tylko przy `loadFromCloud()`, czyli przy focusie/visibility.
  Brak nasłuchu `online`.
- Błędy kończą w `console.warn` — UI nigdy ich nie pokazuje.
- `subscribe()` deleguje do `inner`, więc **nie odpala się** przy zakończeniu
  synchronizacji — sam badge statusu nie odświeżyłby się bez nowego kanału.

### DATA-01A — widoczny stan zapisu

- [ ] `src/lib/schedules/scheduleSyncStatus.ts`: obserwowalny store ze stanem
      `idle | saving | pending | error | offline`, `pendingCount`, `lastSavedAt`,
      `lastError`. Czysta funkcja `deriveSyncState()` → pokryta testami.
- [ ] Osobny kanał `subscribeSyncStatus()` w porcie (nie mieszać z `subscribe()`).
- [ ] Badge w nagłówku `ProjectsPreviewApp.tsx` (mobile ~316, desktop ~509)
      z przyciskiem „Ponów zapis" wywołującym flush.
- [ ] `beforeunload` ostrzega **wyłącznie** gdy `pendingCount > 0`.
- [ ] Odróżnić offline (`navigator.onLine`) od błędu RLS/walidacji; błąd 403
      nie może być ponawiany w nieskończoność.

### DATA-01B — trwały outbox

- [ ] `src/lib/schedules/schedulePendingStore.ts`: serializacja kolekcji
      pending do IndexedDB przez `idb-keyval`, klucz
      `dodo-schedules-pending:{orgId}:{userId}`. Wzorzec do naśladowania:
      outbox czatu w `src/lib/chat/store.ts` (`partialize`) i `init.ts`
      (`flushOutbox`, linie 633–669).
- [ ] **Sugerowana technika minimalnej inwazyjności:** zamiast modyfikować ~24
      miejsca wywołań, podmienić `Set`/`Map` na `TrackedSet`/`TrackedMap` —
      podklasy wywołujące `onChange()` w `add`/`set`/`delete`/`clear`.
      Konstruktor podpina `onChange = () => this.markPendingChanged()`, co daje
      trwałość i licznik `pendingCount` bez dotykania logiki biznesowej.
- [ ] Odtworzenie stanu pending w konstruktorze **przed** `loadFromCloud()`.
- [ ] Flush przy `online`, `visibilitychange` i ręcznym retry; backoff
      wykładniczy z limitem.
- [ ] Klucz per użytkownik — przełączenie konta nie może wysłać cudzych komend.

### DATA-01C — luka, której nie zamyka sama trwałość

`syncBlock`, `syncEvent`, `syncCrew` przy błędzie **nie dopisują** nic do
kolekcji pending — nowy blok czy zdarzenie po prostu przepada. Utrwalanie
obecnych kolekcji tego nie naprawi.

- [ ] Przy błędzie dopisywać encję do `pendingBlockUpserts` / `pendingEventUpserts`
      / `pendingCrewUpserts` i ponawiać we `flushPendingOptimistic()`.
- [ ] Kompresja kolejki: późniejszy upsert zastępuje wcześniejszy,
      delete ma pierwszeństwo przed oczekującym upsertem.

### Scenariusze akceptacyjne

- [ ] Offline → 5 zmian → zamknięcie karty → otwarcie → online → pełny flush.
- [ ] Usunięcie offline nie wraca po reloadzie.
- [ ] Błąd 401 po wygaśnięciu sesji i wznowienie po odświeżeniu tokenu.
- [ ] Błąd 403/RLS pokazany użytkownikowi i niezapętlony.
- [ ] Przełączenie organizacji nie wysyła komend do złego `orgId`.
- [ ] Użytkownik nie widzi „zapisano", dopóki Supabase nie potwierdzi.

### Pozostałe pozycje etapu 2

- [ ] **QA-01:** ESLint w trybie „tylko błędy" (React Hooks, floating promises,
      nieużywane importy, zakaz `dangerouslySetInnerHTML`), najpierw jako
      warning, potem jako błąd w CI.
- [ ] **DB-TEST-01:** macierz RLS owner/członek/obca org/anon. Job `database`
      w CI już podnosi lokalne Supabase i uruchamia asercje — brakuje seeda
      użytkowników i testów przez klienta z realnym JWT.
- [ ] **A11Y-01 (dokończenie):** klawiaturowa alternatywa dla drag & drop
      w kalendarzu i harmonogramie, axe w testach, zoom 200%, reduced motion.
      Bazowy `Modal` jest już dostępny (`role`, `aria-modal`, focus trap,
      przywracanie focusu, blokada scrolla).

---

## Etap 3 — DO ZROBIENIA: wydajność, utrzymanie, obserwowalność

Odpowiada etapowi 4 planu (brama G4).

### OPS-01 — bootstrap bazy bez placeholderów

- [ ] `0002_cron.sql` (`<PROJECT_REF>`), `0017_chat_push.sql`
      (`<PROJECT_REF>`, `<CHAT_PUSH_SECRET>`), `0004_google_cron.sql`
      (`<PROJECT_REF>`, `<SERVICE_ROLE_KEY>`) — migracja zastępująca aktywne
      definicje odczytem z Supabase Vault.
- [ ] `scripts/configure-supabase-runtime.mjs` ustawiający wartości środowiska.
- [ ] Brak sekretu → kontrolowany błąd konfiguracji, nie wysłanie placeholdera.
- [ ] Guard CI już blokuje placeholdery w migracjach od numeru 0065.

### PERF-01 — budżet bundla

Baseline zmierzony po zmianach etapu 1:

| Artefakt | Rozmiar | Gzip | Cel |
|---|---:|---:|---:|
| Główny JS | 1 264,37 kB | 344,40 kB | < 275 kB gzip |
| PDF JS | 365,12 kB | 107,61 kB | poza grafem startowym |
| Precache PWA | 3 563,29 KiB / 29 wpisów | — | < 2,75 MiB |

- [ ] Rollup Visualizer i skrypt budżetu w CI.
- [ ] Odseparować PDF.js — ładowanie dopiero po otwarciu PDF.
- [ ] Usunąć statyczne importy modułów importowanych też dynamicznie
      (Vite raportuje nieskuteczne `dynamic import()`).
- [ ] `manualChunks` dopiero po uporządkowaniu grafu importów.
- [ ] Ocenić, czy worker PDF musi być w precache.

### SEC-05 — DNS rebinding

- [ ] Rozwiązywanie A/AAAA i walidacja IP przed połączeniem w `urlPolicy.ts`.
      Obecna polityka blokuje literały adresów prywatnych i przekierowania,
      ale nie domenę publiczną wskazującą na adres prywatny.

### MAINT-01 — stopniowy podział monolitów

Kolejność wg opłacalności; każdy podział z testem kontraktowym przed zmianą,
bez równoczesnej zmiany UI:

1. `SupabaseScheduleRepository` (1 775) — naturalnie po etapie 2.
2. `ScheduleTab.tsx` (4 841) — viewport/zoom, DnD, lane'y, toolbar.
3. `gallery-api/index.ts` (2 963) — router akcji, auth/policy, R2, Graph.
4. `chat/init.ts` (1 518) — lifecycle, realtime, commands, outbox.
5. `ItemEditorPanel.tsx` (1 768) — sekcje formularza i model draftu.

### DOC-01 — dokumentacja

- [ ] README: 9 dni → **11 dni**, `npm ci` w instrukcji startu, opis
      Harmonogramów, organizacji, `gallery-api`, Workera R2 i SharePointa;
      usunąć listę migracji kończącą się na `0019`.
- [ ] `docs/ARCHITECTURE.md` jako bieżący opis systemu.
- [ ] `PROJECTS_PREVIEW.md` → oznaczyć jako superseded przez `SCHEDULES.md`
      (dokument twierdzi, że nie ma SQL/RLS/syncu, a istnieją migracje
      `0054`–`0063` i adapter Supabase).
- [ ] Runbook greenfield deploy i disaster recovery.

### Pozostałe

- [ ] **DATA-02:** transakcyjne RPC dla operacji wielotabelowych
      (obecność + workers + equipment; usunięcie kategorii + bloki + zdarzenia).
- [ ] **DATA-03:** Realtime/incremental poll dla harmonogramów, `updated_at`
      na encjach, konflikt = last-write-wins + ostrzeżenie.
- [x] **DEP-01:** zrobione w etapie 1 — worker ma 0 podatności, aplikacja 3
      (łańcuch `esbuild`/`vite`, tylko devDependencies).
- [ ] **DEP-02:** Vite `5.4.21` → `8.x`, żeby domknąć advisory `esbuild`
      (`GHSA-67mh-4wv8-2f99`, dotyczy wyłącznie serwera deweloperskiego).
      Zmiana zrywająca — osobny PR, razem z `vite-plugin-pwa`.
- [ ] **FLAGS-01:** decyzja właściciela produktu o `schedules_enabled`
      (`isSchedulesModuleEnabled()` zwraca dziś na sztywno `true`).
- [ ] **OBS-01:** telemetria bez treści użytkowników — błędy JS z SHA buildu,
      wiek outboxa, backlog `media_sync_jobs`, p95 zapisu harmonogramu.
- [ ] **REL-01:** wersjonowanie release i changelog (wersja stoi na `0.1.0`).

---

## Decyzje wymagane od właściciela produktu

Bez nich etapy 2–3 mogą ruszyć, ale nie da się ich domknąć:

1. **Harmonogramy: moduł dla wszystkich czy entitlement organizacji?**
   Rekomendacja: entitlement sterowany serwerowo — inaczej `schedules_enabled`
   należy usunąć jako martwy kod.
2. **Czy okres stabilizacji zamraża nowe duże funkcje na 2–3 tygodnie?**
   Rekomendacja: tak, do zakończenia etapu 2.
3. **Jaki poziom telemetrii jest akceptowalny?**
   Rekomendacja: wyłącznie metadane techniczne — bez treści wiadomości,
   tytułów, nazw plików i danych osobowych.
