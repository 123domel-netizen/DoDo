# Sync v3 — kontrakt implementacyjny

**Status prac:** blockerzy pull/realtime IDB-first, usunięcie v2 writera, gate migracji i testy — na `feature/sync-v3`.
Deploy produkcyjny: **nie**.

## Granica transakcyjna (lokalne mutacje)

`commitLocalMutation` / `commitDomainMutation`:

1. kanoniczny snapshot + `localRevision`;
2. jedna transakcja IndexedDB (`entities` + `operations`);
3. commit;
4. dopiero Zustand/UI;
5. `wakeWorker()` (no-op gdy `migrationState !== active`).

## Remote apply (pull + realtime)

`applyRemoteEntities`:

1. mapowanie remote → kanoniczna encja;
2. pending check (local wygrywa);
3. jedna transakcja IDB (`putEntitiesBatch`);
4. commit;
5. dopiero `applyToUi` / Zustand.

Błąd IDB ⇒ brak zmiany UI, brak przesunięcia `lastPullAt`.

## Writer modes

| migrationState | mode | mutacje | worker push |
|----------------|------|---------|-------------|
| not_started … cutover_ready, awaiting_remote | `v3_local` | IDB entity+op | nie |
| active | `v3` | IDB entity+op | tak |
| failed | `blocked` | zablokowane | nie |

**v2 item writer usunięty z runtime** (`shouldRegisterV2ItemWriter() === false`).
Legacy: tylko read-only `loadLegacyFromIdb`.

## WARIANT A — ownership

| Domena | entityType | entityId | boundary |
|--------|------------|----------|----------|
| item (+ participants/checklist/reminders/…) | item | uuid | commitLocalMutation |
| group | group | uuid | commitDomainMutation |
| user_tag | user_tag | uuid | commitDomainMutation |
| tag_assignment | tag_assignment | `ta:{itemId}` | commitDomainMutation |

FK worker order: group → user_tag → item → participant → tag_assignment (+ defer gdy parent w tej samej kolejce).
