# R2 preview — CORS + token (bez cutoveru)

## Stan zasobów

| Zasób | Status |
|-------|--------|
| Queue `dodo-media-archive-preview` | utworzona |
| DLQ `dodo-media-archive-preview-dlq` | utworzona |
| Worker `dodo-media-sync-preview` | `wrangler.preview.jsonc` + deploy preview |
| Bucket `dodo-media-preview` | prywatny R2 (preview only) |

Bucket produkcyjny `dodo-media` **nie** jest tworzony w tym rolloutcie.

Jeśli CLI zwraca **10042**, w Dashboard Cloudflare na tym samym koncie otwórz R2 → Overview
i upewnij się, że plan/subskrypcja jest **Active**.

Po aktywacji:

```bash
cd worker
npx wrangler r2 bucket create dodo-media-preview
npx wrangler r2 bucket cors set dodo-media-preview --file r2-cors-preview.json
npx wrangler r2 bucket cors list dodo-media-preview
```

CORS (plik `r2-cors-preview.json`) — wyłącznie:

- `https://dodo-c39.pages.dev`
- `https://media-r2-preview.dodo-c39.pages.dev`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

Bucket ma pozostać **prywatny** — bez Public Development URL i bez domeny publicznej.

## Instrukcja: R2 API Token (tylko preview bucket)

**Zatrzymaj się tu przed kolejnymi krokami** (sekrety Edge / Worker — poza gitem).

1. Cloudflare Dashboard → **R2**.
2. **Manage R2 API Tokens** (lub **Overview** → **API** / **R2 API Tokens**).
3. **Create API token**.
4. Ustawienia:
   - **Token name:** np. `dodo-media-preview-rw` (etykieta lokalna).
   - **Permissions:** **Object Read & Write** (nie Admin).
   - **Apply to buckets:** **Specify bucket(s)** → wyłącznie `dodo-media-preview`.
   - **TTL / expiry:** według polityki (opcjonalnie).
5. **Create** — Dashboard pokaże **raz**:
   - Access Key ID  
   - Secret Access Key  
6. Skopiuj lokalnie do menedżera haseł (nie na czat, nie do gita).
7. **Account ID** skopiuj z Overview — potrzebny jako sekret Edge `R2_ACCOUNT_ID`.

### Gdzie wkleić (lokalnie, poza czatem / gitem)

| Wartość z Dashboard | Cel |
|---------------------|-----|
| Account ID | Supabase Edge Secret `R2_ACCOUNT_ID` |
| Access Key ID | Supabase Edge Secret `R2_ACCESS_KEY_ID` |
| Secret Access Key | Supabase Edge Secret `R2_SECRET_ACCESS_KEY` |
| (stała) | Supabase Edge Secret `R2_BUCKET` = `dodo-media-preview` |

Po utworzeniu tokenu: ustaw sekrety przez CLI/panel, wdróż Worker preview i `gallery-api`, uruchom test syntetyczny.
**Nie commituj wartości sekretów.**
