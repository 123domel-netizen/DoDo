import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { commitLocalMutation } from "@/lib/syncv3/mutation";
import { commitDomainMutation } from "@/lib/syncv3/domains";
import {
  applyRemoteEntities,
  remoteGroupInput,
  remoteItemInput,
} from "@/lib/syncv3/remoteApply";
import {
  buildConsistentSnapshotFromIdb,
  hydrateConsistentSnapshot,
  mergeRemotePartialIntoZustand,
  publishConsistentSnapshot,
} from "@/lib/syncv3/consistentSnapshot";
import { applyRemoteResultToZustand } from "@/lib/syncv3/cloudRemoteBridge";
import {
  deleteSyncV3Db,
  openSyncV3Db,
  putEntitiesBatch,
  putMeta,
} from "@/lib/syncv3/db";
import { DEFAULT_META } from "@/lib/syncv3/types";
import { useStore } from "@/state/store";
import { uid } from "@/lib/factory";
import type { Group, Item } from "@/types";

const GROUP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_A = "11111111-1111-4111-8111-111111111111";
const ITEM_B = "22222222-2222-4222-8222-222222222222";

function baseGroup(id: string, name: string): Group {
  return {
    id,
    name,
    color: "#4A8FC4",
    sortOrder: 0,
    showInSidebar: true,
    showInTasks: true,
    showInEvents: true,
    showInDashboard: true,
    showInAll: true,
  };
}

function baseItem(id: string, groupId: string | null, title: string): Partial<Item> {
  return {
    id,
    type: "event",
    title,
    groupId,
    start: "2026-09-24T10:00:00.000Z",
    end: "2026-09-24T11:00:00.000Z",
    showInCalendar: true,
    showInTodo: false,
  };
}

async function withDb(run: (ctx: { userId: string; db: Awaited<ReturnType<typeof openSyncV3Db>> }) => Promise<void>) {
  const userId = uid();
  const db = await openSyncV3Db(userId);
  await putMeta(db, { ...DEFAULT_META, migrationState: "active", migrationVersion: 1 });
  try {
    await run({ userId, db });
  } finally {
    db.close();
    await deleteSyncV3Db(userId);
  }
}

beforeEach(() => {
  useStore.setState({
    items: {},
    groups: [],
    tags: {},
    myTagIdsByItem: {},
    authUserId: null,
  });
});

describe("Sync v3 — group consistency", () => {
  it("1. items hydrate before groups: UI never publishes items-only without groups from same snapshot", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "Firma A") },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: baseItem(ITEM_A, GROUP_A, "Bachusz"),
      });

      // Symuluj błędną starą ścieżkę: najpierw items w store, groups puste
      useStore.setState({ items: {}, groups: [] });
      const snap = await buildConsistentSnapshotFromIdb(userId, db);
      expect(Object.keys(snap.items).length).toBeGreaterThan(0);
      expect(snap.groups.some((g) => g.id === GROUP_A)).toBe(true);

      const renders: Array<{ itemGroupIds: (string | null)[]; groupIds: string[] }> = [];
      const unsub = useStore.subscribe((s) => {
        renders.push({
          itemGroupIds: Object.values(s.items).map((i) => i.groupId),
          groupIds: s.groups.map((g) => g.id),
        });
      });
      publishConsistentSnapshot(snap);
      unsub();

      for (const r of renders) {
        const hasItemsWithGroup = r.itemGroupIds.some((id) => id === GROUP_A);
        if (hasItemsWithGroup) {
          expect(r.groupIds).toContain(GROUP_A);
        }
      }
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
    });
  });

  it("2. groups hydrate before items: final snapshot is consistent", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "Rodzinne") },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: baseItem(ITEM_A, GROUP_A, "event"),
      });
      await hydrateConsistentSnapshot(userId, db);
      expect(useStore.getState().groups.map((g) => g.id)).toContain(GROUP_A);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
    });
  });

  it("3. delayed groups pull: existing groups stay visible", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "SAND") },
      });
      await hydrateConsistentSnapshot(userId, db);
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);

      // Opóźniony apply tylko itemów — merge partial nie czyści groups
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            ...(baseItem(ITEM_B, GROUP_A, "late") as Item),
            id: ITEM_B,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: "",
            allDay: false,
            done: false,
            hasDueDate: false,
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
            ownerUserId: userId,
            deletedAt: null,
            deletedBy: null,
            personalReminders: [],
          } as Item),
        ],
        applyToUi: applyRemoteResultToZustand,
      });
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
    });
  });

  it("4. groups pull error: local groups are not cleared", async () => {
    useStore.setState({ groups: [baseGroup(GROUP_A, "keep")] });
    // Błąd = brak apply; store nietknięty
    mergeRemotePartialIntoZustand({});
    expect(useStore.getState().groups.map((g) => g.id)).toEqual([GROUP_A]);
  });

  it("5. empty incomplete result does not replace local groups with []", async () => {
    useStore.setState({ groups: [baseGroup(GROUP_A, "keep")] });
    applyRemoteResultToZustand({
      ok: true,
      error: null,
      items: {},
      groups: [],
      tags: {},
      myTagIdsByItem: {},
      protectedPendingIds: [],
      appliedEntityIds: [],
      applied: [],
    });
    expect(useStore.getState().groups.map((g) => g.id)).toEqual([GROUP_A]);
  });

  it("6. true empty complete snapshot from IDB publishes only virtual SHARE", async () => {
    await withDb(async ({ userId, db }) => {
      useStore.setState({ groups: [baseGroup(GROUP_A, "stale-ui")] });
      await hydrateConsistentSnapshot(userId, db);
      // IDB puste groups → brak user groups; SHARE tylko wirtualny w UI
      const groups = useStore.getState().groups;
      expect(groups.every((g) => g.id !== GROUP_A)).toBe(true);
      expect(groups.filter((g) => g.name === "SHARE")).toHaveLength(1);
    });
  });

  it("7. realtime item update does not clear groups", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "G") },
      });
      await hydrateConsistentSnapshot(userId, db);
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM_A,
            type: "event",
            title: "rt",
            groupId: GROUP_A,
            start: "2026-09-24T10:00:00.000Z",
            end: "2026-09-24T11:00:00.000Z",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: "",
            allDay: false,
            showInCalendar: true,
            showInTodo: false,
            done: false,
            hasDueDate: false,
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
            ownerUserId: userId,
            deletedAt: null,
            deletedBy: null,
            personalReminders: [],
          }),
        ],
        applyToUi: applyRemoteResultToZustand,
      });
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
    });
  });

  it("8. realtime group upsert updates one group without replace of others", async () => {
    useStore.setState({
      groups: [baseGroup(GROUP_A, "A"), baseGroup(GROUP_B, "B")],
    });
    mergeRemotePartialIntoZustand({
      groups: [{ ...baseGroup(GROUP_A, "A-renamed") }],
    });
    const ids = useStore.getState().groups.map((g) => g.id).sort();
    expect(ids).toContain(GROUP_A);
    expect(ids).toContain(GROUP_B);
    expect(useStore.getState().groups.find((g) => g.id === GROUP_A)?.name).toBe("A-renamed");
  });

  it("9. realtime reconnect path uses atomic snapshot not empty intermediate", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "keep") },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: baseItem(ITEM_A, GROUP_A, "x"),
      });
      const result = await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteGroupInput(baseGroup(GROUP_A, "keep")),
          remoteItemInput({
            id: ITEM_A,
            type: "event",
            title: "x",
            groupId: GROUP_A,
            start: "2026-09-24T10:00:00.000Z",
            end: "2026-09-24T11:00:00.000Z",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: "",
            allDay: false,
            showInCalendar: true,
            showInTodo: false,
            done: false,
            hasDueDate: false,
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
            ownerUserId: userId,
            deletedAt: null,
            deletedBy: null,
            personalReminders: [],
          }),
        ],
        applyToUi: undefined,
      });
      // Przed atomową publikacją store może mieć stare dane — nie publikujemy [] 
      useStore.setState({ groups: [baseGroup(GROUP_A, "keep")], items: {} });
      const { applyRemoteSnapshotAtomically } = await import("@/lib/syncv3/cloudRemoteBridge");
      await applyRemoteSnapshotAtomically(userId, result);
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
    });
  });

  it("10. Android cold restart: groups and items hydrate together from IDB offline", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "Firma A") },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: baseItem(ITEM_A, GROUP_A, "Bachusz podpisy"),
      });
      db.close();
      // Nowa „instancja” — pusty Zustand, bez sieci
      useStore.setState({ items: {}, groups: [], authUserId: userId });
      const db2 = await openSyncV3Db(userId);
      await hydrateConsistentSnapshot(userId, db2);
      db2.close();
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
      expect(useStore.getState().items[ITEM_A]?.title).toBe("Bachusz podpisy");
    });
  });

  it("11. auth flicker does not clear groups via empty merge", async () => {
    useStore.setState({ groups: [baseGroup(GROUP_A, "G")], items: {} });
    mergeRemotePartialIntoZustand({ items: {} });
    expect(useStore.getState().groups).toHaveLength(1);
  });

  it("12. pending local group: older remote does not overwrite", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "local-newer") },
      });
      const before = await buildConsistentSnapshotFromIdb(userId, db);
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          {
            ...remoteGroupInput({ ...baseGroup(GROUP_A, "remote-old") }, "2000-01-01T00:00:00.000Z"),
          },
        ],
        applyToUi: applyRemoteResultToZustand,
      });
      const after = await buildConsistentSnapshotFromIdb(userId, db);
      expect(after.groups.find((g) => g.id === GROUP_A)?.name).toBe(
        before.groups.find((g) => g.id === GROUP_A)?.name,
      );
    });
  });

  it("13. item with groupId does not lose groupId when group briefly missing in UI", async () => {
    await withDb(async ({ userId, db }) => {
      await putEntitiesBatch(db, [
        {
          entityId: ITEM_A,
          entityType: "item",
          userId,
          snapshot: {
            id: ITEM_A,
            type: "event",
            title: "keep-gid",
            groupId: GROUP_A,
            start: "2026-09-24T10:00:00.000Z",
            end: "2026-09-24T11:00:00.000Z",
            description: "",
            allDay: false,
            showInCalendar: true,
            showInTodo: false,
            done: false,
            hasDueDate: false,
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
            ownerUserId: userId,
            deletedAt: null,
            deletedBy: null,
            personalReminders: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            localRevision: 1,
          } as never,
          localRevision: 1,
          updatedAt: new Date().toISOString(),
        },
      ]);
      // UI chwilowo bez group entity — snapshot z IDB nadal ma groupId na itemie
      useStore.setState({ groups: [] });
      const snap = await buildConsistentSnapshotFromIdb(userId, db);
      expect(snap.items[ITEM_A]?.groupId).toBe(GROUP_A);
      // Publikacja nie czyści groupId
      publishConsistentSnapshot(snap);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
    });
  });

  it("14. explicit group delete may remove group entity; groupId clear is not automatic", async () => {
    useStore.setState({
      groups: [baseGroup(GROUP_A, "G")],
      items: {
        [ITEM_A]: {
          id: ITEM_A,
          type: "event",
          title: "x",
          groupId: GROUP_A,
        } as Item,
      },
    });
    mergeRemotePartialIntoZustand({ removedGroupIds: [GROUP_A] });
    expect(useStore.getState().groups.find((g) => g.id === GROUP_A)).toBeUndefined();
    // groupId itemu NIE jest automatycznie czyszczony przez usunięcie group entity
    expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
  });

  it("15. restart after remote apply: groups present offline", async () => {
    await withDb(async ({ userId, db }) => {
      await applyRemoteEntities({
        userId,
        db,
        remotes: [remoteGroupInput(baseGroup(GROUP_B, "IB PROJEKT"))],
        applyToUi: undefined,
      });
      db.close();
      useStore.setState({ groups: [], items: {} });
      const db2 = await openSyncV3Db(userId);
      await hydrateConsistentSnapshot(userId, db2);
      db2.close();
      expect(useStore.getState().groups.some((g) => g.id === GROUP_B)).toBe(true);
    });
  });

  it("16. two clients after pull share same group UUID and item.groupId", async () => {
    const userA = uid();
    const userB = uid();
    const dbA = await openSyncV3Db(userA);
    const dbB = await openSyncV3Db(userB);
    await putMeta(dbA, { ...DEFAULT_META, migrationState: "active", migrationVersion: 1 });
    await putMeta(dbB, { ...DEFAULT_META, migrationState: "active", migrationVersion: 1 });
    try {
      const remotes = [
        remoteGroupInput(baseGroup(GROUP_A, "Firma A")),
        remoteItemInput({
          id: ITEM_A,
          type: "event",
          title: "shared",
          groupId: GROUP_A,
          start: "2026-09-24T10:00:00.000Z",
          end: "2026-09-24T11:00:00.000Z",
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          description: "",
          allDay: false,
          showInCalendar: true,
          showInTodo: false,
          done: false,
          hasDueDate: false,
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
          ownerUserId: userA,
          deletedAt: null,
          deletedBy: null,
          personalReminders: [],
        }),
      ];
      await applyRemoteEntities({ userId: userA, db: dbA, remotes, applyToUi: undefined });
      await applyRemoteEntities({ userId: userB, db: dbB, remotes, applyToUi: undefined });
      const snapA = await buildConsistentSnapshotFromIdb(userA, dbA);
      const snapB = await buildConsistentSnapshotFromIdb(userB, dbB);
      expect(snapA.groups.map((g) => g.id).sort()).toEqual(snapB.groups.map((g) => g.id).sort());
      expect(snapA.items[ITEM_A]?.groupId).toBe(GROUP_A);
      expect(snapB.items[ITEM_A]?.groupId).toBe(GROUP_A);
    } finally {
      dbA.close();
      dbB.close();
      await deleteSyncV3Db(userA);
      await deleteSyncV3Db(userB);
    }
  });

  it("regression: hydrate after items-only IDB write still keeps existing groups until groups land in IDB", async () => {
    await withDb(async ({ userId, db }) => {
      // Najpierw pełny stan
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP_A,
        operationType: "upsert",
        snapshot: { ...baseGroup(GROUP_A, "Firma A") },
      });
      await hydrateConsistentSnapshot(userId, db);
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);

      // Tylko item remote — partial merge
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM_A,
            type: "event",
            title: "only-item",
            groupId: GROUP_A,
            start: "2026-09-24T10:00:00.000Z",
            end: "2026-09-24T11:00:00.000Z",
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: "",
            allDay: false,
            showInCalendar: true,
            showInTodo: false,
            done: false,
            hasDueDate: false,
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
            ownerUserId: userId,
            deletedAt: null,
            deletedBy: null,
            personalReminders: [],
          }),
        ],
        applyToUi: applyRemoteResultToZustand,
      });
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
      // Pełna hydratacja z IDB też zachowuje group + groupId
      await hydrateConsistentSnapshot(userId, db);
      expect(useStore.getState().groups.some((g) => g.id === GROUP_A)).toBe(true);
      expect(useStore.getState().items[ITEM_A]?.groupId).toBe(GROUP_A);
    });
  });

  it("source guard: cloud pull must not delete groups from Supabase", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/lib/cloud.ts"), "utf8");
    expect(src).not.toMatch(/from\("groups"\)\.delete/);
    expect(src).not.toMatch(/\.from\('groups'\)\.delete/);
  });
});
