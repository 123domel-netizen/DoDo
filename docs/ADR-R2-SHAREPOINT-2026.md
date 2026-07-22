# ADR: Cloudflare R2 (hot) + SharePoint (cold)

**Status:** Accepted  
**Date:** 2026-07-22  
**Context:** Galerie i załączniki DoDo — szybki upload bez zależności od otwartej aplikacji po `r2_ready`.

## Decyzja

1. **R2** = prywatny bucket, direct upload (presigned PUT) z klienta.
2. **SharePoint** = długoterminowe archiwum zespołu (Microsoft Graph app-only).
3. **Supabase** = metadane, uprawnienia, statusy sync, retencja.
4. **Cloudflare Queue + Worker** = kopiowanie R2 → SharePoint (idempotentne, retry).
5. **Sekrety Graph:** Worker (sync) + Edge (legacy / storage_save / dual-read SP). Konsolidacja = Stage 5.

## Klucze R2

```
hot/teams/{orgId}/galleries/{galleryId}/full/{itemId}.jpg
hot/teams/{orgId}/galleries/{galleryId}/thumb/{itemId}.webp
hot/teams/{orgId}/attachments/{conversationId}/{messageId}/{attId}
```

Klient nie wybiera klucza — generuje Edge.

## Pipeline flag

- **Źródło prawdy:** `orgs.media_pipeline` (`legacy_sp` domyślnie \| `r2_sp`)
- `VITE_MEDIA_PIPELINE` — tylko kill switch build-time (nie włącza R2)
- `galleries.pipeline` — wynik decyzji serwera przy create
- Załączniki: zawsze legacy w pierwszym rolloutcie

## Sync jobs

Jedno źródło: `r2_confirm` → `media_sync_jobs` → Worker `/enqueue`.  
R2 Event Notifications = przyszła rekoncyliacja (nie podłączać teraz).

## Retencja

| Obiekt | R2 |
|--------|-----|
| Gallery full | 45 dni po `sharepoint_verified` |
| Gallery thumb | bez auto-delete |
| Attachment | 180 dni po verified (gdy włączone) |

Cleanup tylko gdy `sp_status = verified` i `r2_delete_after < now()`.

## Etapy

0. ADR + worker skeleton ✅  
1. R2 hot path galerie ✅  
2. Queue + Worker sync SP ✅  
3. Załączniki (kod przygotowany, **wyłączone** w rolloutcie 1) ✅  
4. Cleanup ✅  
5. Monitoring / hardening + testy polityki ✅ — `MEDIA_PIPELINE_OPS.md`, `pipelinePolicy.test.ts`

## Rollback

`org_media_pipeline_set` → `legacy_sp` (natychmiast, bez redeploy frontu).  
Vite `legacy` blokuje klienta. Legacy Edge→Graph pozostaje.
