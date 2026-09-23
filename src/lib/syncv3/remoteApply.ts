import { canonicalToItem, normalizeToCanonical } from "@/lib/syncv3/canonical";
import {
  getActiveOperationsForEntity,
  getEntity,
  openSyncV3Db,
  putEntitiesBatch,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import { tagAssignmentEntityId } from "@/lib/syncv3/entityIds";
import type { CanonicalItem, EntityRecord, EntityType } from "@/lib/syncv3/types";
import type { Group, Item, UserTag } from "@/types";

/** Kandydat remote → lokalny entity store (bez operacji). */
export interface RemoteEntityInput {
  entityType: EntityType;
  entityId: string;
  /** Kanoniczny / domain snapshot z id. */
  snapshot: Record<string, unknown> & { id: string };
  updatedAt: string;
  /** Soft-delete / hard-remove z widoku. */
  deleted?: boolean;
}

export interface ApplyRemoteResult {
  ok: boolean;
  error: string | null;
  items: Record<string, Item>;
  groups: Group[];
  tags: Record<string, UserTag>;
  myTagIdsByItem: Record<string, string[]>;
  protectedPendingIds: string[];
  appliedEntityIds: string[];
  /** Encje przyjęte w tej transakcji (do UI). */
  applied: EntityRecord[];
}

function asCanon(snap: Record<string, unknown> & { id: string }): CanonicalItem {
  return snap as unknown as CanonicalItem;
}

/**
 * Jedyny mechanizm remote apply (pull + realtime).
 *
 * remote → validate/map → pending check → 1× txn IDB entities → commit → applyToUi
 * Błąd txn ⇒ applyToUi NIE wywołane.
 */
export async function applyRemoteEntities(opts: {
  userId: string;
  remotes: RemoteEntityInput[];
  db?: SyncV3Db;
  /** Wywoływane TYLKO po sukcesie transakcji IDB. */
  applyToUi?: (result: ApplyRemoteResult) => void;
}): Promise<ApplyRemoteResult> {
  const db = opts.db ?? (await openSyncV3Db(opts.userId));
  const protectedPendingIds: string[] = [];
  const toWrite: EntityRecord[] = [];
  const appliedEntityIds: string[] = [];

  for (const remote of opts.remotes) {
    const active = await getActiveOperationsForEntity(
      db,
      opts.userId,
      remote.entityType,
      remote.entityId,
    );
    if (active.length) {
      protectedPendingIds.push(remote.entityId);
      continue;
    }

    const local = await getEntity(db, remote.entityId);
    if (
      local &&
      !remote.deleted &&
      local.entityType === remote.entityType &&
      new Date(local.updatedAt).getTime() > new Date(remote.updatedAt).getTime()
    ) {
      continue;
    }

    let snapshot: CanonicalItem;
    if (remote.entityType === "item") {
      snapshot = normalizeToCanonical(remote.snapshot as Partial<Item>, {
        localRevision: local?.localRevision ?? 1,
        ownerUserId: opts.userId,
      });
      snapshot.id = remote.entityId;
      snapshot.updatedAt = remote.updatedAt;
      if (remote.deleted) {
        snapshot.deletedAt = snapshot.deletedAt ?? remote.updatedAt;
      }
    } else {
      snapshot = asCanon({
        ...remote.snapshot,
        id: remote.entityId,
        updatedAt: remote.updatedAt,
        localRevision: local?.localRevision ?? 1,
        ...(remote.deleted ? { deletedAt: remote.updatedAt } : {}),
      });
    }

    toWrite.push({
      entityId: remote.entityId,
      entityType: remote.entityType,
      userId: opts.userId,
      snapshot,
      localRevision: snapshot.localRevision ?? local?.localRevision ?? 1,
      updatedAt: remote.updatedAt,
    });
    appliedEntityIds.push(remote.entityId);
  }

  try {
    if (toWrite.length) {
      await putEntitiesBatch(db, toWrite);
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      items: {},
      groups: [],
      tags: {},
      myTagIdsByItem: {},
      protectedPendingIds,
      appliedEntityIds: [],
      applied: [],
    };
  }

  const items: Record<string, Item> = {};
  const groups: Group[] = [];
  const tags: Record<string, UserTag> = {};
  const myTagIdsByItem: Record<string, string[]> = {};

  for (const ent of toWrite) {
    if (ent.entityType === "item") {
      items[ent.entityId] = canonicalToItem(ent.snapshot);
    } else if (ent.entityType === "group") {
      const g = ent.snapshot as unknown as Group;
      if (!(ent.snapshot as { deletedAt?: string | null }).deletedAt) {
        groups.push(g);
      }
    } else if (ent.entityType === "user_tag") {
      if (!(ent.snapshot as { deletedAt?: string | null }).deletedAt) {
        tags[ent.entityId] = ent.snapshot as unknown as UserTag;
      }
    } else if (ent.entityType === "tag_assignment") {
      const snap = ent.snapshot as unknown as { itemId?: string; tagIds?: string[] };
      myTagIdsByItem[snap.itemId ?? ent.entityId.replace(/^ta:/, "")] = snap.tagIds ?? [];
    }
  }

  const result: ApplyRemoteResult = {
    ok: true,
    error: null,
    items,
    groups,
    tags,
    myTagIdsByItem,
    protectedPendingIds,
    appliedEntityIds,
    applied: toWrite,
  };

  opts.applyToUi?.(result);
  return result;
}

/** Helper: zbuduj RemoteEntityInput z itemu. */
export function remoteItemInput(item: Item): RemoteEntityInput {
  return {
    entityType: "item",
    entityId: item.id,
    snapshot: { ...item, id: item.id },
    updatedAt: item.updatedAt,
    deleted: Boolean(item.deletedAt),
  };
}

export function remoteGroupInput(group: Group, updatedAt?: string): RemoteEntityInput {
  return {
    entityType: "group",
    entityId: group.id,
    snapshot: { ...group, id: group.id },
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
}

export function remoteTagInput(tag: UserTag): RemoteEntityInput {
  return {
    entityType: "user_tag",
    entityId: tag.id,
    snapshot: { ...tag, id: tag.id },
    updatedAt: tag.updatedAt,
  };
}

export function remoteTagAssignmentInput(
  itemId: string,
  tagIds: string[],
  updatedAt?: string,
): RemoteEntityInput {
  const entityId = tagAssignmentEntityId(itemId);
  return {
    entityType: "tag_assignment",
    entityId,
    snapshot: { id: entityId, itemId, tagIds },
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
}
