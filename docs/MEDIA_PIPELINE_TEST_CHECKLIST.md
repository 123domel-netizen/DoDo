# Media pipeline — checklista testów

Manual / CI przed włączeniem `VITE_MEDIA_PIPELINE=r2` na produkcji.

## Stage 1–2 (galerie + sync)

- [ ] 1. Create gallery (R2): karta pojawia się natychmiast, status Preparing → Uploading → Ready
- [ ] 2. Po Ready komunikat „Możesz zamknąć aplikację”
- [ ] 3. Zamknięcie PWA po Ready — Worker dokańcza SP (sp_status → verified)
- [ ] 4. Miniatury z R2 (brak round-trip Graph na kartach)
- [ ] 5. Full image dual-read: R2 gdy ready; po cleanup full → Graph
- [ ] 6. Legacy gallery (`pipeline=legacy_sp`) bez regresji
- [ ] 7. Presign wygasa — confirm bez PUT → błąd, status failed
- [ ] 8. Brak membership → 403 na presign / signed GET
- [ ] 9. Admin Ponów po `failed` → queued + Worker sync
- [ ] 10. Idempotencja: podwójny enqueue tego samego `opId` → jeden upload SP
- [ ] 15. Odłączony magazyn → `permanent_failure` + retention_hold, plik w R2
- [ ] 16. Graph 429/5xx → retry Queue, potem failed
- [ ] 17. Usunięcie galerii przed sync → noop / sp_status none
- [ ] 23. Feature flag OFF → stary tor Edge multipart
- [ ] 24. CORS R2: PUT z origin DoDo OK; obcy origin blocked
- [ ] 25. Brak sekretów/tokenów w URL klienta / logach UI
- [ ] 26. RLS: użytkownik spoza org nie widzi sync jobs
- [ ] 29. Upload 5–10 zdjęć: Ready bez czekania na SP
- [ ] 30. `r2_delete_after` ustawione dopiero po verified

## Stage 3 (załączniki / voice)

- [ ] 18. PDF/DOCX → R2 → SP `Zalaczniki/{conv}/{msg}/`
- [ ] 19. Voice message ten sam tor
- [ ] 20. Dual-read attachment (`hot/…` via `r2_signed_get`)
- [ ] 21. Legacy `chat-attachments` nadal działa przy flag OFF
- [ ] 22. Forward/move: legacy path rewrite bez crash (R2 rewrite = follow-up)

## Stage 4 (cleanup)

- [ ] Cleanup usuwa tylko full verified + due; thumbs galerii zostają
- [ ] `retention_hold` / `permanent_failure` — brak delete
- [ ] Attachment retention 180d vs gallery full 45d

## Mobile PWA

- [ ] 27. Upload w tle / po background (Ready przed kill)
- [ ] 28. Wznowienie po kill nie dubluje SP upload (idempotencja)
