# Produkcyjne media DoDo (R2 + SharePoint) — sekrety

Wartości sekretów **nigdy** do gita ani na czat. Tylko nazwy i procedury.

## Token R2 (Account API Token)

| Pole | Wartość |
|------|---------|
| Name | `dodo-media-rw` |
| Permission | Object Read & Write |
| Bucket | wyłącznie `dodo-media` |
| TTL | Forever |

Token preview `dodo-media-preview-rw` — unieważnij po usunięciu zasobów preview.

## Edge (Supabase Secrets)

Nazwy: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (= `dodo-media`),
`MEDIA_SYNC_HOOK_URL` (= `https://dodo-media-sync.123domel.workers.dev/enqueue`),
`MEDIA_SYNC_HOOK_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.

## Worker prod (`dodo-media-sync`)

Nazwy: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MEDIA_SYNC_HOOK_SECRET`,
`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.

```powershell
cd worker
npx wrangler secret put MICROSOFT_TENANT_ID -c wrangler.jsonc
npx wrangler secret put MICROSOFT_CLIENT_ID -c wrangler.jsonc
npx wrangler secret put MICROSOFT_CLIENT_SECRET -c wrangler.jsonc
```

## Zasoby produkcyjne (nie usuwać)

- Bucket: `dodo-media`
- Worker: `dodo-media-sync`
- Queue: `dodo-media-archive` + DLQ `dodo-media-archive-dlq`
- Pages: `https://dodo-c39.pages.dev`

## Polityka

- Wszystkie zespoły: R2 jako hot storage (gdy Edge ma R2).
- Zespół z aktywnym SharePoint: archiwum do SP zespołu; retencja full 45 dni / załączniki 180 dni.
- Zespół bez SharePoint: pliki zostają w R2, `retention_hold`, bez `r2_delete_after`; cleanup wymaga `sp_status=verified`.
- Voice / forward / move: legacy (MVP).

## Smoke operacyjny

```powershell
node scripts/prod-media-pipeline-info.mjs   # r2Configured + r2Bucket (bez sekretów)
node scripts/prod-media-smoke.mjs           # 1 galeria + 1 załącznik (czyści synth)
node scripts/enable-r2-all-orgs.mjs         # ustawia orgs.media_pipeline=r2_sp
```
