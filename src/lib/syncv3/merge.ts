import { canonicalToItem, normalizeToCanonical } from "@/lib/syncv3/canonical";
import {
  getActiveOperationsForEntity,
  getEntity,
  listEntities,
  openSyncV3Db,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import type { CanonicalItem } from "@/lib/syncv3/types";
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
 * Merge remote → lokalny widok.
 * Pending local nigdy nie jest nadpisywany starszym/równym remote payloadem.
 */
export async function mergeRemoteIntoLocal(opts: {
  userId: string;
  remoteItems: MergeRemoteItem[];
  db?: SyncV3Db;
}): Promise<MergeResult> {
  const db = opts.db ?? (await openSyncV3Db(opts.userId));
  const localEntities = await listEntities(db, opts.userId);
  const byId = new Map(localEntities.map((e) => [e.entityId, e]));
  const protectedPendingIds: string[] = [];
  const items: Record<string, Item> = {};

  for (const ent of localEntities) {
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
      // zachowaj lokalny pending snapshot
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
