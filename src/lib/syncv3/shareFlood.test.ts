import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureShareGroup, countShareGroups } from "@/lib/groups";
import { SHARE_GROUP_STABLE_ID, isShareGroup } from "@/lib/share";
import {
  buildConsistentSnapshotFromIdb,
  hydrateConsistentSnapshot,
  pruneVirtualShareGroupsFromIdb,
} from "@/lib/syncv3/consistentSnapshot";
import { deleteSyncV3Db, listEntities, openSyncV3Db, putEntitiesBatch } from "@/lib/syncv3/db";
import type { EntityRecord } from "@/lib/syncv3/types";
import { applyRemoteEntities, remoteGroupInput, remoteItemInput } from "@/lib/syncv3/remoteApply";
import { useStore } from "@/state/store";
import type { Group, Item } from "@/types";

const USER = `user-share-flood-${Math.random().toString(16).slice(2, 10)}`;
const GROUP_IB = "c87b4bb4-cf77-46bd-a17a-0b371236be97";
const GROUP_SAND = "c793fbc3-fcd1-40f7-9e92-830fb75b7481";
const GROUP_ARCH = "74a7c5a5-31bb-41a9-aba6-8df23174dfc0";
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function baseGroup(id: string, name: string, color = "#C08F52", system?: Group["system"]): Group {
  return { id, name, color, sortOrder: 0, system };
}

function baseItem(id: string, title: string, groupId: string | null): Item {
  return {
    id,
    title,
    type: "event",
    start: "2026-09-24T10:00:00.000Z",
    end: "2026-09-24T11:00:00.000Z",
    allDay: false,
    hasDueDate: true,
    showInCalendar: true,
    done: false,
    groupId,
    description: "",
    checklist: [],
    participants: [],
    attachments: [],
    reminders: [],
    deadlineAt: null,
    recurrence: null,
    tagIds: [],
    pinnedAt: null,
    preArchiveGroupId: null,
    groupPromptDismissed: false,
    shareRole: "owner",
    ownerUserId: USER,
    deletedAt: null,
    deletedBy: null,
    personalReminders: [],
    createdAt: "2026-09-24T10:00:00.000Z",
    updatedAt: "2026-09-24T10:00:00.000Z",
  } as unknown as Item;
}

function groupEntity(
  id: string,
  name: string,
  color: string,
  system: Group["system"] | undefined,
  updatedAt: string,
): EntityRecord {
  return {
    entityId: id,
    entityType: "group",
    userId: USER,
    snapshot: {
      id,
      name,
      color,
      sortOrder: system === "share" ? 9500 : system === "archive" ? 9999 : 0,
      system,
      updatedAt,
      localRevision: 1,
    } as unknown as EntityRecord["snapshot"],
    localRevision: 1,
    updatedAt,
  };
}

function itemEntity(item: Item, updatedAt: string): EntityRecord {
  return {
    entityId: item.id,
    entityType: "item",
    userId: USER,
    snapshot: { ...item, localRevision: 1 } as unknown as EntityRecord["snapshot"],
    localRevision: 1,
    updatedAt,
  };
}

async function withUserDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openSyncV3Db(USER);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

describe("SHARE flood / group rail recovery", () => {
  beforeEach(() => {
    useStore.setState({
      items: {},
      groups: [],
      tags: {},
      myTagIdsByItem: {},
      authUserId: USER,
    });
  });

  afterEach(async () => {
    await deleteSyncV3Db(USER);
  });

  it("ensureShareGroup never mints a second SHARE uuid", () => {
    const once = ensureShareGroup([baseGroup(GROUP_IB, "IB PROJEKT")]);
    expect(countShareGroups(once)).toBe(1);
    expect(once.find(isShareGroup)?.id).toBe(SHARE_GROUP_STABLE_ID);

    const flooded = [
      ...once,
      baseGroup("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "SHARE", "#8b8d94", "share"),
      baseGroup("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "SHARE", "#8b8d94", "share"),
    ];
    const fixed = ensureShareGroup(flooded);
    expect(countShareGroups(fixed)).toBe(1);
    expect(fixed.find(isShareGroup)?.id).toBe(SHARE_GROUP_STABLE_ID);
    expect(fixed.some((g) => g.id === GROUP_IB)).toBe(true);
  });

  it("pruneVirtualShareGroupsFromIdb removes SHARE flood and keeps real groups", async () => {
    await withUserDb(async (db) => {
      const now = new Date().toISOString();
      const shareFlood = Array.from({ length: 50 }, (_, i) => {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        return groupEntity(id, "SHARE", "#8b8d94", "share", now);
      });
      await putEntitiesBatch(db, [
        ...shareFlood,
        groupEntity(GROUP_IB, "IB PROJEKT", "#C08F52", undefined, now),
      ]);

      const removed = await pruneVirtualShareGroupsFromIdb(USER, db);
      expect(removed).toBe(50);
      const left = await listEntities(db, USER);
      expect(left.filter((e) => e.entityType === "group")).toHaveLength(1);
      expect(left[0]?.entityId).toBe(GROUP_IB);
    });
  });

  it("hydrate ignores SHARE flood and still shows user groups + one virtual SHARE", async () => {
    await withUserDb(async (db) => {
      const now = new Date().toISOString();
      await putEntitiesBatch(db, [
        groupEntity("ffffffff-ffff-4fff-8fff-ffffffffffff", "SHARE", "#8b8d94", "share", now),
        groupEntity(GROUP_SAND, "SAND", "#7A6CB8", undefined, now),
        itemEntity(baseItem(ITEM_A, "Bachusz podpisy", GROUP_SAND), now),
      ]);

      const snap = await hydrateConsistentSnapshot(USER, db);
      expect(snap.groups.filter((g) => g.name === "SAND")).toHaveLength(1);
      expect(countShareGroups(snap.groups)).toBe(1);
      expect(snap.groups.find(isShareGroup)?.id).toBe(SHARE_GROUP_STABLE_ID);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_SAND);
    });
  });

  it("pull-like apply restores real groups after SHARE-only IDB and keeps item.groupId", async () => {
    await withUserDb(async (db) => {
      const now = new Date().toISOString();
      await putEntitiesBatch(db, [
        ...Array.from({ length: 20 }, (_, i) => {
          const id = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
          return groupEntity(id, "SHARE", "#8b8d94", "share", now);
        }),
        itemEntity(baseItem(ITEM_A, "Jedynak", GROUP_IB), now),
      ]);

      await pruneVirtualShareGroupsFromIdb(USER, db);

      const remoteGroups = [
        baseGroup(GROUP_IB, "IB PROJEKT", "#C08F52"),
        baseGroup(GROUP_SAND, "SAND", "#7A6CB8"),
        baseGroup(GROUP_ARCH, "ARCH", "#6A7280", "archive"),
      ];
      const result = await applyRemoteEntities({
        userId: USER,
        db,
        remotes: [
          ...remoteGroups.map((g) => remoteGroupInput(g)),
          remoteItemInput(baseItem(ITEM_A, "Jedynak", GROUP_IB)),
        ],
      });
      expect(result.ok).toBe(true);

      const snap = await buildConsistentSnapshotFromIdb(USER, db);
      await hydrateConsistentSnapshot(USER, db);

      const names = snap.groups.map((g) => g.name).sort();
      expect(names).toEqual(["ARCH", "IB PROJEKT", "SAND", "SHARE"].sort());
      expect(countShareGroups(useStore.getState().groups)).toBe(1);
      expect(useStore.getState().groups.some((g) => g.id === GROUP_IB)).toBe(true);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_IB);

      const userRail = useStore
        .getState()
        .groups.filter((g) => !isShareGroup(g) && g.system !== "archive");
      expect(userRail.map((g) => g.name).sort()).toEqual(["IB PROJEKT", "SAND"]);
    });
  });

  it("repeated ensureShareGroup + publish does not grow SHARE count", () => {
    let groups = [baseGroup(GROUP_IB, "IB PROJEKT")];
    for (let i = 0; i < 100; i++) {
      groups = ensureShareGroup(groups);
    }
    expect(countShareGroups(groups)).toBe(1);
    expect(groups.find(isShareGroup)?.id).toBe(SHARE_GROUP_STABLE_ID);
  });
});
