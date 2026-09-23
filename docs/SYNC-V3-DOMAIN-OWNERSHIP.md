# Sync v3 — domain ownership

Jedna domena = jeden writer, jeden remote-apply path, jeden auth namespace (`userId` w IDB + `authUserId` w workerze). Brak ścieżki podwójnego writera.

| Field | item | group | user_tag (tag) | tag_assignment | participant | personal_reminder |
|-------|------|-------|----------------|----------------|-------------|-------------------|
| **local entity key** | item UUID | group UUID | tag UUID | `ta:{itemId}` | `pp:{itemId}` | `pr:{itemId}` |
| **schema** | `CanonicalItem` (pełny snapshot itemu: checklist, reminders, participants[], recurrence, attachments, …) | Group JSON (`id`, `name`, `color`, `icon`, `sortOrder`, `showIn*`) | UserTag JSON (`id`, `userId`, `name`, `color`, `createdAt`, `updatedAt`) | `{ id, itemId, tagIds[] }` | `{ id, itemId, description, checklist, attachments, personalReminders, parentItemId }` — tylko dozwolone pola SHARE | `{ id, itemId, personalReminders, parentItemId }` — własne przypomnienia uczestnika |
| **mutation owner** | `commitLocalMutation` / `persistItemViaSyncV3` | `commitDomainMutation` / `persistGroupViaSyncV3` | `commitDomainMutation` / `persistTagViaSyncV3` | `commitDomainMutation` / `persistTagAssignmentViaSyncV3` | `commitDomainMutation` via `persistItemViaSyncV3` gdy `shareRole=participant` | `commitDomainMutation` (`entityType: personal_reminder`) |
| **remote apply owner** | `applyRemoteEntities` + `remoteItemInput` → IDB → UI | `applyRemoteEntities` + `remoteGroupInput` | `applyRemoteEntities` + `remoteTagInput` | `applyRemoteEntities` + `remoteTagAssignmentInput` | `applyRemoteEntities` (`entityType: participant`) — IDB-first | `applyRemoteEntities` (`entityType: personal_reminder`) — IDB-first |
| **operation type** | `upsert` \| `delete` | `upsert` \| `delete` | `upsert` \| `delete` | `upsert` | `upsert` (RPC patch; bez `items` upsert) | `upsert` (RPC patch reminders) |
| **parent deps** | opcjonalnie `groupId` → group | brak | brak | item + wymienione `user_tag` | item (`parentItemId` / `pp:` strip) | item (`parentItemId` / `pr:` strip) |
| **worker handler** | `transport.upsertItem` / `deleteItem`; po sukcesie owner: `syncOwnerParticipants` | `transport.upsertGroup` / `deleteGroup` | `transport.upsertUserTag` / `deleteUserTag` | `transport.upsertTagAssignment` (per tag row) | `transport.patchParticipant` | `transport.patchParticipant` (`personalReminders`) |
| **backend table / RPC** | `items` upsert/delete | `groups` | `user_tags` | `user_item_tag_assignments` | `item_participants` sync (owner) + `updateSharedItemContent` RPC (participant) | `updateOwnParticipationReminders` RPC |
| **ACK** | `ackOperation(operationId, localRevision)` — starszy ACK nie usuwa nowszej rewizji | jak item | jak item | jak item | jak item | jak item |
| **retry** | `pending` + `nextAttemptAt` backoff; stale `updatedAt` vs remote → ACK bez upsert | backoff | backoff | backoff; FK defer (skip pass, **bez** bump `nextAttemptAt`) gdy parent w kolejce | backoff; FK defer gdy brak / pending parent item | backoff; FK defer gdy brak / pending parent item |
| **quarantine** | permanent errors (`23502`, `23503`, `42501`, not-null, FK, RLS) — izolowane per op | jak item | jak item | jak item | forbidden field / permanent RPC error → quarantined tej op tylko | jak participant |
| **merge** | pending local chroni przed remote overwrite (`applyRemoteEntities` + `mergeRemoteIntoLocal`) | IDB-first; lokalny nowszy `updatedAt` wygrywa | jak group | jak group | IDB-first; pending participant chroniony | IDB-first; pending chroniony |
| **migration source** | Zustand persist `items` + outbox/dirty item IDs → entity + pending gdy local-only UUID ∉ remote | legacy `groups[]` | legacy `tags{}` | legacy `myTagIdsByItem` (+ dirty flag → pending) | brak osobnej migracji wierszy — uczestnicy embedded w item snapshot ownera; SHARE participant items pomijane w migrate | embedded w item `personalReminders`; osobna op tylko po mutacji uczestnika |
| **auth namespace** | `operation.userId` musi = `authUserId` worker pass; DB name `dodo-sync-v3-{userId}` | ten sam `userId` | ten sam `userId` | ten sam `userId` | ten sam `userId` — op A nigdy jako B | ten sam `userId` |

## Writer gate

| `migrationState` | mode | mutacje | worker push |
|------------------|------|---------|-------------|
| `not_started` … `cutover_ready`, `awaiting_remote` | `v3_local` | IDB entity+op | nie |
| `active` | `v3` | IDB entity+op | tak |
| `failed` | `blocked` | zablokowane | nie |

`shouldRegisterV2ItemWriter() === false` zawsze. Brak `pushDirtyParticipants` / v2 outbox writera.

## FK push order

`group` → `item` → `user_tag` → `tag_assignment` → `participant` → `personal_reminder`  
(`filterFkReadyOperations` + `entityPushOrder` w bootstrap workerze). Child deferred bez sztucznego `nextAttemptAt`.
