# Produkcyjne sekrety mediów (ręczne — wartości NIE na czat / NIE do gita)

## 1. Token R2 (Dashboard Cloudflare)

R2 → Manage R2 API Tokens → Create:
- Permissions: **Object Read & Write** (nie Admin)
- Apply to: **tylko** `dodo-media`
- Zapisz lokalnie Access Key ID + Secret Access Key

## 2. Edge Secrets (Supabase)

Z katalogu repo (PowerShell). Wpisz wartości w promptach / lokalnym pliku `.env.r2.prod` (gitignored), potem:

```powershell
# Opcja A — interaktywne (pojedynczo):
npx supabase secrets set R2_ACCOUNT_ID
npx supabase secrets set R2_ACCESS_KEY_ID
npx supabase secrets set R2_SECRET_ACCESS_KEY

# Stałe nazwy wartości (bezpieczne do wpisania jako literal):
npx supabase secrets set R2_BUCKET=dodo-media
npx supabase secrets set MEDIA_SYNC_HOOK_URL=https://dodo-media-sync.123domel.workers.dev/enqueue

# Wspólny hook secret (ten sam co Worker MEDIA_SYNC_HOOK_SECRET):
# Opcja: Get-Content worker\.media-hook-secret.local -Raw | npx supabase secrets set MEDIA_SYNC_HOOK_SECRET
npx supabase secrets set MEDIA_SYNC_HOOK_SECRET
```

Opcja B — plik lokalny (nie commituj):

```powershell
# .env.r2.prod (gitignored) zawiera linie KEY=value dla:
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, MEDIA_SYNC_HOOK_URL, MEDIA_SYNC_HOOK_SECRET
npx supabase secrets set --env-file .env.r2.prod
Remove-Item .env.r2.prod -Force
```

Wymagane nazwy Edge:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET` (= `dodo-media`)
- `MEDIA_SYNC_HOOK_URL` (= `https://dodo-media-sync.123domel.workers.dev/enqueue`)
- `MEDIA_SYNC_HOOK_SECRET`

## 3. Worker Secrets (produkcja `dodo-media-sync`)

```powershell
cd worker

# Z .env.local / menedżera haseł — stdin, bez echo:
# (Get-Content ... -Raw).Trim() | npx wrangler secret put NAME -c wrangler.jsonc

npx wrangler secret put SUPABASE_URL -c wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c wrangler.jsonc
npx wrangler secret put MICROSOFT_TENANT_ID -c wrangler.jsonc
npx wrangler secret put MICROSOFT_CLIENT_ID -c wrangler.jsonc
npx wrangler secret put MICROSOFT_CLIENT_SECRET -c wrangler.jsonc
npx wrangler secret put MEDIA_SYNC_HOOK_SECRET -c wrangler.jsonc
```

Wymagane nazwy Worker:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MEDIA_SYNC_HOOK_SECRET` (ten sam co Edge)

`MICROSOFT_*` możesz skopiować z wartości już ustawionych w Supabase Edge
(te same nazwy) — Wrangler nie potrafi odczytać sekretów preview/Edge.

## 4. Po sekretach

```powershell
cd worker
npx wrangler deploy -c wrangler.jsonc
npx wrangler deploy -c wrangler.preview.jsonc
cd ..
npx supabase functions deploy gallery-api
$env:VITE_MEDIA_PIPELINE='r2'; npm run deploy
```

## 5. Weryfikacja (bez sekretów)

```powershell
curl https://dodo-media-sync.123domel.workers.dev/health
npx wrangler secret list -c worker/wrangler.jsonc
npx supabase secrets list
```
