# Sync v3 — kontrakt implementacyjny

## Granica transakcyjna

`commitLocalMutation`:

1. wylicz kanoniczny snapshot + `localRevision`;
2. otwórz **jedną** transakcję IndexedDB (`entities` + `operations`);
3. zapisz entity;
4. zapisz / zaktualizuj operation (coalescing);
5. commit transakcji;
6. **dopiero potem** aktualizuj Zustand/UI;
7. `wakeWorker()`.

Niepowodzenie transakcji ⇒ UI nie pokazuje trwałego zapisu.

## Coalescing i revision

- Indeks: `userId + entityType + entityId` → aktywne operacje.
- `pending`: kolejna edycja **zastępuje** payload tej samej operacji i podnosi `localRevision`.
- `in_flight`: nowa edycja tworzy **nową** operację z wyższym `localRevision`.
- ACK usuwa wyłącznie `operationId` o danej rewizji; nowsza pending zostaje.
- `delete` zastępuje niewysłane create/update (jeden deterministyczny wynik).
- Worker wysyła snapshot z operacji, nigdy „stary” z entity bez uwzględnienia nowszej op.

## Idempotencja względem Supabase

`operationId` jest **lokalnym** ID kolejki, nie kluczem backendowym.

Idempotencja chmury:

- stabilny `item.id` (UUID) jako klucz upsertu;
- pełny kanoniczny snapshot w każdym upsertcie;
- `updated_at` / `localRevision` — retry nie może nadpisać nowszego remote starszym snapshotem (porównanie przed apply / skip stale);
- powtarzalny `upsert` po `id`.

## Rollback

- Przed cutoverem (`migrationState !== active`): powrót do v2 dozwolony.
- Po pierwszej mutacji v3 / stanie `active`: **brak** automatycznego włączania writera v2.
- Rollback aplikacji musi czytać outbox v3 albo tryb read-only bez nowych mutacji.
- Stary storage = backup, nie auto-reaktywacja v2.

## Stan migracji (per user)

Pola: `engineVersion`, `migrationVersion`, `migrationState`, `backupId`, `startedAt`, `completedAt`, `lastMigrationError`.

Stany: `not_started` → `backing_up` → `migrating` → `verifying` → `cutover_ready` → `active` | `failed` | `awaiting_remote`.

Writer v3 startuje tylko przy `active`. Writer v2 wyłączany atomowo przy przejściu do `active`.

Błąd remote IDs w trakcie weryfikacji ⇒ `awaiting_remote`, bez uznawania wszystkiego za local-only, bez utraty backupu/encji.
