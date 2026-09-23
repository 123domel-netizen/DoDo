import {
  canonicalToItem,
  normalizeToCanonical,
  validateCanonicalForPush,
} from "@/lib/syncv3/canonical";
import {
  commitEntityAndOperations,
  getActiveOperationsForEntity,
  getEntity,
  newOperationId,
  openSyncV3Db,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import type {
  CanonicalItem,
  EntityRecord,
  OperationType,
  SyncOperation,
} from "@/lib/syncv3/types";
import type { Item } from "@/types";

export type UiApplyFn = (item: Item) => void;

export interface CommitLocalMutationInput {
  userId: string;
  /** Istniejący lub nowy raw item (partial OK — normalize uzupełni). */
  draft: Partial<Item> & { id?: string };
  operationType?: OperationType;
  /** Wywoływane TYLKO po sukcesie transakcji IDB. */
  applyToUi?: UiApplyFn;
  /** Opcjonalnie współdzielona otwarta DB (testy). */
  db?: SyncV3Db;
  wakeWorker?: () => void;
}

export interface CommitLocalMutationResult {
  entity: EntityRecord;
  operation: SyncOperation;
  item: Item;
}

function buildPendingOp(
  userId: string,
  snapshot: CanonicalItem,
  operationType: OperationType,
  now: string,
  existingPending?: SyncOperation,
): SyncOperation {
  if (existingPending && existingPending.status === "pending") {
    return {
      ...existingPending,
      operationType,
      payload: snapshot,
      localRevision: snapshot.localRevision,
      updatedAt: now,
      nextAttemptAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  }
  return {
    operationId: newOperationId(),
    userId,
    entityType: "item",
    entityId: snapshot.id,
    operationType,
    payload: snapshot,
    localRevision: snapshot.localRevision,
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    nextAttemptAt: now,
    lastErrorCode: null,
    lastErrorMessage: null,
    status: "pending",
  };
}

/**
 * Atomowy zapis: IDB entity+operation → potem UI → wakeWorker.
 * Nie jest „powiadomieniem” po Zustand.
 */
export async function commitLocalMutation(
  input: CommitLocalMutationInput,
): Promise<CommitLocalMutationResult> {
  const db = input.db ?? (await openSyncV3Db(input.userId));
  const now = new Date().toISOString();
  const operationType: OperationType = input.operationType ?? "upsert";

  const existingEntity = input.draft.id
    ? await getEntity(db, input.draft.id)
    : undefined;
  const nextRevision = (existingEntity?.localRevision ?? 0) + 1;

  let snapshot = normalizeToCanonical(input.draft, {
    localRevision: nextRevision,
    ownerUserId: input.userId,
  });
  if (operationType === "delete") {
    snapshot = {
      ...snapshot,
      deletedAt: snapshot.deletedAt ?? now,
      deletedBy: snapshot.deletedBy ?? input.userId,
      updatedAt: now,
      localRevision: nextRevision,
    };
  } else {
    snapshot = { ...snapshot, updatedAt: now, localRevision: nextRevision };
  }

  const validated = validateCanonicalForPush(snapshot);
  if (!validated.ok) {
    throw new Error(`${validated.code}: ${validated.message}`);
  }
  snapshot = validated.item;

  const active = await getActiveOperationsForEntity(
    db,
    input.userId,
    "item",
    snapshot.id,
  );
  const pending = active.find((o) => o.status === "pending");
  const inFlight = active.filter((o) => o.status === "in_flight");

  const deleteOpIds: string[] = [];
  const upsertOps: SyncOperation[] = [];

  // delete zastępuje niewysłane create/update (pending)
  if (operationType === "delete" && pending) {
    deleteOpIds.push(pending.operationId);
    upsertOps.push(
      buildPendingOp(input.userId, snapshot, "delete", now, undefined),
    );
  } else if (pending && operationType === "upsert") {
    // coalescing: zastąp payload pending
    upsertOps.push(buildPendingOp(input.userId, snapshot, "upsert", now, pending));
  } else if (inFlight.length && !pending) {
    // in_flight: nowa rewizja jako osobna pending
    upsertOps.push(buildPendingOp(input.userId, snapshot, operationType, now));
  } else if (pending && operationType === "delete") {
    upsertOps.push(buildPendingOp(input.userId, snapshot, "delete", now, pending));
  } else {
    upsertOps.push(buildPendingOp(input.userId, snapshot, operationType, now, pending));
  }

  // Gdy delete i był pending — już obsłużone. Gdy upsert po delete pending — buildPendingOp.
  // Dedup: jeśli przypadkiem dwa razy ten sam pending id w deleteOpIds i upsert — OK.

  const entity: EntityRecord = {
    entityId: snapshot.id,
    entityType: "item",
    userId: input.userId,
    snapshot,
    localRevision: snapshot.localRevision,
    updatedAt: snapshot.updatedAt,
  };

  await commitEntityAndOperations(db, {
    entity,
    upsertOps,
    deleteOpIds,
  });

  const item = canonicalToItem(snapshot);
  input.applyToUi?.(item);
  input.wakeWorker?.();

  return {
    entity,
    operation: upsertOps[upsertOps.length - 1]!,
    item,
  };
}

/** Restore po delete przed ACK: upsert kasuje pending delete / coalescuje. */
export async function commitLocalRestore(
  input: Omit<CommitLocalMutationInput, "operationType"> & {
    draft: Partial<Item> & { id: string };
  },
): Promise<CommitLocalMutationResult> {
  return commitLocalMutation({
    ...input,
    draft: { ...input.draft, deletedAt: null, deletedBy: null },
    operationType: "upsert",
  });
}
