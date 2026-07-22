# dodo-media-sync

Cloudflare Worker: kopiowanie obiektów z R2 do SharePoint (Microsoft Graph) + retencja R2.

## Główne źródło zadań

Wyłącznie `POST /enqueue` z Edge po `r2_confirm_*` (po trwałym `media_sync_jobs`).

**Nie konfiguruj** R2 Event Notifications jako drugiego źródła tych samych jobów.
Events = przyszła rekoncyliacja / osierocone obiekty (Worker ignoruje nieznane eventy).

## Wymagane sekrety

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put MICROSOFT_TENANT_ID
wrangler secret put MICROSOFT_CLIENT_ID
wrangler secret put MICROSOFT_CLIENT_SECRET
wrangler secret put MEDIA_SYNC_HOOK_SECRET
```

## R2 + Queue

1. Bucket `dodo-media` (prywatny).
2. Kolejki `dodo-media-archive` i `dodo-media-archive-dlq`.
3. `MEDIA_SYNC_HOOK_URL` na Edge → `https://<worker>/enqueue`.
4. `npm run deploy` w tym katalogu (lub `npm run worker:deploy` z roota).

## Endpointy

| Path | Opis |
|------|------|
| `POST /enqueue` | Hook z Edge (Bearer = MEDIA_SYNC_HOOK_SECRET) |
| `GET /health` | Liveness |

## Cron (co 6h)

1. Re-enqueue backlog `queued|failed|retry_scheduled`
2. `cleanup_r2` — tylko full po verified + due (nigdy thumbs galerii)
3. Stale `uploading` galerii >12h

## CORS R2

Origin DoDo, metody `PUT, GET, HEAD`, headers `content-type, content-length`.
