import { canonicalToItem, normalizeToCanonical } from "@/lib/syncv3/canonical";
import {
  getActiveOperationsForEntity,
  getEntity,
  listEntities,
  openSyncV3Db,
  putEntityRecord,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import type { CanonicalItem, EntityRecord } from "@/lib/syncv3/types";
import type { Item } from "@/types";

export interface MergeRemoteItem {
  id: string;
  updatedAt: string;
  raw: Partial<Item>;
}

export interface MergeResult {
  items: Record<string, Item>;
  /** Entity IDs that still need push (pending protected). */
  protectedPendingIds: string[];
}

/**
 * Merge remote → lokalny entity store + widok.
 * Pending local nigdy nie jest nadpisywany remote payloadem.
 * Przyjęty remote jest utrwalany w IDB (bez nowej operacji).
 */
export async function mergeRemoteIntoLocal(opts: {
  userId: string;
  remoteItems: MergeRemoteItem[];
  db?: SyncV3Db;
}): Promise<MergeResult> {
  const db = opts.db ?? (await openSyncV3Db(opts.userId));
  const localEntities = await listEntities(db, opts.userId);
  const itemEntities = localEntities.filter((e) => e.entityType === "item");
  const byId = new Map(itemEntities.map((e) => [e.entityId, e]));
  const protectedPendingIds: string[] = [];
  const items: Record<string, Item> = {};

  for (const ent of itemEntities) {
    items[ent.entityId] = canonicalToItem(ent.snapshot);
  }

  for (const remote of opts.remoteItems) {
    const active = await getActiveOperationsForEntity(
      db,
      opts.userId,
      "item",
      remote.id,
    );
    if (active.length) {
      protectedPendingIds.push(remote.id);
      const local = byId.get(remote.id);
      if (local) items[remote.id] = canonicalToItem(local.snapshot);
      continue;
    }

    const local = byId.get(remote.id);
    const remoteCanon = normalizeToCanonical(remote.raw, {
      localRevision: local?.localRevision ?? 1,
      ownerUserId: opts.userId,
    });
    remoteCanon.id = remote.id;
    remoteCanon.updatedAt = remote.updatedAt;

    if (
      local &&
      new Date(local.snapshot.updatedAt).getTime() > new Date(remote.updatedAt).getTime()
    ) {
      items[remote.id] = canonicalToItem(local.snapshot);
      continue;
    }

    const entity: EntityRecord = {
      entityId: remote.id,
      entityType: "item",
      userId: opts.userId,
      snapshot: remoteCanon,
      localRevision: remoteCanon.localRevision,
      updatedAt: remoteCanon.updatedAt,
    };
    await putEntityRecord(db, entity);
    byId.set(remote.id, entity);
    items[remote.id] = canonicalToItem(remoteCanon);
  }

  return { items, protectedPendingIds };
}

export async function getLocalCanonical(
  userId: string,
  entityId: string,
  db?: SyncV3Db,
): Promise<CanonicalItem | null> {
  const database = db ?? (await openSyncV3Db(userId));
  const ent = await getEntity(database, entityId);
  return ent?.snapshot ?? null;
}
