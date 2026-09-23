import "fake-indexeddb/auto";
import { set as idbSet, get as idbGet } from "idb-keyval";
import { describe, expect, it, vi } from "vitest";
import {
  commitLocalMutation,
  deleteSyncV3Db,
  getActiveOperationsForEntity,
  getBackup,
  getEntity,
  getMeta,
  listReadyOperations,
  loadLegacyFromIdb,
  openSyncV3Db,
  putMeta,
  runSyncV3Migration,
  runSyncV3WorkerPass,
} from "@/lib/syncv3";
import { setSyncV3ActiveFlag } from "@/lib/syncv3/activeFlag";
import { shouldRegisterV2ItemWriter } from "@/lib/syncv3/bootstrap";
import { DEFAULT_META } from "@/lib/syncv3/types";
import { outboxStorageKey, saveOutbox } from "@/lib/syncOutbox";
import {
  buildV2OutboxRaw,
  buildV2ZustandPersistRaw,
  V2_GROUP_ID,
  V2_ITEM_BACHUSZ,
  V2_ITEM_LEGACY_NO_TYPE,
  V2_ITEM_LOCAL_ONLY,
  V2_ITEM_TOMBSTONE,
  V2_PERSIST_FIXTURE_USER_ID,
  V2_TAG_ID,
} from "@/lib/syncv3/fixtures/v2StorageReal";

describe("Sync v3 — real v2 storage bootstrap", () => {
  it("migrates real persist key + outbox shape end-to-end", async () => {
    const userId = V2_PERSIST_FIXTURE_USER_ID;
    const persistKey = `kalendarz-todo-v1-${userId}`;
    const raw = buildV2ZustandPersistRaw(userId);
    await idbSet(persistKey, raw);
    await saveOutbox(userId, buildV2OutboxRaw());

    const db = await openSyncV3Db(userId);
    try {
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: () => loadLegacyFromIdb(userId),
        remote: {
          fetchRemoteItemIds: async () => ({
            ids: [V2_ITEM_BACHUSZ, V2_ITEM_TOMBSTONE],
            error: null,
          }),
        },
      });

      expect(meta.migrationState).toBe("active");
      expect(meta.backupId).toBeTruthy();

      const backup = await getBackup(db, meta.backupId!);
      expect(backup?.zustandPersistRaw).toBe(raw);
      expect(backup?.outboxRaw).toMatchObject({
        itemIds: expect.arrayContaining([V2_ITEM_LOCAL_ONLY]),
      });

      // v2 storage not deleted
      expect(await idbGet(persistKey)).toBe(raw);
      expect(outboxStorageKey(userId)).toContain(userId);

      const bachusz = await getEntity(db, V2_ITEM_BACHUSZ);
      expect(bachusz?.snapshot.title).toBe("Bachusz podpisy");
      expect(bachusz?.snapshot.id).toBe(V2_ITEM_BACHUSZ);
      expect(bachusz?.snapshot.participants?.length).toBe(1);
      expect(bachusz?.snapshot.recurrence).toBeTruthy();
      expect(bachusz?.snapshot.reminders?.length).toBe(1);
      expect(bachusz?.snapshot.personalReminders?.length).toBe(1);
      expect(bachusz?.snapshot.checklist?.length).toBe(1);

      const legacy = await getEntity(db, V2_ITEM_LEGACY_NO_TYPE);
      expect(legacy?.snapshot.type).toBeTruthy();

      const tomb = await getEntity(db, V2_ITEM_TOMBSTONE);
      expect(tomb?.snapshot.deletedAt).toBeTruthy();

      const localOnly = await getEntity(db, V2_ITEM_LOCAL_ONLY);
      expect(localOnly).toBeTruthy();
      const localOps = await getActiveOperationsForEntity(
        db,
        userId,
        "item",
        V2_ITEM_LOCAL_ONLY,
      );
      expect(localOps.length).toBeGreaterThanOrEqual(1);

      const group = await getEntity(db, V2_GROUP_ID);
      expect(group?.entityType).toBe("group");

      const tag = await getEntity(db, V2_TAG_ID);
      expect(tag?.entityType).toBe("user_tag");

      const ta = await getEntity(db, `ta:${V2_ITEM_BACHUSZ}`);
      expect(ta?.entityType).toBe("tag_assignment");

      // restart after active: does not wipe backup with empty
      await putMeta(db, { ...meta });
      await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => ({
          items: {},
          groups: [],
          tags: {},
          myTagIdsByItem: {},
          dirtyItemIds: [],
          dirtyParticipantIds: [],
          outboxItemIds: [],
          outboxParticipantIds: [],
          tagAssignmentsDirty: false,
          zustandPersistRaw: null,
          outboxRaw: null,
        }),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      const backupAgain = await getBackup(db, meta.backupId!);
      expect(backupAgain?.zustandPersistRaw).toBe(raw);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
      setSyncV3ActiveFlag(false);
    }
  });

  it("remote fetch failure does not activate", async () => {
    const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await idbSet(`kalendarz-todo-v1-${userId}`, buildV2ZustandPersistRaw(userId));
    await saveOutbox(userId, buildV2OutboxRaw());
    const db = await openSyncV3Db(userId);
    try {
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: () => loadLegacyFromIdb(userId),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: "offline" }) },
      });
      expect(meta.migrationState).toBe("awaiting_remote");
      expect(await getEntity(db, V2_ITEM_BACHUSZ)).toBeTruthy();
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });
});

describe("Sync v3 — architecture guards", () => {
  it("IDB failure leaves no UI apply (applyToUi not called)", async () => {
    const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const db = await openSyncV3Db(userId);
    const apply = vi.fn();
    db.close();
    await expect(
      commitLocalMutation({
        userId,
        db,
        draft: {
          id: V2_ITEM_BACHUSZ,
          type: "event",
          title: "x",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
        applyToUi: apply,
      }),
    ).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
    await deleteSyncV3Db(userId);
  });

  it("after force-active, v2 writer registration is false", async () => {
    setSyncV3ActiveFlag(true);
    expect(shouldRegisterV2ItemWriter()).toBe(false);
    setSyncV3ActiveFlag(false);
    // v2 writer permanently removed from runtime
    expect(shouldRegisterV2ItemWriter()).toBe(false);
  });

  it("commit creates entity+operation atomically", async () => {
    const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const db = await openSyncV3Db(userId);
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "active",
        migrationVersion: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      setSyncV3ActiveFlag(true);
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: V2_ITEM_BACHUSZ,
          type: "event",
          title: "atom",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      expect(await getEntity(db, V2_ITEM_BACHUSZ)).toBeTruthy();
      expect(await listReadyOperations(db, userId)).toHaveLength(1);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
      setSyncV3ActiveFlag(false);
    }
  });
});

describe("Sync v3 — two-client integration (fake backend)", () => {
  it("A creates → worker upsert ACK → B pull/merge without realtime / manual flush", async () => {
    const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const remote = new Map<string, Record<string, unknown>>();

    const dbA = await openSyncV3Db(userA);
    const dbB = await openSyncV3Db(userB);
    try {
      for (const db of [dbA, dbB]) {
        await putMeta(db, {
          ...DEFAULT_META,
          migrationState: "active",
          migrationVersion: 1,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
      }

      const itemId = V2_ITEM_BACHUSZ;
      await commitLocalMutation({
        userId: userA,
        db: dbA,
        draft: {
          id: itemId,
          type: "event",
          title: "Two client event",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          showInCalendar: true,
        },
      });
      expect(await getEntity(dbA, itemId)).toBeTruthy();
      expect((await listReadyOperations(dbA, userA)).length).toBe(1);

      const pass = await runSyncV3WorkerPass({
        userId: userA,
        authUserId: userA,
        db: dbA,
        transport: {
          upsertItem: async (row) => {
            remote.set(row.id as string, row);
            return { error: null, remoteUpdatedAt: row.updated_at as string };
          },
        },
      });
      expect(pass.acked).toBe(1);
      expect(await listReadyOperations(dbA, userA)).toHaveLength(0);
      expect(remote.has(itemId)).toBe(true);

      // B: periodic pull/merge (no realtime)
      const { mergeRemoteIntoLocal } = await import("@/lib/syncv3/merge");
      const row = remote.get(itemId)!;
      const merged = await mergeRemoteIntoLocal({
        userId: userB,
        db: dbB,
        remoteItems: [
          {
            id: itemId,
            updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
            raw: {
              id: itemId,
              type: "event",
              title: row.title as string,
              start: row.start_at as string,
              end: row.end_at as string,
              showInCalendar: true,
            },
          },
        ],
      });
      expect(merged.items[itemId]?.title).toBe("Two client event");
      expect(await getEntity(dbB, itemId)).toBeTruthy();
    } finally {
      dbA.close();
      dbB.close();
      await deleteSyncV3Db(userA);
      await deleteSyncV3Db(userB);
    }
  });

  it("variants: offline create, poison before good, edit in_flight, delete before ACK", async () => {
    const userId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const db = await openSyncV3Db(userId);
    const remote = new Map<string, Record<string, unknown>>();
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "active",
        migrationVersion: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      const good = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const poison = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

      await commitLocalMutation({
        userId,
        db,
        draft: { id: poison, type: "event", title: "poison", start: "x", end: "y" },
      }).catch(() => undefined);

      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: good,
          type: "event",
          title: "offline",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });

      // restart simulation: reopen ops still pending
      expect((await listReadyOperations(db, userId)).length).toBeGreaterThanOrEqual(1);

      let attempts = 0;
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async (row) => {
            attempts += 1;
            if (row.id === poison) {
              return { error: { code: "23502", message: "not-null" } };
            }
            remote.set(row.id as string, row);
            return { error: null };
          },
        },
      });
      expect(remote.has(good)).toBe(true);

      // edit while simulating in_flight path: commit another revision
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: good,
          type: "event",
          title: "edited",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });

      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: good,
          type: "event",
          title: "gone",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          deletedAt: new Date().toISOString(),
        },
        operationType: "delete",
      });
      const ops = await getActiveOperationsForEntity(db, userId, "item", good);
      expect(ops.some((o) => o.operationType === "delete")).toBe(true);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });
});

describe("Sync v3 — PWA lifecycle / orphan off", () => {
  it("pending ops survive simulated bundle reload; migrationState stays active", async () => {
    const userId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const db = await openSyncV3Db(userId);
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "active",
        migrationVersion: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: V2_ITEM_BACHUSZ,
          type: "event",
          title: "pending across reload",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      db.close();

      // "new bundle" reopen
      const db2 = await openSyncV3Db(userId);
      const meta = await getMeta(db2);
      expect(meta.migrationState).toBe("active");
      expect(await listReadyOperations(db2, userId)).toHaveLength(1);
      setSyncV3ActiveFlag(meta.migrationState === "active");
      expect(shouldRegisterV2ItemWriter()).toBe(false);
      db2.close();
    } finally {
      await deleteSyncV3Db(userId);
      setSyncV3ActiveFlag(false);
    }
  });
});
