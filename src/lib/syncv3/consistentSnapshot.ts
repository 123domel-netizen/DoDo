import { canonicalToItem } from "@/lib/syncv3/canonical";
import {
  deleteEntitiesBatch,
  listEntities,
  openSyncV3Db,
  type SyncV3Db,
} from "@/lib/syncv3/db";
import { parseTagAssignmentItemId } from "@/lib/syncv3/entityIds";
import { ensureShareGroup } from "@/lib/groups";
import { isShareGroup } from "@/lib/share";
import { useStore } from "@/state/store";
import type { Group, Item, UserTag } from "@/types";

/** Spójny snapshot domen powiązanych — publikowany atomowo do Zustand. */
export interface ConsistentDomainSnapshot {
  items: Record<string, Item>;
  groups: Group[];
  tags: Record<string, UserTag>;
  myTagIdsByItem: Record<string, string[]>;
}

/**
 * SHARE jest wirtualny — nie trzymamy go jako trwałej encji Sync v3.
 * Usuwa wszystkie entityType=group o nazwie/system SHARE z IDB.
 */
export async function pruneVirtualShareGroupsFromIdb(
  userId: string,
  db?: SyncV3Db,
): Promise<number> {
  const database = db ?? (await openSyncV3Db(userId));
  const entities = await listEntities(database, userId);
  const shareIds = entities
    .filter(
      (e) =>
        e.entityType === "group" &&
        isShareGroup(e.snapshot as unknown as { name: string; system?: string }),
    )
    .map((e) => e.entityId);
  return deleteEntitiesBatch(database, shareIds);
}

/**
 * Odczyt jednej spójnej projekcji z Sync v3 IDB.
 * Nie publikuje — tylko buduje snapshot.
 * SHARE z IDB jest pomijany (wirtualny); ARCH/user groups zostają.
 */
export async function buildConsistentSnapshotFromIdb(
  userId: string,
  db?: SyncV3Db,
): Promise<ConsistentDomainSnapshot> {
  const database = db ?? (await openSyncV3Db(userId));
  const entities = await listEntities(database, userId);
  const items: Record<string, Item> = {};
  const groups: Group[] = [];
  const tags: Record<string, UserTag> = {};
  const myTagIdsByItem: Record<string, string[]> = {};

  for (const ent of entities) {
    if (ent.entityType === "item") {
      items[ent.entityId] = canonicalToItem(ent.snapshot);
    } else if (ent.entityType === "group") {
      const g = ent.snapshot as unknown as Group;
      if ((ent.snapshot as { deletedAt?: string | null }).deletedAt) continue;
      if (isShareGroup(g)) continue;
      groups.push(g);
    } else if (ent.entityType === "user_tag") {
      if (!(ent.snapshot as { deletedAt?: string | null }).deletedAt) {
        tags[ent.entityId] = ent.snapshot as unknown as UserTag;
      }
    } else if (ent.entityType === "tag_assignment") {
      const snap = ent.snapshot as unknown as { itemId?: string; tagIds?: string[] };
      myTagIdsByItem[snap.itemId ?? parseTagAssignmentItemId(ent.entityId)] =
        snap.tagIds ?? [];
    } else if (ent.entityType === "participant" || ent.entityType === "personal_reminder") {
      const snap = ent.snapshot as unknown as {
        itemId?: string;
        description?: string;
        checklist?: Item["checklist"];
        attachments?: Item["attachments"];
        personalReminders?: Item["personalReminders"];
      };
      const itemId = snap.itemId ?? ent.entityId.replace(/^pp:|^pr:/, "");
      const cur = items[itemId];
      if (cur) {
        items[itemId] = {
          ...cur,
          ...(snap.description !== undefined ? { description: snap.description } : {}),
          ...(snap.checklist !== undefined ? { checklist: snap.checklist } : {}),
          ...(snap.attachments !== undefined ? { attachments: snap.attachments } : {}),
          ...(snap.personalReminders !== undefined
            ? { personalReminders: snap.personalReminders }
            : {}),
        };
      }
    }
  }

  return {
    items,
    // SHARE tylko w projekcji UI — nie zapisujemy go do IDB.
    // ARCH pochodzi z remote/IDB (nie mintujemy tu nowego id).
    groups: ensureShareGroup(groups),
    tags,
    myTagIdsByItem,
  };
}

/**
 * Atomowa publikacja kompletnego snapshotu do Zustand.
 * Nigdy nie publikuje items bez równoczesnego groups z tego samego odczytu.
 */
export function publishConsistentSnapshot(snapshot: ConsistentDomainSnapshot): void {
  useStore.setState({
    items: snapshot.items,
    groups: ensureShareGroup(snapshot.groups.filter((g) => !isShareGroup(g))),
    tags: snapshot.tags,
    myTagIdsByItem: snapshot.myTagIdsByItem,
  });
}

/**
 * Hydratacja po bootstrap / po multi-domain remote apply.
 * IDB jest źródłem prawdy dla domen sync — jeden setState.
 */
export async function hydrateConsistentSnapshot(
  userId: string,
  db?: SyncV3Db,
): Promise<ConsistentDomainSnapshot> {
  const snapshot = await buildConsistentSnapshotFromIdb(userId, db);
  publishConsistentSnapshot(snapshot);
  return snapshot;
}

/**
 * Merge pojedynczych encji z remote apply do istniejącego Zustand
 * BEZ zastępowania całej listy groups pustą / częściową.
 * Używane wyłącznie dla wąskich update'ów (realtime 1 encja).
 */
export function mergeRemotePartialIntoZustand(partial: {
  items?: Record<string, Item>;
  groups?: Group[];
  removedGroupIds?: string[];
  tags?: Record<string, UserTag>;
  myTagIdsByItem?: Record<string, string[]>;
}): void {
  useStore.setState((s) => {
    const items = partial.items ? { ...s.items, ...partial.items } : s.items;
    let groups = s.groups;
    const groupsTouched =
      Boolean(partial.removedGroupIds?.length) || Boolean(partial.groups?.length);
    if (partial.removedGroupIds?.length) {
      const rm = new Set(partial.removedGroupIds);
      groups = groups.filter((g) => !rm.has(g.id));
    }
    if (partial.groups?.length) {
      const byId = new Map(groups.map((g) => [g.id, g]));
      for (const g of partial.groups) {
        if (isShareGroup(g)) continue;
        byId.set(g.id, g);
      }
      groups = [...byId.values()];
    }
    if (groupsTouched) {
      groups = ensureShareGroup(groups.filter((g) => !isShareGroup(g)));
    }
    const tags = partial.tags ? { ...s.tags, ...partial.tags } : s.tags;
    const myTagIdsByItem = partial.myTagIdsByItem
      ? { ...s.myTagIdsByItem, ...partial.myTagIdsByItem }
      : s.myTagIdsByItem;
    return { items, groups, tags, myTagIdsByItem };
  });
}
