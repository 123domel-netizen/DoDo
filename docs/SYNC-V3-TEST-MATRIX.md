# Sync v3 — test matrix (mandatory 1–30 + participant + FK)

Każdy wiersz ma dedykowany `it(...)` w `src/lib/syncv3/matrix30.test.ts` (oraz lifecycle w `lifecycle.e2e.test.ts`). Status: `covered` = asercje w named test.

| # | name | test file | exact test name | layer | status | what it proves |
|---|------|-----------|-----------------|-------|--------|----------------|
| 1 | auth switch z pending A | `matrix30.test.ts` | `1. auth switch z pending A` | worker/auth | covered | Ops usera A nie są pushowane gdy `authUserId` = B; pending zostaje |
| 2 | auth flicker A → null → A | `matrix30.test.ts` | `2. auth flicker A → null → A` | bootstrap/auth | covered | Po A→null→A pending i meta `active` przetrwają w IDB usera A |
| 3 | operacja A nie może zostać wysłana jako B | `matrix30.test.ts` | `3. operacja A nie może zostać wysłana jako B` | worker/auth | covered | `authUserId !== userId` ⇒ `processed=0`, op zostaje |
| 4 | starszy ACK nie usuwa nowszej operacji | `matrix30.test.ts` | `4. starszy ACK nie usuwa nowszej operacji` | db/ACK | covered | ACK starszej rewizji zostawia nowszy pending |
| 5 | retry starego snapshotu nie nadpisuje nowszego remote | `matrix30.test.ts` | `5. retry starego snapshotu nie nadpisuje nowszego remote` | worker/stale | covered | Stale `updatedAt` ⇒ ACK bez `upsertItem` |
| 6 | edycja podczas in_flight | `matrix30.test.ts` | `6. edycja podczas in_flight` | mutation | covered | Edycja przy `in_flight` tworzy osobny pending z nowszą rewizją |
| 7 | create → edit → delete przed ACK | `matrix30.test.ts` | `7. create → edit → delete przed ACK` | mutation | covered | Coalesce do jednej pending `delete` |
| 8 | delete → restore przed ACK | `matrix30.test.ts` | `8. delete → restore przed ACK` | mutation | covered | Restore ⇒ pending `upsert` bez `deletedAt` |
| 9 | poison item przed zdrową operacją | `matrix30.test.ts` | `9. poison item przed zdrową operacją` | worker/quarantine | covered | Quarantine poison nie blokuje ACK zdrowej op |
| 10 | restart przed push | `matrix30.test.ts` | `10. restart przed push` | durability | covered | Po reopen IDB pending nadal ready |
| 11 | restart podczas in_flight | `matrix30.test.ts` | `11. restart podczas in_flight` | durability | covered | `in_flight` + nowy pending przetrwają reopen |
| 12 | restart w każdym migrationState | `matrix30.test.ts` | `12. restart w każdym migrationState` | migration | covered | Restart z każdego stanu kończy się `active` (lub `awaiting_remote` przy błędzie remote) |
| 13 | remote IDs fetch error | `matrix30.test.ts` | `13. remote IDs fetch error` | migration | covered | Błąd fetch ⇒ `awaiting_remote`, encje zachowane |
| 14 | offline podczas migracji | `matrix30.test.ts` | `14. offline podczas migracji` | migration | covered | Offline = remote error path; nie aktywuje cutover |
| 15 | zamknięcie podczas backup | `matrix30.test.ts` | `15. zamknięcie podczas backup` | migration | covered | Meta `backing_up` + restart ⇒ migracja wznawia się do `active` |
| 16 | zamknięcie podczas migracji entities | `matrix30.test.ts` | `16. zamknięcie podczas migracji entities` | migration | covered | Meta `migrating` + restart ⇒ `active`, backup nietknięty |
| 17 | zamknięcie podczas verifying | `matrix30.test.ts` | `17. zamknięcie podczas verifying` | migration | covered | Meta `verifying` + restart ⇒ `active` |
| 18 | service worker update z pending | `matrix30.test.ts` | `18. service worker update z pending` | PWA | covered | Symulowany reload bundle: ops + `active` w IDB |
| 19 | nowy bundle odtwarza outbox v3 | `matrix30.test.ts` | `19. nowy bundle odtwarza outbox v3` | PWA | covered | Reopen DB = odtworzenie operations store |
| 20 | rollback bundle nie ignoruje v3 operations | `matrix30.test.ts` | `20. rollback bundle nie ignoruje v3 operations` | PWA | covered | Po „rollback” (reopen) worker nadal ACK-uje pending |
| 21 | klient B pobiera bez realtime | `matrix30.test.ts` | `21. klient B pobiera bez realtime` | multi-client | covered | B stosuje remote wyłącznie przez `applyRemoteEntities` |
| 22 | restart klienta B | `matrix30.test.ts` | `22. restart klienta B` | multi-client | covered | Po apply + reopen B czyta encję z IDB |
| 23 | groups/tags remote apply po restarcie | `matrix30.test.ts` | `23. groups/tags remote apply po restarcie` | remote apply | covered | Group/tag/assignment w IDB po reopen |
| 24 | IDB failure podczas remote apply | `matrix30.test.ts` | `24. IDB failure podczas remote apply` | remote apply | covered | Błąd IDB ⇒ `ok=false`, brak `applyToUi` |
| 25 | brak manual flush | `matrix30.test.ts` | `25. brak manual flush` | UX guard | covered | Brak SyncPendingBanner / „Wyślij teraz” / flushPendingPush w UI |
| 26 | brak aktywnego v2 writer | `matrix30.test.ts` | `26. brak aktywnego v2 writer` | writer gate | covered | `shouldRegisterV2ItemWriter() === false` |
| 27 | realny fixture v2 local-only migruje | `matrix30.test.ts` | `27. realny fixture v2 local-only migruje` | migration | covered | Real persist+outbox → `active` + pending local-only |
| 28 | stary storage pozostaje nietknięty | `matrix30.test.ts` | `28. stary storage pozostaje nietknięty` | migration | covered | Zustand persist key i outbox v2 nie są kasowane |
| 29 | backup nie zostaje zastąpiony pustym snapshotem | `matrix30.test.ts` | `29. backup nie zostaje zastąpiony pustym snapshotem` | migration | covered | Restart z pustym legacy nie wyciera backupu |
| 30 | błąd jednej domeny nie blokuje innych domen | `matrix30.test.ts` | `30. błąd jednej domeny nie blokuje innych domen` | worker | covered | Quarantine group nie blokuje item upsert |

## Participant path

| name | test file | exact test name | status |
|------|-----------|-----------------|--------|
| owner adds participant via item upsert + syncOwnerParticipants | `matrix30.test.ts` | `participant: owner adds participant via item upsert + syncOwnerParticipants` | covered |
| participant changes allowed fields via patchParticipant | `matrix30.test.ts` | `participant: participant changes allowed fields via patchParticipant` | covered |
| forbidden change quarantines that op only | `matrix30.test.ts` | `participant: forbidden change quarantines that op only` | covered |
| participant error does not block new item | `matrix30.test.ts` | `participant: participant error does not block new item` | covered |
| parent item before participant | `matrix30.test.ts` | `participant: parent item before participant` | covered |
| participant waits if parent missing | `matrix30.test.ts` | `participant: participant waits if parent missing` | covered |
| restart preserves participant op | `matrix30.test.ts` | `participant: restart preserves participant op` | covered |
| auth switch does not send A as B | `matrix30.test.ts` | `participant: auth switch does not send A as B` | covered |
| participant remote apply IDB-first | `matrix30.test.ts` | `participant: participant remote apply IDB-first` | covered |
| no pushDirtyParticipants in source | `matrix30.test.ts` | `participant: no pushDirtyParticipants in source` | covered |

## FK dependencies

| name | test file | exact test name | status |
|------|-----------|-----------------|--------|
| group before item | `matrix30.test.ts` | `FK: group before item` | covered |
| item before tag assignment | `matrix30.test.ts` | `FK: item before tag assignment` | covered |
| tag before tag assignment | `matrix30.test.ts` | `FK: tag before tag assignment` | covered |
| item before participant | `matrix30.test.ts` | `FK: item before participant` | covered |
| item before personal reminder | `matrix30.test.ts` | `FK: item before personal reminder` | covered |
| broken parent does not block independent item | `matrix30.test.ts` | `FK: broken parent does not block independent item` | covered |
| broken tag does not block event without that tag | `matrix30.test.ts` | `FK: broken tag does not block event without that tag` | covered |
| after parent repair child auto-sends | `matrix30.test.ts` | `FK: after parent repair child auto-sends` | covered |
| restart preserves dependencies | `matrix30.test.ts` | `FK: restart preserves dependencies` | covered |

## Lifecycle (full two-client)

| name | test file | exact test name | status |
|------|-----------|-----------------|--------|
| A offline create → close → new A online → worker → B pull | `lifecycle.e2e.test.ts` | `lifecycle: A creates offline, closes, new A online, worker restores, backend accepts, B pulls — no manual send` | covered |

Public APIs only: `bootstrapSyncV3` (mocked cloud), `commitLocalMutation` / `persistItemViaSyncV3`, `runSyncV3WorkerPass` + transport mock, `applyRemoteEntities`. Bez ręcznego insertu ops / prywatnego ACK / pomijania bootstrap migration / bezpośredniego Zustand z remote.
