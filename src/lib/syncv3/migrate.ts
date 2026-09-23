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
import {
  readLegacyV2Snapshot,
  type LegacyV2Snapshot,
} from "@/lib/syncv3/legacyReader";
import {
  SYNC_V3_ENGINE_VERSION,
  SYNC_V3_MIGRATION_VERSION,
  type CanonicalItem,
  type EntityRecord,
  type MigrationState,
  type SyncOperation,
  type SyncV3Meta,
} from "@/lib/syncv3/types";
import { uid } from "@/lib/factory";

export type { LegacyV2Snapshot };
export const loadLegacyFromIdb = readLegacyV2Snapshot;

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
  snapshot: CanonicalItem,
  now: string,
  entityType: SyncOperation["entityType"] = "item",
  parentItemId: string | null = null,
): SyncOperation {
  return {
    operationId: newOperationId(),
    userId,
    entityType,
    entityId,
    parentItemId:
      parentItemId ??
      (entityType === "tag_assignment"
        ? entityId.replace(/^ta:/, "")
        : entityType === "participant" || entityType === "personal_reminder"
          ? entityId.replace(/^pp:|^pr:/, "")
          : null),
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

function asCanonSnapshot(obj: Record<string, unknown> & { id: string }): CanonicalItem {
  return obj as unknown as CanonicalItem;
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
      // Nie zastępuj istniejącego backupu pustym raw — restart w trakcie migrating
      // nie może wyzerować już utworzonego dumpa.
      const backupId = meta.backupId ?? uid();
      if (!meta.backupId) {
        await putBackup(db, {
          backupId,
          userId: opts.userId,
          createdAt: now,
          zustandPersistRaw: legacy.zustandPersistRaw,
          outboxRaw: legacy.outboxRaw,
        });
      }
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
        const entity: EntityRecord = {
          entityId: id,
          entityType: "item",
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

      for (const g of legacy.groups) {
        const snap = asCanonSnapshot({
          ...g,
          id: g.id,
          localRevision: 1,
          updatedAt: now,
        });
        await commitEntityAndOperations(db, {
          entity: {
            entityId: g.id,
            entityType: "group",
            userId: opts.userId,
            snapshot: snap,
            localRevision: 1,
            updatedAt: now,
          },
          upsertOps: [],
          deleteOpIds: [],
        });
      }

      for (const tag of Object.values(legacy.tags)) {
        const snap = asCanonSnapshot({
          ...tag,
          id: tag.id,
          localRevision: 1,
          updatedAt: tag.updatedAt ?? now,
        });
        await commitEntityAndOperations(db, {
          entity: {
            entityId: tag.id,
            entityType: "user_tag",
            userId: opts.userId,
            snapshot: snap,
            localRevision: 1,
            updatedAt: snap.updatedAt,
          },
          upsertOps: [],
          deleteOpIds: [],
        });
      }

      for (const [itemId, tagIds] of Object.entries(legacy.myTagIdsByItem)) {
        const entityId = `ta:${itemId}`;
        const snap = asCanonSnapshot({
          id: entityId,
          itemId,
          tagIds,
          localRevision: 1,
          updatedAt: now,
        });
        const ops: SyncOperation[] = legacy.tagAssignmentsDirty
          ? [makePendingOp(opts.userId, entityId, snap, now, "tag_assignment", itemId)]
          : [];
        await commitEntityAndOperations(db, {
          entity: {
            entityId,
            entityType: "tag_assignment",
            userId: opts.userId,
            snapshot: snap,
            localRevision: 1,
            updatedAt: now,
          },
          upsertOps: ops,
          deleteOpIds: [],
        });
      }

      const pendingParticipants = new Set([
        ...legacy.dirtyParticipantIds,
        ...legacy.outboxParticipantIds,
      ]);
      for (const itemId of pendingParticipants) {
        const raw = legacy.items[itemId];
        if (!raw) continue;
        const entityId = `pp:${itemId}`;
        const snap = asCanonSnapshot({
          id: entityId,
          itemId,
          parentItemId: itemId,
          description: raw.description,
          checklist: raw.checklist,
          attachments: raw.attachments,
          personalReminders: raw.personalReminders,
          localRevision: 1,
          updatedAt: now,
        });
        await commitEntityAndOperations(db, {
          entity: {
            entityId,
            entityType: "participant",
            userId: opts.userId,
            snapshot: snap,
            localRevision: 1,
            updatedAt: now,
          },
          upsertOps: [makePendingOp(opts.userId, entityId, snap, now, "participant", itemId)],
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
      if (ent.entityType !== "item") continue;
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
