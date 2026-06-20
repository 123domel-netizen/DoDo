# Kalendarz + ToDo (PWA w stylu Notion Calendar)

Aplikacja webowa (PWA) łącząca kalendarz i listę zadań. Wydarzenie i zadanie to
ten sam byt (`item`) – różnią się tylko domyślnymi ustawieniami i tym, gdzie się
pokazują. Działa od razu lokalnie (IndexedDB), a po podłączeniu Supabase
synchronizuje dane między telefonem i komputerem oraz wysyła powiadomienia push.

## Funkcje

Kalendarz:

- Układ i wygląd zbliżony do Notion Calendar
- Widoki: Dzień, Tydzień, **9 dni** (start w piątek, konfigurowalny) i Miesiąc
- Konfigurowalny zakres widocznych godzin (np. 7–18); wydarzenia spoza zakresu
  pokazują się jako „chmurki” nad i pod siatką – bez marnowania miejsca na puste
  godziny
- Prawy przycisk myszy na siatce: **Dodaj / Kopiuj / Wklej wydarzenie**
- Drag & drop: przesuwanie w czasie (góra/dół), rozciąganie startu i końca,
  przenoszenie między dniami (lewo/prawo)
- Wydarzenia mają: tytuł, czas startu i końca (z możliwością rozciągnięcia na
  dni), grupę, uczestników, opis, checklistę, linki i załączniki oraz wiele
  przypomnień
- Wielodniowe / całodniowe wydarzenia jako paski u góry

Panel ToDo (po prawej):

- Nagłówek jako główna treść, opis, checklista, przypomnienia, uczestnicy,
  linki/załączniki
- Termin wykonania z czasem trwania (start = termin − 1h; termin „dniowy” → 12:00)
- Przycisk „→ kalendarz” (zmień zadanie na wydarzenie)
- Przełączniki „Pokaż w kalendarzu” / „Pokaż na liście ToDo”

Grupy (np. Rodzinne, Firma A, Zakupy):

- Skrajnie prawy, pionowy pasek z etykietami obróconymi o 90° do filtrowania
- Kolory grup widoczne w kalendarzu i na liście zadań

## Szybki start (tryb lokalny)

```bash
npm install
npm run dev
```

Otwórz adres pokazany przez Vite (domyślnie http://localhost:5173). Dane
zapisują się lokalnie w przeglądarce (IndexedDB) – aplikacja działa offline.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- Zustand (stan) + IndexedDB (`idb-keyval`) – trwałość lokalna
- date-fns – obsługa dat (lokalizacja PL)
- vite-plugin-pwa – manifest, service worker, instalacja, offline
- Supabase (opcjonalnie) – Postgres + Auth + Realtime + Edge Functions

## Synchronizacja + powiadomienia (Supabase)

Tryb lokalny działa na jednym urządzeniu. Aby widzieć te same dane na telefonie i
komputerze oraz dostawać powiadomienia, podłącz darmowy projekt Supabase.

1. Utwórz projekt na https://supabase.com (darmowy tier wystarcza dla ~10 osób).
2. W SQL Editor uruchom migracje po kolei: `0001_init.sql`, `0005_allowed_users.sql`
   (oraz późniejsze wg potrzeb: `0002`–`0004`).
3. Skopiuj `.env.example` do `.env` i uzupełnij:

   ```env
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_VAPID_PUBLIC_KEY=<public key VAPID>
   ```

4. Po ustawieniu tych zmiennych aplikacja wymaga **logowania przez Google**
   (tylko zaproszone konta). Każdy użytkownik ma własne dane (izolacja RLS).

### Logowanie Google (whitelist ~10 osób)

**To nie to samo co integracja kalendarza** (ikonka łańcucha w pasku). Logowanie
otwiera dostęp do aplikacji; integracja kalendarza synchronizuje wydarzenia/zadania
z Google Calendar/Tasks po zalogowaniu.

1. **Supabase Dashboard** → Authentication → Providers → **Google** → włącz,
   wklej Client ID i Secret z Google Cloud Console.
2. W Google Cloud Console dodaj **Authorized redirect URI** podany przez Supabase
   (np. `https://<ref>.supabase.co/auth/v1/callback`) — to **inny** adres niż
   callback syncu kalendarza (`google-oauth`).
3. **Site URL** w Supabase Auth: `http://localhost:5173` (dev) i URL produkcji.
4. Uruchom migrację `0005_allowed_users.sql`, potem dodaj zaproszone maile:

   ```sql
   insert into public.allowed_users (email) values
     ('ty@gmail.com'),
     ('zona@gmail.com');
   -- … do ~10 adresów
   ```

5. Wdróż Auth Hook i podepnij w Dashboard → Authentication → **Auth Hooks** →
   `before-user-created`:

   ```bash
   supabase functions deploy auth-allowlist --no-verify-jwt
   supabase secrets set AUTH_HOOK_SECRET=<losowy-długi-string>
   ```

   W konfiguracji hooka ustaw nagłówek `Authorization: Bearer <AUTH_HOOK_SECRET>`.

   Alternatywa bez tabeli: sekret `ALLOWED_EMAILS=mail1@gmail.com,mail2@gmail.com`.

6. W aplikacji: ekran startowy → **Zaloguj przez Google**. Wylogowanie: awatar
   w prawym górnym rogu paska.

### Powiadomienia Web Push

1. Wygeneruj klucze VAPID:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Public key → `VITE_VAPID_PUBLIC_KEY` (frontend). Oba klucze → sekrety funkcji.

2. Wdróż Edge Function i ustaw sekrety:

   ```bash
   supabase functions deploy send-reminders --no-verify-jwt
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT=mailto:ty@firma.pl
   ```

3. Włącz rozszerzenia `pg_cron` i `pg_net`, a następnie uruchom
   `supabase/migrations/0002_cron.sql` (po podmianie `<PROJECT_REF>` i
   `<SERVICE_ROLE_KEY>`). Cron co minutę wywołuje funkcję, która rozsyła
   przypomnienia na wszystkie urządzenia.

4. W aplikacji kliknij ikonę dzwonka, aby zezwolić na powiadomienia i
   zarejestrować urządzenie.

> Gdy aplikacja jest otwarta, przypomnienia pokazują się też lokalnie (bez
> backendu). Push z serwera działa również gdy aplikacja jest zamknięta.

## Integracja Google Calendar + Google Tasks

Wymaga zalogowania w aplikacji (Google + whitelist). Tokeny syncu kalendarza są
przechowywane zaszyfrowane po stronie serwera (Edge Functions). Po zalogowaniu
kliknij **ikonę łańcucha** w pasku → **Połącz Google**.

### 1. Google Cloud Console

1. Utwórz projekt → **APIs & Services** → włącz **Google Calendar API** i
   **Google Tasks API**.
2. **OAuth consent screen** (External) → dodaj scope: `calendar.events`, `tasks`.
3. **Credentials** → OAuth 2.0 Client ID (Web) — możesz użyć **tego samego**
   klienta co logowanie Supabase; dodaj oba redirect URI:
   - Logowanie: `https://<ref>.supabase.co/auth/v1/callback`
   - Sync kalendarza: `https://<PROJECT_REF>.supabase.co/functions/v1/google-oauth?action=callback`

### 2. Migracje bazy

W SQL Editor uruchom po kolei:

- `supabase/migrations/0003_google_sync.sql`
- `supabase/migrations/0004_google_cron.sql` (podmień `<PROJECT_REF>` i
  `<SERVICE_ROLE_KEY>`)

### 3. Edge Functions

```bash
supabase functions deploy google-oauth --no-verify-jwt
supabase functions deploy google-sync --no-verify-jwt
supabase functions deploy google-webhook --no-verify-jwt

supabase secrets set \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GOOGLE_TOKEN_ENCRYPTION_KEY=<64 znaki hex, np. openssl rand -hex 32> \
  GOOGLE_OAUTH_REDIRECT_URI=https://<PROJECT_REF>.supabase.co/functions/v1/google-oauth?action=callback \
  GOOGLE_OAUTH_SUCCESS_URL=/?google=connected \
  GOOGLE_OAUTH_APP_ORIGIN=https://twoja-domena.pl \
  GOOGLE_WEBHOOK_URL=https://<PROJECT_REF>.supabase.co/functions/v1/google-webhook
```

### 4. W aplikacji

Ikona ustawień (zębatka) → sekcja **Integracja Google** → **Połącz Google**.

Synchronizacja jest dwukierunkowa: zmiany w appce trafiają do Google, zmiany w
Google wracają przez cron (co 5 min) i webhook Kalendarza. Zadania z checklistą
→ subtaski w Google Tasks.

## Instalacja jako aplikacja (PWA)

- **Android / desktop (Chrome, Edge):** menu przeglądarki → „Zainstaluj
  aplikację”. Powiadomienia push działają po instalacji.
- **iPhone (Safari):** Udostępnij → „Dodaj do ekranu początkowego”. Powiadomienia
  push na iOS działają tylko dla zainstalowanej PWA (iOS 16.4+).

## Build i deploy

```bash
npm run build      # produkcyjny build do dist/
npm run preview    # lokalny podgląd builda
```

Deploy na darmowym hostingu statycznym (Vercel / Netlify / Cloudflare Pages):
ustaw komendę build `npm run build`, katalog publikacji `dist`, oraz zmienne
środowiskowe `VITE_*` w panelu hostingu.

## Struktura projektu

```
src/
  components/
    calendar/   TimeGrid (siatka + drag&drop + chmurki), MonthView, ContextMenu
    todo/       TodoPanel
    groups/     GroupRail (pasek 90°) + GroupsModal
    item/       ItemEditor (formularz wydarzenia/zadania)
    ui/         Modal
    Toolbar.tsx AuthGate.tsx
  lib/          time, format, factory, store-storage, supabase, cloud, push, googleSync
  state/        store.ts (Zustand + persist)
  hooks/        useReminderScheduler
  sw.ts         service worker (offline cache + push)
supabase/
  migrations/   0001_init.sql … 0005_allowed_users.sql
  functions/    send-reminders, auth-allowlist, google-oauth, google-sync, google-webhook
```

## Uwaga o widoku „9 dni”

Widok pokazuje 9 kolejnych dni zaczynając od piątku (dzień startu można zmienić w
`settings.nineDayStartWeekday`). 9 dni od piątku kończy się w sobotę – jeśli
wolisz, by widok zawsze kończył się w poniedziałek (np. 11 dni, dwa weekendy),
daj znać, dostosuję długość zakresu.
```
