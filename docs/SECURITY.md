# Bezpieczeństwo DoDo — runbook operacyjny

**Ostatnia aktualizacja:** 23 sierpnia 2026
**Dotyczy migracji:** `0065_revoke_internal_security_definer.sql`, `0066_function_execute_hardening.sql`

Dokument opisuje mechanizmy bezpieczeństwa wymagające obsługi operacyjnej:
uprawnienia funkcji bazodanowych, politykę URL dla ruchu wychodzącego oraz
nagłówki HTTP. Architektura ogólna: `docs/ARCHITECTURE.md` (planowany).

---

## 1. Uprawnienia EXECUTE funkcji w schemacie `public`

### 1.1. Na czym polegał problem

PostgreSQL nadaje roli **PUBLIC** domyślne prawo `EXECUTE` na każdej nowo
utworzonej funkcji. Rola PUBLIC obejmuje `anon` i `authenticated`, a PostgREST
eksponuje każdą funkcję schematu `public` jako endpoint `/rest/v1/rpc/<nazwa>`.

W efekcie `GRANT EXECUTE … TO authenticated` **nie zawężał** dostępu — tylko go
duplikował. Prefiks `_` w nazwie również niczego nie ukrywał.

W historii migracji było 108 definicji `SECURITY DEFINER` i tylko 7 jawnych
`REVOKE`. Pięć funkcji było jednocześnie `SECURITY DEFINER` (omijają RLS) i
pozbawionych jakiejkolwiek weryfikacji wywołującego:

| Funkcja | Skutek nadużycia | Waga |
|---|---|---|
| `ensure_app_admin_by_email(text)` | Wstawia dowolny e-mail do `app_admins` — **eskalacja do administratora aplikacji** | Krytyczna |
| `_chat_storage_copy(text, text)` | Kopiuje dowolny obiekt `chat-attachments`, kasując obiekt docelowy | Krytyczna |
| `_chat_storage_move(text, text)` | Przenosi/zmienia nazwę dowolnego obiektu `chat-attachments` | Krytyczna |
| `org_expire_invites(uuid)` | Wygasza zaproszenia obcej organizacji | Średnia |
| `org_audit(uuid, text, jsonb)` | Zaśmieca dziennik audytu obcej organizacji | Średnia |

> `ensure_app_admin_by_email` nie została wskazana w audycie z 23.08.2026 —
> wyszła dopiero przy pełnej inwentaryzacji `pg_proc`. Jest groźniejsza od
> helperów Storage, bo daje trwałe uprawnienia administracyjne.

### 1.2. Docelowy model uprawnień

| Kategoria | Prawo `EXECUTE` |
|---|---|
| Helper wewnętrzny (lista w 0066) | Wyłącznie właściciel funkcji |
| Funkcja triggera (`returns trigger`) | Brak; PostgREST ich nie eksponuje |
| RPC dla zalogowanych + helpery RLS | `authenticated`, `service_role` |
| PUBLIC / `anon` | **Nigdy** — aplikacja wymaga logowania |

`authenticated` musi zachować `EXECUTE` na helperach RLS
(`is_conversation_member`, `can_access_item`, `is_org_member`,
`is_construction_crew_visible`, …). Wyrażenia polityk RLS wykonują się z
prawami roli pytającej, więc odebranie im `EXECUTE` zwróciłoby
`permission denied for function` przy każdym zapytaniu do chronionej tabeli.

### 1.3. Wdrożenie

```bash
supabase db push          # zastosuje 0065 i 0066
```

Obie migracje mają wbudowaną bramkę weryfikacyjną — jeśli po wykonaniu
którakolwiek funkcja `SECURITY DEFINER` pozostanie dostępna dla PUBLIC/anon,
migracja **zakończy się błędem** i transakcja się wycofa.

Kolejność ma znaczenie: 0065 to wąski hotfix (5 funkcji, minimalne ryzyko),
0066 to przegląd zbiorczy. Przy pilnym wdrożeniu można wypchnąć samo 0065.

### 1.4. Weryfikacja po wdrożeniu

Test negatywny z zewnątrz, zautomatyzowany:

```bash
npm run check:rpc-exposure
```

Skrypt (`scripts/verify-rpc-exposure.mjs`) czyta `VITE_SUPABASE_URL` i
`VITE_SUPABASE_ANON_KEY` z `.env`, wywołuje pięć helperów wewnętrznych jako
`anon` i kończy się kodem `1`, jeśli którykolwiek odpowie inaczej niż
`401`/`403`/`404`. Ładunki są nieszkodliwe (domena `.invalid`, losowe UUID).
Gdy dostępny jest `SUPABASE_SERVICE_ROLE_KEY`, uruchamia też **kontrolę
regresji**: jedenaście helperów RLS musi nadal zwracać `200`, bo ich utrata
zablokowałaby każde zapytanie do tabeli chronionej RLS.

Pełny audyt katalogu (uprawnienia, `search_path`, RLS, niezmiennik wywołań):

```bash
psql "$DATABASE_URL" -f supabase/tests/security_definer_grants.sql
```

#### Wynik wdrożenia produkcyjnego — 23.08.2026

Projekt `mutxxlnhxripsvjndgyr`, migracje `0065` i `0066` zastosowane.

| Funkcja | `anon` przed | `anon` po | `service_role` po |
|---|---|---|---|
| `ensure_app_admin_by_email` | **204 — wykonana** | 401 | 403 |
| `_chat_storage_copy` | **200 — wykonana** | 401 | 403 |
| `_chat_storage_move` | **200 — wykonana** | 401 | 403 |
| `org_expire_invites` | **204 — wykonana** | 401 | 403 |
| `org_audit` | **409 — wykonana**, błąd FK | 401 | 403 |

Pomiar „przed" potwierdził, że luka była realnie wykorzystywalna na produkcji:
`org_audit` zwrócił naruszenie klucza obcego (`23503`), czyli `INSERT` faktycznie
się wykonał. Po wdrożeniu wszystkie pięć zwraca `42501 permission denied`,
a jedenaście helperów RLS nadal odpowiada `200` — utwardzenie nie odcięło
aplikacji.

### 1.5. Testy funkcjonalne (nie mogą się zepsuć)

Dlaczego forward/move działa mimo odebrania praw helperom: wewnątrz funkcji
`SECURITY DEFINER` prawo `EXECUTE` sprawdzane jest względem **właściciela**
funkcji, nie roli wywołującej. `forward_message_thread` i `move_message_thread`
są `SECURITY DEFINER` i mają tego samego właściciela co `_chat_storage_copy` /
`_chat_storage_move`, więc wywołanie zagnieżdżone przechodzi.

Niezmiennik jest pilnowany automatycznie w dwóch miejscach:

- `supabase/tests/security_definer_grants.sql` §4b — asercja katalogowa: każda
  funkcja, której ciało odwołuje się do helpera wewnętrznego, musi być
  `SECURITY DEFINER` o zgodnym właścicielu. Wykrywa np. zmianę opakowania na
  `SECURITY INVOKER`.
- `supabase/tests/nested_call_model.sql` — dowód behawioralny na bazie
  lokalnej: opakowanie wywołuje helper poprawnie, a rola `authenticated`
  wywołując helper wprost dostaje `insufficient_privilege`.

Oba działają w CI (job `database`) na bazie odtworzonej od zera.
`nested_call_model.sql` tworzy i usuwa obiekty tymczasowe — **nie uruchamiać
na produkcji**.

Pozostaje ręczny przebieg przez interfejs (weryfikuje też Storage i signed URL,
czego katalog nie pokrywa):

- [ ] Przekazanie wiadomości z załącznikiem kopiuje plik do rozmowy docelowej.
- [ ] Przeniesienie wiadomości z załącznikiem przenosi plik.
- [ ] Signed URL nowego obiektu respektuje członkostwo rozmowy.
- [ ] Zaproszenie do organizacji i lista kontaktów działają (`org_invite`,
      `org_get_detail` — wywołują wewnętrznie `org_audit`/`org_expire_invites`).
- [ ] Otwarcie czatu, kanału i harmonogramu — sprawdza helpery RLS.

### 1.6. Rollback

**Nie przywracać `GRANT … TO public`.** Jeśli kontrolowane RPC przestanie
działać, przyczyną jest niezgodność właściciela funkcji, nie brak PUBLIC:

1. `select proname, proowner::regrole from pg_proc where proname = '<nazwa>';`
2. Ujednolicić właściciela helpera i funkcji wywołującej.
3. Ewentualnie nadać `EXECUTE` konkretnej roli backendowej — nigdy `anon`,
   `authenticated` ani `public`.

### 1.7. Reakcja poincydentowa

Migracja zamyka wektor, ale nie mówi, czy był użyty. Część bazodanową pokrywa:

```bash
npm run audit:incident
```

Skrypt (`scripts/audit-security-incident.mjs`, tylko odczyt, wymaga
`SUPABASE_SERVICE_ROLE_KEY`) sprawdza trzy ślady:

- konta w `app_admins` wraz z adresami e-mail i datą nadania,
- akcje w `org_audit_log` spoza listy wyprowadzonej z migracji oraz wpisy bez
  `actor_user_id`,
- zgodność ścieżek `message_attachments` z konwencją właściwego backendu.

Ścieżka załącznika zależy od miejsca składowania i skrypt rozróżnia trzy
warianty — inaczej zgłaszałby fałszywe alarmy:

| Backend | Konwencja |
|---|---|
| Supabase Storage | `{conversationId}/{messageId}/{plik}` |
| Cloudflare R2 | `hot/teams/{orgId}/attachments/{conversationId}/{messageId}/{plik}` |
| SharePoint | `sp:{driveItemId}` |

#### Wynik przeglądu — 23.08.2026

- `app_admins`: **1 konto**, `lukaszewicz.dominik@gmail.com`, nadane
  2026-07-19, czyli przy zakładaniu środowiska. Brak śladów eskalacji.
- `org_audit_log`: 21 wpisów, wszystkie akcje znane, każdy z `actor_user_id`.
- `message_attachments`: 68 pozycji (59 Supabase, 5 SharePoint, 4 R2),
  **zero niezgodnych ścieżek**.

Pozostaje do sprawdzenia ręcznie, bo nie ma tego w bazie:

- [ ] Supabase Dashboard → Logs → API: wywołania
      `/rest/v1/rpc/ensure_app_admin_by_email`, `/_chat_storage_copy`,
      `/_chat_storage_move` sprzed wdrożenia 0065. Retencja logów jest
      ograniczona planem, więc im wcześniej, tym lepiej.

### 1.8. Zasada dla nowych funkcji

`0066` ustawia `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
więc nowe funkcje nie dziedziczą już dostępu dla PUBLIC. Dodatkowo każda nowa
migracja (od numeru 0065) musi zawierać jawny `REVOKE` dla definiowanych funkcji
`SECURITY DEFINER` — pilnuje tego `scripts/check-repo-guards.mjs` w CI.

Ustawienie `ALTER DEFAULT PRIVILEGES` działa **per rola tworząca obiekt**. Jeśli
migracje są wdrażane inną rolą niż podczas tworzenia 0066, trzeba powtórzyć
polecenie dla tej roli.

---

## 2. Ruch wychodzący — polityka URL (SSRF)

Kanoniczna implementacja: `supabase/functions/_shared/urlPolicy.ts`.
Testy: `src/lib/security/urlPolicy.test.ts` (23 przypadki).

Funkcja `link-preview` pobiera adres podany przez użytkownika, więc jest
naturalnym wektorem SSRF. Poprzednia wersja sprawdzała wyłącznie pierwszy URL i
używała `redirect: "follow"` — serwer atakującego mógł odpowiedzieć
przekierowaniem na adres prywatny.

Obecne zasady:

| Kontrola | Zachowanie |
|---|---|
| Schemat | Tylko `http:` i `https:` |
| Porty | Tylko `80`, `443` i domyślny |
| Userinfo | `http://zaufany.example@169.254.169.254/` odrzucone |
| IPv4 | Blokada `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `198.18/15`, `224/4`, `240/4` |
| IPv6 | Blokada `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped, NAT64, 6to4 |
| Nazwy | Blokada `localhost`, `*.local`, `*.internal`, `*.intranet`, `*.home.arpa`, nazw bez kropki |
| Przekierowania | `redirect: "manual"`, maks. 3 skoki, **walidacja każdego `Location`**, wykrywanie pętli |
| Nagłówki | Bez cookies i bez nagłówków użytkownika |
| Miniatura | `og:image` przechodzi tę samą politykę, rozwiązywany względem ostatniego skoku |

Zapisy zaciemnione (`http://2130706433/`, `http://0x7f000001/`) są normalizowane
przez konstruktor `URL` do postaci kropkowej, więc obejmuje je kontrola IPv4.

**Znane ograniczenie:** nie rozwiązujemy DNS przed połączeniem, więc domena
publiczna wskazująca rekordem A na adres prywatny (DNS rebinding) nie jest
wykrywana. Zamknięcie tej luki wymaga rozwiązywania A/AAAA i pinowania IP —
zapisane jako zadanie etapu 3.

---

## 3. Nagłówki HTTP

Konfiguracja: `public/_headers` (Cloudflare Pages kopiuje z `dist/`).

Aktywne w trybie egzekwowania: `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, `Permissions-Policy` oraz reguły cache
(`index.html` i `sw.js` bez cache, `/assets/*` immutable).

### 3.1. Przełączenie CSP na egzekwowanie

CSP działa jako `Content-Security-Policy-Report-Only`, ponieważ aplikacja
korzysta z Supabase, R2, Tenor/GIPHY i DiceBear, a podglądy linków wskazują na
dowolne hosty. Procedura:

1. Wdrożyć w trybie report-only (stan obecny).
2. Przez tydzień zbierać naruszenia w konsoli przeglądarki na desktopie,
   Androidzie i iOS, w tym po instalacji PWA.
3. Uzupełnić brakujące origin-y w `connect-src` / `img-src` / `media-src`.
4. Zmienić nazwę nagłówka na `Content-Security-Policy`.
5. Zostawić `Content-Security-Policy-Report-Only` z węższą polityką jako
   następny krok zacieśniania.

`img-src` i `media-src` celowo dopuszczają `https:` — miniatury podglądów
linków i GIF-y pochodzą z dowolnych domen. Zawężenie wymagałoby proxy mediów.

`style-src` wymaga `'unsafe-inline'`, bo React ustawia atrybuty `style`
(np. szerokość okna w `Modal`). Usunięcie tego wymaga przejścia na klasy CSS
lub nonce.

---

## 4. Kontrole automatyczne

| Kontrola | Gdzie | Co wykrywa |
|---|---|---|
| `scripts/check-repo-guards.mjs` | CI, `npm run check:guards` | Funkcja `SECURITY DEFINER` bez `REVOKE`, placeholder/sekret w SQL, tabela bez RLS, śledzony plik `.env` z poświadczeniami |
| `supabase/tests/security_definer_grants.sql` | CI (job `database`), ręcznie na prod | Rzeczywiste uprawnienia w bazie, brak `search_path`, tabele bez RLS, niezmiennik wywołań helperów |
| `supabase/tests/nested_call_model.sql` | CI (job `database`), lokalnie | Regresję modelu wywołań zagnieżdżonych (czy 0065 nie psuje forward/move) |
| `scripts/verify-rpc-exposure.mjs` | `npm run check:rpc-exposure`, po każdym wdrożeniu | Rzeczywistą ekspozycję RPC dla `anon` oraz regresję helperów RLS |
| `scripts/audit-security-incident.mjs` | `npm run audit:incident`, doraźnie | Ślady nadużycia: obce konta admin, nieznane akcje audytu, anomalie ścieżek załączników |
| `src/lib/security/urlPolicy.test.ts` | `npm test` | Regresje polityki SSRF |
| `npm audit --omit=dev --audit-level=high` | CI | Podatności zależności runtime |

Migracje `0001`–`0064` są zamrożone: `check-repo-guards.mjs` raportuje je jako
dług historyczny (92 pozycje), ale nie blokuje CI. Ich faktyczna ekspozycja jest
zamykana w bazie przez `0066`, sterowaną katalogiem `pg_proc`.
