# Media pipeline — operacje i monitoring

## Feature flags (kolejność decyzji)

| Warstwa | Mechanizm | Rola |
|---------|-----------|------|
| DB `orgs.media_pipeline` | `legacy_sp` (domyślnie) \| `r2_sp` | **Źródło prawdy** — włącza R2 dla galerii zespołu |
| Edge | `r2Configured()` | Wymagane do faktycznego R2; bez sekretów → zawsze legacy |
| Frontend | `VITE_MEDIA_PIPELINE` | Tylko **kill switch** build-time: `legacy` blokuje klienta R2; **nie włącza** R2 samodzielnie |
| Wiersz | `galleries.pipeline` | Ustalany przy create z decyzji serwera |

Rollback natychmiastowy: admin → Magazyn → **Legacy SP** (`org_media_pipeline_set`).

Brak/błąd odczytu flagi → `legacy_sp`.

## Pierwszy rollout

- **Galerie:** możliwe po `orgs.media_pipeline=r2_sp` + sekrety R2 + Worker
- **Załączniki czatu:** R2 gdy org `r2_sp` (voice / forward / move = legacy)
- **Voice / forward / move:** zawsze legacy

## Worker bridge (MEDIA3)

Dopóki `MICROSOFT_*` nie są ustawione na `dodo-media-sync`, consumer kolejki
`dodo-media-archive` i `MEDIA_SYNC_HOOK_URL` wskazują na
`dodo-media-sync-preview` (ten sam bucket `dodo-media`). Po ustawieniu sekretów
Graph na prod: przywróć consumer w `wrangler.jsonc` i przełącz hook na
`https://dodo-media-sync.123domel.workers.dev/enqueue`.

## Główne źródło jobów sync

```
r2_confirm_gallery_item
  → HeadObject
  → r2_ready
  → INSERT media_sync_jobs (idempotentnie)
  → POST Worker /enqueue
```

**Nie** podłączaj R2 Event Notifications jako równorzędnego źródła tego samego zadania.

R2 Event Notifications = przyszła rekoncyliacja / osierocone obiekty / audyt / sprzątanie.

## Sekrety Edge (`gallery-api`)

```
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET=dodo-media
MEDIA_SYNC_HOOK_URL=https://dodo-media-sync.<account>.workers.dev/enqueue
MEDIA_SYNC_HOOK_SECRET=<shared>
GALLERY_FULL_RETENTION_DAYS=45
ATTACHMENT_RETENTION_DAYS=180
```

## Sekrety Worker (`dodo-media-sync`)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
MICROSOFT_TENANT_ID
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MEDIA_SYNC_HOOK_SECRET=<same as Edge>
```

## Monitoring (minimum)

| Sygnał | Gdzie | Alert gdy |
|--------|-------|-----------|
| Czas confirm R2 | Edge logs `r2_confirm_*` | p95 > 5s |
| Kolejka backlog | `gallery_items` / `media_sync_jobs` | > 50 lub rosnące 1h |
| Błędy Graph | Worker logs + `sync_last_error` | 401/403 |
| Cleanup | Worker cron co 6h | brak delete przy due rows |

Admin UI: Ustawienia → Zespół → Magazyn — pipeline + Ponów sync.

## Health

- Worker: `GET /health`
- Edge: `action: media_pipeline_info` → `attachmentsR2Enabled: true` gdy `r2Configured()`, `globalDefault: legacy_sp`

## R2 API token (produkcja)

Token Edge musi mieć **Object Read & Write** na bucketcie **`dodo-media`**
(opcjonalnie też `dodo-media-preview`). Token scoped tylko do preview
powoduje **403** na PUT po cutoverze `R2_BUCKET=dodo-media`.

Po rotacji: `npx supabase secrets set` dla `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` (wartości poza gitem), bez commita.
