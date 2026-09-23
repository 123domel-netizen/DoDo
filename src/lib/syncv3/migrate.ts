import { get as idbGet } from "idb-keyval";
import { normalizeToCanonical } from "@/lib/syncv3/canonical";
import {
  commitEntityAndOperations,
  getActiveOperationsForEntity,
  getMeta,
  listEntities,
  newOperationId,
  openSyncV3Db,
  putBackup,
  putMeta,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import { loadOutbox } from "@/lib/syncOutbox";
import type { Item } from "@/types";
import {
  SYNC_V3_ENGINE_VERSION,
  SYNC_V3_MIGRATION_VERSION,
  type MigrationState,
  type SyncOperation,
  type SyncV3Meta,
} from "@/lib/syncv3/types";
import { uid } from "@/lib/factory";

export interface LegacyV2Snapshot {
  items: Record<string, Item>;
  dirtyItemIds: string[];
  dirtyParticipantIds: string[];
  outboxItemIds: string[];
  outboxParticipantIds: string[];
  tagAssignmentsDirty: boolean;
  zustandPersistRaw: unknown;
  outboxRaw: unknown;
}

export interface RemoteIdProvider {
  fetchRemoteItemIds(userId: string): Promise<{ ids: string[]; error: string | null }>;
}

export interface MigrateOptions {
  userId: string;
  loadLegacy: () => Promise<LegacyV2Snapshot>;
  remote: RemoteIdProvider;
  db?: SyncV3Db;
  now?: () => string;
}

function setState(
  meta: SyncV3Meta,
  state: MigrationState,
  patch?: Partial<SyncV3Meta>,
): SyncV3Meta {
  return { ...meta, migrationState: state, ...patch };
}

function makePendingOp(
  userId: string,
  entityId: string,
  snapshot: ReturnType<typeof normalizeToCanonical>,
  now: string,
): SyncOperation {
  return {
    operationId: newOperationId(),
    userId,
    entityType: "item",
    entityId,
    operationType: snapshot.deletedAt ? "delete" : "upsert",
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
 * Idempotentna migracja v2 → v3.
 * Local-only = lokalny UUID ∉ remote (tylko po udanym fetchu). Nigdy po tytule.
 */
export async function runSyncV3Migration(opts: MigrateOptions): Promise<SyncV3Meta> {
  const db = opts.db ?? (await openSyncV3Db(opts.userId));
  const now = opts.now?.() ?? new Date().toISOString();
  let meta = await getMeta(db);

  if (meta.migrationState === "active" && meta.migrationVersion >= SYNC_V3_MIGRATION_VERSION) {
    return meta;
  }

  if (meta.migrationState === "not_started" || meta.migrationState === "failed") {
    meta = setState(meta, "backing_up", {
      startedAt: now,
      lastMigrationError: null,
      engineVersion: SYNC_V3_ENGINE_VERSION,
    });
    await putMeta(db, meta);
  }

  if (meta.migrationState === "backing_up" || meta.migrationState === "migrating") {
    if (meta.migrationState === "backing_up") {
      const legacy = await opts.loadLegacy();
      const backupId = meta.backupId ?? uid();
      await putBackup(db, {
        backupId,
        userId: opts.userId,
        createdAt: now,
        zustandPersistRaw: legacy.zustandPersistRaw,
        outboxRaw: legacy.outboxRaw,
      });
      meta = setState(meta, "migrating", { backupId });
      await putMeta(db, meta);

      const pendingIds = new Set([...legacy.dirtyItemIds, ...legacy.outboxItemIds]);

      for (const [id, raw] of Object.entries(legacy.items)) {
        if (raw.shareRole === "participant") continue;
        const snapshot = normalizeToCanonical(
          { ...raw, id },
          { localRevision: 1, ownerUserId: opts.userId },
        );
        snapshot.id = id;
        const entity = {
          entityId: id,
          entityType: "item" as const,
          userId: opts.userId,
          snapshot,
          localRevision: 1,
          updatedAt: snapshot.updatedAt,
        };
        const ops: SyncOperation[] = pendingIds.has(id)
          ? [makePendingOp(opts.userId, id, snapshot, now)]
          : [];
        await commitEntityAndOperations(db, {
          entity,
          upsertOps: ops,
          deleteOpIds: [],
        });
      }
    }

    meta = setState(meta, "verifying");
    await putMeta(db, meta);
  }

  if (meta.migrationState === "verifying" || meta.migrationState === "awaiting_remote") {
    const { ids, error } = await opts.remote.fetchRemoteItemIds(opts.userId);
    if (error) {
      meta = setState(meta, "awaiting_remote", { lastMigrationError: error });
      await putMeta(db, meta);
      return meta;
    }

    const remote = new Set(ids);
    const entities = await listEntities(db, opts.userId);

    for (const ent of entities) {
      if (ent.snapshot.shareRole === "participant") continue;
      if (remote.has(ent.entityId)) continue;
      const active = await getActiveOperationsForEntity(
        db,
        opts.userId,
        "item",
        ent.entityId,
      );
      if (active.length) continue;
      await commitEntityAndOperations(db, {
        entity: ent,
        upsertOps: [makePendingOp(opts.userId, ent.entityId, ent.snapshot, now)],
        deleteOpIds: [],
      });
    }

    meta = setState(meta, "cutover_ready", { lastMigrationError: null });
    await putMeta(db, meta);
  }

  if (meta.migrationState === "cutover_ready") {
    meta = setState(meta, "active", {
      migrationVersion: SYNC_V3_MIGRATION_VERSION,
      completedAt: now,
      lastMigrationError: null,
    });
    await putMeta(db, meta);
  }

  return meta;
}

export async function loadLegacyFromIdb(userId: string): Promise<LegacyV2Snapshot> {
  const persistKey = `kalendarz-todo-v1-${userId}`;
  const raw = await idbGet(persistKey);
  let items: Record<string, Item> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { state?: { items?: Record<string, Item> } };
      items = parsed?.state?.items ?? {};
    } catch {
      items = {};
    }
  } else if (raw && typeof raw === "object") {
    const parsed = raw as { state?: { items?: Record<string, Item> } };
    items = parsed?.state?.items ?? {};
  }

  const outbox = await loadOutbox(userId);
  return {
    items,
    dirtyItemIds: [...outbox.itemIds],
    dirtyParticipantIds: [...outbox.participantIds],
    outboxItemIds: [...outbox.itemIds],
    outboxParticipantIds: [...outbox.participantIds],
    tagAssignmentsDirty: outbox.tagAssignmentsDirty,
    zustandPersistRaw: raw ?? null,
    outboxRaw: outbox,
  };
}
