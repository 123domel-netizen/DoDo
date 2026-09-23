import { tagAssignmentEntityId } from "@/lib/syncv3/entityIds";
import type { Group, UserTag } from "@/types";
import { isSyncV3WritesEnabledCached } from "@/lib/syncv3/activeFlag";
import { wakeSyncV3Worker } from "@/lib/syncv3/wake";
import { useStore } from "@/state/store";
import { uid } from "@/lib/factory";
import {
  commitEntityAndOperations,
  getActiveOperationsForEntity,
  newOperationId,
  openSyncV3Db,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import type {
  EntityRecord,
  EntityType,
  OperationType,
  SyncOperation,
} from "@/lib/syncv3/types";

/** Snapshot domeny innej niż item — JSON bez undefined. */
export type DomainSnapshot = Record<string, unknown> & { id: string };

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

export async function commitDomainMutation(input: {
  userId: string;
  entityType: Exclude<EntityType, "item">;
  entityId: string;
  operationType: OperationType;
  snapshot: DomainSnapshot;
  localRevision?: number;
  db?: SyncV3Db;
  applyToUi?: () => void;
}): Promise<SyncOperation> {
  const db = input.db ?? (await openSyncV3Db(input.userId));
  const now = new Date().toISOString();
  const active = await getActiveOperationsForEntity(
    db,
    input.userId,
    input.entityType,
    input.entityId,
  );
  const pending = active.find((o) => o.status === "pending");
  const revision = (input.localRevision ?? 0) + 1;
  const snapshot = stripUndefined({
    ...input.snapshot,
    id: input.entityId,
    localRevision: revision,
    updatedAt: now,
  }) as DomainSnapshot & { localRevision: number; updatedAt: string };

  const payload = snapshot as unknown as import("@/lib/syncv3/types").CanonicalItem;

  let op: SyncOperation;
  const deleteOpIds: string[] = [];
  const parentItemId =
    typeof input.snapshot.parentItemId === "string"
      ? input.snapshot.parentItemId
      : typeof input.snapshot.itemId === "string"
        ? input.snapshot.itemId
        : input.entityType === "tag_assignment"
          ? input.entityId.replace(/^ta:/, "")
          : input.entityType === "participant" || input.entityType === "personal_reminder"
            ? input.entityId.replace(/^pp:|^pr:/, "")
            : null;

  if (pending) {
    op = {
      ...pending,
      operationType: input.operationType,
      parentItemId,
      payload,
      localRevision: revision,
      updatedAt: now,
      nextAttemptAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  } else {
    op = {
      operationId: newOperationId(),
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      parentItemId,
      operationType: input.operationType,
      payload,
      localRevision: revision,
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      nextAttemptAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      status: "pending",
    };
  }

  const entity: EntityRecord = {
    entityId: input.entityId,
    entityType: input.entityType,
    userId: input.userId,
    snapshot: payload,
    localRevision: revision,
    updatedAt: now,
  };

  await commitEntityAndOperations(db, {
    entity,
    upsertOps: [op],
    deleteOpIds,
  });
  input.applyToUi?.();
  wakeSyncV3Worker();
  return op;
}

export async function persistGroupViaSyncV3(
  group: Group,
  operationType: OperationType = "upsert",
): Promise<void> {
  const userId = useStore.getState().authUserId;
  if (!userId || !isSyncV3WritesEnabledCached()) return;
  await commitDomainMutation({
    userId,
    entityType: "group",
    entityId: group.id,
    operationType,
    snapshot: { ...group },
    applyToUi: () => {
      useStore.setState((s) => {
        if (operationType === "delete") {
          return { groups: s.groups.filter((g) => g.id !== group.id) };
        }
        const exists = s.groups.some((g) => g.id === group.id);
        return {
          groups: exists
            ? s.groups.map((g) => (g.id === group.id ? group : g))
            : [...s.groups, group],
        };
      });
    },
  });
}

export async function persistTagViaSyncV3(
  tag: UserTag,
  operationType: OperationType = "upsert",
): Promise<void> {
  const userId = useStore.getState().authUserId;
  if (!userId || !isSyncV3WritesEnabledCached()) return;
  await commitDomainMutation({
    userId,
    entityType: "user_tag",
    entityId: tag.id,
    operationType,
    snapshot: { ...tag },
    applyToUi: () => {
      useStore.setState((s) => {
        if (operationType === "delete") {
          const tags = { ...s.tags };
          delete tags[tag.id];
          return { tags };
        }
        return { tags: { ...s.tags, [tag.id]: tag } };
      });
    },
  });
}

export { tagAssignmentEntityId };

export async function persistTagAssignmentViaSyncV3(
  itemId: string,
  tagIds: string[],
): Promise<void> {
  const userId = useStore.getState().authUserId;
  if (!userId || !isSyncV3WritesEnabledCached()) return;
  const entityId = tagAssignmentEntityId(itemId);
  await commitDomainMutation({
    userId,
    entityType: "tag_assignment",
    entityId,
    operationType: "upsert",
    snapshot: { id: entityId, itemId, tagIds },
    applyToUi: () => {
      useStore.setState((s) => ({
        myTagIdsByItem: { ...s.myTagIdsByItem, [itemId]: tagIds },
      }));
    },
  });
}

export function newDomainId(): string {
  return uid();
}
