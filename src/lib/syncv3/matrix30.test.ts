import "fake-indexeddb/auto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { set as idbSet, get as idbGet } from "idb-keyval";
import { describe, expect, it, vi } from "vitest";
import {
  ackOperation,
  applyRemoteEntities,
  commitDomainMutation,
  commitLocalMutation,
  commitLocalRestore,
  deleteSyncV3Db,
  getActiveOperationsForEntity,
  getBackup,
  getEntity,
  getMeta,
  getOperationsForEntity,
  listReadyOperations,
  loadLegacyFromIdb,
  openSyncV3Db,
  putMeta,
  remoteGroupInput,
  remoteItemInput,
  remoteTagAssignmentInput,
  remoteTagInput,
  runSyncV3Migration,
  runSyncV3WorkerPass,
  updateOperation,
  type SyncV3Meta,
} from "@/lib/syncv3";
import { setSyncV3WriteFlags, resetSyncV3Flags } from "@/lib/syncv3/activeFlag";
import { filterFkReadyOperations, shouldRegisterV2ItemWriter } from "@/lib/syncv3/bootstrap";
import {
  buildV2OutboxRaw,
  buildV2ZustandPersistRaw,
  V2_ITEM_LOCAL_ONLY,
  V2_PERSIST_FIXTURE_USER_ID,
} from "@/lib/syncv3/fixtures/v2StorageReal";
import { DEFAULT_META } from "@/lib/syncv3/types";
import { outboxStorageKey, saveOutbox } from "@/lib/syncOutbox";

const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_POISON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TAG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let seq = 0;
function uid(): string {
  seq += 1;
  return `22222222-2222-4222-8222-${String(seq).padStart(12, "0")}`;
}

async function withDb(
  fn: (ctx: { userId: string; db: IDBDatabase }) => Promise<void>,
  state: SyncV3Meta["migrationState"] = "active",
) {
  const userId = uid();
  const db = await openSyncV3Db(userId);
  try {
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: state,
      migrationVersion: state === "active" ? 1 : 0,
      startedAt: new Date().toISOString(),
      completedAt: state === "active" ? new Date().toISOString() : null,
    } satisfies SyncV3Meta);
    setSyncV3WriteFlags({
      writesEnabled: state !== "failed",
      workerEnabled: state === "active",
    });
    await fn({ userId, db });
  } finally {
    db.close();
    await deleteSyncV3Db(userId);
    resetSyncV3Flags();
  }
}

function draft(over: Record<string, unknown> = {}) {
  return {
    id: ITEM,
    type: "event" as const,
    title: "Test",
    start: "2026-09-23T10:00:00.000Z",
    end: "2026-09-23T11:00:00.000Z",
    showInCalendar: true,
    ...over,
  };
}

function legacyMinimal(itemId = ITEM) {
  return {
    items: {
      [itemId]: {
        id: itemId,
        type: "event" as const,
        title: "legacy",
        start: "2026-09-20T08:00:00.000Z",
        end: "2026-09-20T09:00:00.000Z",
        showInCalendar: true,
        showInTodo: false,
        description: "",
        allDay: false,
        groupId: null,
        done: false,
        hasDueDate: true,
        checklist: [],
        participants: [],
        attachments: [],
        reminders: [],
        createdAt: "2026-09-20T07:00:00.000Z",
        updatedAt: "2026-09-20T07:00:00.000Z",
      },
    },
    groups: [],
    tags: {},
    myTagIdsByItem: {},
    dirtyItemIds: [itemId],
    dirtyParticipantIds: [],
    outboxItemIds: [itemId],
    outboxParticipantIds: [],
    tagAssignmentsDirty: false,
    zustandPersistRaw: { state: { items: {} } },
    outboxRaw: { itemIds: [itemId] },
  };
}

describe("Sync v3 — matrix 1–30", () => {
  it("1. auth switch z pending A", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "A-pending" }) });
      const other = uid();
      const pass = await runSyncV3WorkerPass({
        userId,
        authUserId: other,
        db,
        transport: { upsertItem: async () => ({ error: null }) },
      });
      expect(pass.processed).toBe(0);
      expect(await listReadyOperations(db, userId)).toHaveLength(1);
    });
  });

  it("2. auth flicker A → null → A", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "active",
        migrationVersion: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
      await commitLocalMutation({ userId, db, draft: draft({ title: "flicker" }) });
      db.close();
      resetSyncV3Flags();
      // null session: flags off, DB untouched
      const db2 = await openSyncV3Db(userId);
      setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
      expect((await getMeta(db2)).migrationState).toBe("active");
      expect(await listReadyOperations(db2, userId)).toHaveLength(1);
      const pass = await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db: db2,
        transport: { upsertItem: async () => ({ error: null }) },
      });
      expect(pass.acked).toBe(1);
      db2.close();
    } finally {
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("3. operacja A nie może zostać wysłana jako B", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft() });
      const pass = await runSyncV3WorkerPass({
        userId,
        authUserId: uid(),
        db,
        transport: { upsertItem: async () => ({ error: null }) },
      });
      expect(pass.processed).toBe(0);
      expect(await listReadyOperations(db, userId)).toHaveLength(1);
    });
  });

  it("4. starszy ACK nie usuwa nowszej operacji", async () => {
    await withDb(async ({ userId, db }) => {
      const r1 = await commitLocalMutation({ userId, db, draft: draft({ title: "old" }) });
      await updateOperation(db, { ...r1.operation, status: "in_flight" });
      await commitLocalMutation({ userId, db, draft: draft({ title: "new" }) });
      await ackOperation(db, r1.operation.operationId, r1.operation.localRevision);
      const after = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(after).toHaveLength(1);
      expect(after[0]?.payload.title).toBe("new");
    });
  });

  it("5. retry starego snapshotu nie nadpisuje nowszego remote", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "old" }) });
      const ops = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      await updateOperation(db, {
        ...ops[0]!,
        payload: { ...ops[0]!.payload, updatedAt: "2026-01-01T00:00:00.000Z" },
      });
      const upsert = vi.fn(async () => ({ error: null }));
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: upsert,
          fetchRemoteUpdatedAt: async () => "2026-09-23T12:00:00.000Z",
        },
      });
      expect(upsert).not.toHaveBeenCalled();
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM)).toHaveLength(0);
    });
  });

  it("6. edycja podczas in_flight", async () => {
    await withDb(async ({ userId, db }) => {
      const r1 = await commitLocalMutation({ userId, db, draft: draft({ title: "v1" }) });
      await updateOperation(db, { ...r1.operation, status: "in_flight" });
      const r2 = await commitLocalMutation({ userId, db, draft: draft({ title: "v2" }) });
      expect(r2.operation.status).toBe("pending");
      expect(r2.operation.localRevision).toBeGreaterThan(r1.operation.localRevision);
      const active = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(active.some((o) => o.status === "in_flight")).toBe(true);
      expect(active.some((o) => o.status === "pending" && o.payload.title === "v2")).toBe(true);
    });
  });

  it("7. create → edit → delete przed ACK", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "c" }) });
      await commitLocalMutation({ userId, db, draft: draft({ title: "e" }) });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ title: "e" }),
        operationType: "delete",
      });
      const pending = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operationType).toBe("delete");
    });
  });

  it("8. delete → restore przed ACK", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft(), operationType: "delete" });
      await commitLocalRestore({ userId, db, draft: draft({ title: "restored" }) });
      const pending = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operationType).toBe("upsert");
      expect(pending[0]?.payload.deletedAt).toBeNull();
    });
  });

  it("9. poison item przed zdrową operacją", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_POISON, title: "poison" }),
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_B, title: "good" }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async (row) =>
            row.id === ITEM_POISON
              ? { error: { code: "23502", message: "null value in column type" } }
              : { error: null },
        },
      });
      expect(
        (await getOperationsForEntity(db, userId, "item", ITEM_POISON)).some(
          (o) => o.status === "quarantined",
        ),
      ).toBe(true);
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_B)).toHaveLength(0);
    });
  });

  it("10. restart przed push", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await commitLocalMutation({ userId, db, draft: draft({ title: "pre-push" }) });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      expect(await listReadyOperations(db2, userId)).toHaveLength(1);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("11. restart podczas in_flight", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    const r1 = await commitLocalMutation({ userId, db, draft: draft({ title: "v1" }) });
    await updateOperation(db, { ...r1.operation, status: "in_flight" });
    await commitLocalMutation({ userId, db, draft: draft({ title: "v2" }) });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      const active = await getActiveOperationsForEntity(db2, userId, "item", ITEM);
      expect(active.some((o) => o.status === "in_flight")).toBe(true);
      expect(active.some((o) => o.status === "pending")).toBe(true);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("12. restart w każdym migrationState", async () => {
    const states: SyncV3Meta["migrationState"][] = [
      "not_started",
      "backing_up",
      "migrating",
      "verifying",
      "awaiting_remote",
      "cutover_ready",
      "failed",
    ];
    for (const state of states) {
      const userId = uid();
      const db = await openSyncV3Db(userId);
      try {
        await putMeta(db, {
          ...DEFAULT_META,
          migrationState: state,
          startedAt: "2026-09-23T00:00:00.000Z",
          lastMigrationError: state === "awaiting_remote" ? "offline" : null,
        });
        const meta = await runSyncV3Migration({
          userId,
          db,
          loadLegacy: async () => legacyMinimal() as never,
          remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
        });
        expect(meta.migrationState).toBe("active");
      } finally {
        db.close();
        await deleteSyncV3Db(userId);
      }
    }
  });

  it("13. remote IDs fetch error", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyMinimal() as never,
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: "network down" }) },
      });
      expect(meta.migrationState).toBe("awaiting_remote");
      expect(await getEntity(db, ITEM)).toBeTruthy();
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("14. offline podczas migracji", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyMinimal() as never,
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: "offline" }) },
      });
      expect(meta.migrationState).toBe("awaiting_remote");
      expect(meta.lastMigrationError).toBe("offline");
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("15. zamknięcie podczas backup", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "backing_up",
        startedAt: "2026-09-23T00:00:00.000Z",
      });
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyMinimal() as never,
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(meta.migrationState).toBe("active");
      expect(meta.backupId).toBeTruthy();
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("16. zamknięcie podczas migracji entities", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      const backupId = "backup-migrating-close";
      const { putBackup } = await import("@/lib/syncv3/db");
      await putBackup(db, {
        backupId,
        userId,
        createdAt: "2026-09-23T00:00:00.000Z",
        zustandPersistRaw: { keep: true },
        outboxRaw: { itemIds: [ITEM] },
      });
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "migrating",
        backupId,
        startedAt: "2026-09-23T00:00:00.000Z",
      });
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyMinimal() as never,
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(meta.migrationState).toBe("active");
      const backup = await getBackup(db, backupId);
      expect(backup?.zustandPersistRaw).toEqual({ keep: true });
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("17. zamknięcie podczas verifying", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "verifying",
        startedAt: "2026-09-23T00:00:00.000Z",
      });
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyMinimal() as never,
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(meta.migrationState).toBe("active");
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("18. service worker update z pending", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await commitLocalMutation({ userId, db, draft: draft({ title: "sw-update" }) });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      expect((await getMeta(db2)).migrationState).toBe("active");
      expect(await listReadyOperations(db2, userId)).toHaveLength(1);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("19. nowy bundle odtwarza outbox v3", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await commitLocalMutation({ userId, db, draft: draft({ title: "bundle" }) });
    const before = await listReadyOperations(db, userId);
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      const after = await listReadyOperations(db2, userId);
      expect(after).toHaveLength(before.length);
      expect(after[0]?.operationId).toBe(before[0]?.operationId);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("20. rollback bundle nie ignoruje v3 operations", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await commitLocalMutation({ userId, db, draft: draft({ title: "rollback-safe" }) });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      const pass = await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db: db2,
        transport: { upsertItem: async () => ({ error: null }) },
      });
      expect(pass.acked).toBe(1);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("21. klient B pobiera bez realtime", async () => {
    const userA = uid();
    const userB = uid();
    const dbA = await openSyncV3Db(userA);
    const dbB = await openSyncV3Db(userB);
    const remote = new Map<string, Record<string, unknown>>();
    try {
      for (const [u, db] of [
        [userA, dbA],
        [userB, dbB],
      ] as const) {
        await putMeta(db, {
          ...DEFAULT_META,
          migrationState: "active",
          migrationVersion: 1,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });
        void u;
      }
      setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
      await commitLocalMutation({
        userId: userA,
        db: dbA,
        draft: draft({ title: "for-B" }),
      });
      await runSyncV3WorkerPass({
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
      const row = remote.get(ITEM)!;
      const r = await applyRemoteEntities({
        userId: userB,
        db: dbB,
        remotes: [
          remoteItemInput({
            id: ITEM,
            type: "event",
            title: row.title as string,
            start: row.start_at as string,
            end: row.end_at as string,
            updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
          } as never),
        ],
      });
      expect(r.ok).toBe(true);
      expect((await getEntity(dbB, ITEM))?.snapshot.title).toBe("for-B");
    } finally {
      dbA.close();
      dbB.close();
      await deleteSyncV3Db(userA);
      await deleteSyncV3Db(userB);
      resetSyncV3Flags();
    }
  });

  it("22. restart klienta B", async () => {
    const userB = uid();
    const db = await openSyncV3Db(userB);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    await applyRemoteEntities({
      userId: userB,
      db,
      remotes: [
        remoteItemInput({
          id: ITEM,
          type: "event",
          title: "persisted-B",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          updatedAt: "2026-09-23T12:00:00.000Z",
        } as never),
      ],
    });
    db.close();
    const db2 = await openSyncV3Db(userB);
    try {
      expect((await getEntity(db2, ITEM))?.snapshot.title).toBe("persisted-B");
    } finally {
      db2.close();
      await deleteSyncV3Db(userB);
    }
  });

  it("23. groups/tags remote apply po restarcie", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    await applyRemoteEntities({
      userId,
      db,
      remotes: [
        remoteGroupInput({
          id: GROUP,
          name: "G",
          color: "#000",
          icon: "x",
          sortOrder: 0,
          showInSidebar: true,
          showInTasks: true,
          showInEvents: true,
          showInDashboard: true,
          showInAll: true,
        }),
        remoteTagInput({
          id: TAG,
          userId,
          name: "t",
          color: "#f00",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        remoteTagAssignmentInput(ITEM, [TAG], "2026-01-02T00:00:00.000Z"),
      ],
    });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      expect((await getEntity(db2, GROUP))?.entityType).toBe("group");
      expect((await getEntity(db2, TAG))?.entityType).toBe("user_tag");
      expect((await getEntity(db2, `ta:${ITEM}`))?.entityType).toBe("tag_assignment");
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("24. IDB failure podczas remote apply", async () => {
    await withDb(async ({ userId, db }) => {
      const ui = vi.fn();
      const dbMod = await import("@/lib/syncv3/db");
      const spy = vi.spyOn(dbMod, "putEntitiesBatch").mockRejectedValueOnce(new Error("idb boom"));
      const r = await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM,
            type: "event",
            title: "x",
            start: "2026-09-23T10:00:00.000Z",
            end: "2026-09-23T11:00:00.000Z",
            updatedAt: "2026-09-23T12:00:00.000Z",
          } as never),
        ],
        applyToUi: ui,
      });
      spy.mockRestore();
      expect(r.ok).toBe(false);
      expect(ui).not.toHaveBeenCalled();
    });
  });

  it("25. brak manual flush", () => {
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/SyncPendingBanner/);
    const settings = readFileSync(
      new URL("../../components/settings/SyncSettings.tsx", import.meta.url),
      "utf8",
    );
    expect(settings).not.toMatch(/Wyślij teraz/);
    expect(settings).not.toMatch(/flushPendingPush/);
  });

  it("26. brak aktywnego v2 writer", () => {
    expect(shouldRegisterV2ItemWriter()).toBe(false);
  });

  it("27. realny fixture v2 local-only migruje", async () => {
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
            ids: [],
            error: null,
          }),
        },
      });
      expect(meta.migrationState).toBe("active");
      expect(await getEntity(db, V2_ITEM_LOCAL_ONLY)).toBeTruthy();
      expect(
        (await getActiveOperationsForEntity(db, userId, "item", V2_ITEM_LOCAL_ONLY)).length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("28. stary storage pozostaje nietknięty", async () => {
    const userId = uid();
    const persistKey = `kalendarz-todo-v1-${userId}`;
    const raw = buildV2ZustandPersistRaw(userId);
    await idbSet(persistKey, raw);
    await saveOutbox(userId, buildV2OutboxRaw());
    const db = await openSyncV3Db(userId);
    try {
      await runSyncV3Migration({
        userId,
        db,
        loadLegacy: () => loadLegacyFromIdb(userId),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(await idbGet(persistKey)).toBe(raw);
      expect(outboxStorageKey(userId)).toContain(userId);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("29. backup nie zostaje zastąpiony pustym snapshotem", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    try {
      const first = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () =>
          ({
            ...legacyMinimal(),
            zustandPersistRaw: { full: true },
            outboxRaw: { itemIds: [ITEM] },
          }) as never,
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(first.backupId).toBeTruthy();
      const backupRaw = (await getBackup(db, first.backupId!))?.zustandPersistRaw;
      await putMeta(db, { ...first });
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
          outboxRaw: {
            itemIds: [],
            participantIds: [],
            tagAssignmentsDirty: false,
          },
        }),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect((await getBackup(db, first.backupId!))?.zustandPersistRaw).toEqual(backupRaw);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
    }
  });

  it("30. błąd jednej domeny nie blokuje innych domen", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP,
        operationType: "upsert",
        snapshot: {
          id: GROUP,
          name: "bad-group",
          color: "#000",
          sortOrder: 0,
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_B, title: "independent", groupId: null }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          upsertGroup: async () => ({
            error: { code: "23502", message: "not-null violation" },
          }),
        },
      });
      expect(
        (await getOperationsForEntity(db, userId, "group", GROUP)).some(
          (o) => o.status === "quarantined",
        ),
      ).toBe(true);
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_B)).toHaveLength(0);
    });
  });
});

describe("Sync v3 — participant path", () => {
  it("participant: owner adds participant via item upsert + syncOwnerParticipants", async () => {
    await withDb(async ({ userId, db }) => {
      const syncOwnerParticipants = vi.fn(async () => ({ error: null }));
      await commitLocalMutation({
        userId,
        db,
        draft: draft({
          title: "with-pp",
          participants: [
            {
              id: "p1",
              email: "a@example.com",
              name: "A",
              status: "pending",
            },
          ],
        }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          syncOwnerParticipants,
        },
      });
      expect(syncOwnerParticipants).toHaveBeenCalledWith(
        ITEM,
        expect.arrayContaining([expect.objectContaining({ email: "a@example.com" })]),
      );
    });
  });

  it("participant: participant changes allowed fields via patchParticipant", async () => {
    await withDb(async ({ userId, db }) => {
      const patchParticipant = vi.fn(async () => ({ error: null }));
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "ok",
          checklist: [],
          attachments: [],
          personalReminders: [],
          parentItemId: ITEM,
        },
      });
      // parent present so worker can process (FK filter used by bootstrap; worker lists all ready)
      await commitLocalMutation({ userId, db, draft: draft({ title: "parent" }) });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          patchParticipant,
        },
      });
      // participant may still be pending if processed in same pass before item ACK —
      // run again after item gone
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          patchParticipant,
        },
      });
      expect(patchParticipant).toHaveBeenCalled();
      const calls = patchParticipant.mock.calls as unknown as Array<
        [{ itemId: string; description?: string }]
      >;
      expect(calls[0]?.[0]).toMatchObject({
        itemId: ITEM,
        description: "ok",
      });
    });
  });

  it("participant: forbidden change quarantines that op only", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM, title: "parent-ok" }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: { upsertItem: async () => ({ error: null }) },
      });
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "forbidden-path",
          parentItemId: ITEM,
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_B, title: "other-item" }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          patchParticipant: async () => ({
            error: { code: "42501", message: "row-level security" },
          }),
        },
      });
      expect(
        (await getOperationsForEntity(db, userId, "participant", `pp:${ITEM}`)).some(
          (o) => o.status === "quarantined",
        ),
      ).toBe(true);
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_B)).toHaveLength(0);
    });
  });

  it("participant: participant error does not block new item", async () => {
    await withDb(async ({ userId, db }) => {
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM,
            type: "event",
            title: "parent",
            start: "2026-09-23T10:00:00.000Z",
            end: "2026-09-23T11:00:00.000Z",
            updatedAt: "2026-09-23T12:00:00.000Z",
          } as never),
        ],
      });
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "x",
          parentItemId: ITEM,
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_B, title: "new-item" }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          patchParticipant: async () => ({
            error: { code: "23503", message: "foreign key" },
          }),
        },
      });
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_B)).toHaveLength(0);
      expect(
        (await getOperationsForEntity(db, userId, "participant", `pp:${ITEM}`)).some(
          (o) => o.status === "quarantined",
        ),
      ).toBe(true);
    });
  });

  it("participant: parent item before participant", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "parent" }) });
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "child",
          parentItemId: ITEM,
        },
      });
      const ops = await listReadyOperations(db, userId);
      const { ready, deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(ready.some((o) => o.entityType === "item")).toBe(true);
      expect(deferred.some((o) => o.entityType === "participant")).toBe(true);
    });
  });

  it("participant: participant waits if parent missing", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "orphan",
          parentItemId: ITEM,
        },
      });
      const ops = await listReadyOperations(db, userId);
      const { ready, deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(ready).toHaveLength(0);
      expect(deferred.some((o) => o.entityType === "participant")).toBe(true);
    });
  });

  it("participant: restart preserves participant op", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await commitDomainMutation({
      userId,
      db,
      entityType: "participant",
      entityId: `pp:${ITEM}`,
      operationType: "upsert",
      snapshot: {
        id: `pp:${ITEM}`,
        itemId: ITEM,
        description: "keep",
        parentItemId: ITEM,
      },
    });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      expect(
        (await getActiveOperationsForEntity(db2, userId, "participant", `pp:${ITEM}`)).length,
      ).toBe(1);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });

  it("participant: auth switch does not send A as B", async () => {
    await withDb(async ({ userId, db }) => {
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM,
            type: "event",
            title: "p",
            start: "2026-09-23T10:00:00.000Z",
            end: "2026-09-23T11:00:00.000Z",
            updatedAt: "2026-09-23T12:00:00.000Z",
          } as never),
        ],
      });
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "a",
          parentItemId: ITEM,
        },
      });
      const pass = await runSyncV3WorkerPass({
        userId,
        authUserId: uid(),
        db,
        transport: {
          upsertItem: async () => ({ error: { message: "should-not-run" } }),
          patchParticipant: async () => ({ error: null }),
        },
      });
      expect(pass.processed).toBe(0);
      expect(
        await getActiveOperationsForEntity(db, userId, "participant", `pp:${ITEM}`),
      ).toHaveLength(1);
    });
  });

  it("participant: participant remote apply IDB-first", async () => {
    await withDb(async ({ userId, db }) => {
      const ui = vi.fn();
      const order: string[] = [];
      const dbMod = await import("@/lib/syncv3/db");
      const orig = dbMod.putEntitiesBatch;
      const spy = vi.spyOn(dbMod, "putEntitiesBatch").mockImplementation(async (d, ents) => {
        order.push("idb");
        return orig(d, ents);
      });
      const r = await applyRemoteEntities({
        userId,
        db,
        remotes: [
          {
            entityType: "participant",
            entityId: `pp:${ITEM}`,
            snapshot: {
              id: `pp:${ITEM}`,
              itemId: ITEM,
              description: "remote-pp",
            },
            updatedAt: "2026-09-23T12:00:00.000Z",
          },
        ],
        applyToUi: () => {
          order.push("ui");
          ui();
        },
      });
      spy.mockRestore();
      expect(r.ok).toBe(true);
      expect(order).toEqual(["idb", "ui"]);
      expect((await getEntity(db, `pp:${ITEM}`))?.snapshot).toMatchObject({
        description: "remote-pp",
      });
    });
  });

  it("participant: no pushDirtyParticipants in source", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const hits: string[] = [];
    function walk(dir: string) {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (name.name === "node_modules" || name.name === "dist") continue;
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name.name) && !/\.test\.(ts|tsx)$/.test(name.name)) {
          const src = readFileSync(p, "utf8");
          if (src.includes("pushDirtyParticipants")) hits.push(p);
        }
      }
    }
    walk(join(root, "lib"));
    walk(join(root, "state"));
    walk(join(root, "components"));
    expect(hits).toEqual([]);
  });
});

describe("Sync v3 — FK dependencies", () => {
  it("FK: group before item", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "group",
        entityId: GROUP,
        operationType: "upsert",
        snapshot: { id: GROUP, name: "G", color: "#000", sortOrder: 0 },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ title: "child", groupId: GROUP }),
      });
      const ops = await listReadyOperations(db, userId);
      const { ready, deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(ready.some((o) => o.entityType === "group")).toBe(true);
      expect(deferred.some((o) => o.entityType === "item")).toBe(true);
    });
  });

  it("FK: item before tag assignment", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "parent" }) });
      await commitDomainMutation({
        userId,
        db,
        entityType: "tag_assignment",
        entityId: `ta:${ITEM}`,
        operationType: "upsert",
        snapshot: { id: `ta:${ITEM}`, itemId: ITEM, tagIds: [TAG] },
      });
      const ops = await listReadyOperations(db, userId);
      const { ready, deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(ready.some((o) => o.entityType === "item")).toBe(true);
      expect(deferred.some((o) => o.entityType === "tag_assignment")).toBe(true);
    });
  });

  it("FK: tag before tag assignment", async () => {
    await withDb(async ({ userId, db }) => {
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM,
            type: "event",
            title: "parent",
            start: "2026-09-23T10:00:00.000Z",
            end: "2026-09-23T11:00:00.000Z",
            updatedAt: "2026-09-23T12:00:00.000Z",
          } as never),
        ],
      });
      await commitDomainMutation({
        userId,
        db,
        entityType: "user_tag",
        entityId: TAG,
        operationType: "upsert",
        snapshot: {
          id: TAG,
          userId,
          name: "t",
          color: "#f00",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
      await commitDomainMutation({
        userId,
        db,
        entityType: "tag_assignment",
        entityId: `ta:${ITEM}`,
        operationType: "upsert",
        snapshot: { id: `ta:${ITEM}`, itemId: ITEM, tagIds: [TAG] },
      });
      const ops = await listReadyOperations(db, userId);
      const { ready, deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(ready.some((o) => o.entityType === "user_tag")).toBe(true);
      expect(deferred.some((o) => o.entityType === "tag_assignment")).toBe(true);
    });
  });

  it("FK: item before participant", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "parent" }) });
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "c",
          parentItemId: ITEM,
        },
      });
      const ops = await listReadyOperations(db, userId);
      const { deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(deferred.some((o) => o.entityType === "participant")).toBe(true);
    });
  });

  it("FK: item before personal reminder", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({ userId, db, draft: draft({ title: "parent" }) });
      await commitDomainMutation({
        userId,
        db,
        entityType: "personal_reminder",
        entityId: `pr:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pr:${ITEM}`,
          itemId: ITEM,
          personalReminders: [{ id: "r1", offsetMinutes: 15 }],
          parentItemId: ITEM,
        },
      });
      const ops = await listReadyOperations(db, userId);
      const { deferred } = await filterFkReadyOperations(userId, ops, db);
      expect(deferred.some((o) => o.entityType === "personal_reminder")).toBe(true);
    });
  });

  it("FK: broken parent does not block independent item", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_POISON, title: "poison" }),
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_B, title: "independent" }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async (row) =>
            row.id === ITEM_POISON
              ? { error: { code: "23502", message: "not-null" } }
              : { error: null },
        },
      });
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_B)).toHaveLength(0);
    });
  });

  it("FK: broken tag does not block event without that tag", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "user_tag",
        entityId: TAG,
        operationType: "upsert",
        snapshot: {
          id: TAG,
          userId,
          name: "bad",
          color: "#f00",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: draft({ id: ITEM_B, title: "no-tag", groupId: null }),
      });
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
          upsertUserTag: async () => ({
            error: { code: "23502", message: "not-null" },
          }),
        },
      });
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_B)).toHaveLength(0);
    });
  });

  it("FK: after parent repair child auto-sends", async () => {
    await withDb(async ({ userId, db }) => {
      await commitDomainMutation({
        userId,
        db,
        entityType: "participant",
        entityId: `pp:${ITEM}`,
        operationType: "upsert",
        snapshot: {
          id: `pp:${ITEM}`,
          itemId: ITEM,
          description: "wait",
          parentItemId: ITEM,
        },
      });
      let ops = await listReadyOperations(db, userId);
      let filtered = await filterFkReadyOperations(userId, ops, db);
      expect(filtered.deferred).toHaveLength(1);

      await commitLocalMutation({ userId, db, draft: draft({ title: "repaired" }) });
      // ACK parent only (child deferred by FK in bootstrap; here we ACK item first)
      const itemOps = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        sortOps: () => itemOps.filter((o) => o.status === "pending"),
        transport: { upsertItem: async () => ({ error: null }) },
      });
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM)).toHaveLength(0);

      const childOps = await getActiveOperationsForEntity(
        db,
        userId,
        "participant",
        `pp:${ITEM}`,
      );
      filtered = await filterFkReadyOperations(userId, childOps, db);
      expect(filtered.ready.some((o) => o.entityType === "participant")).toBe(true);

      // Make child ready for listReadyOperations (may have been deferred earlier)
      for (const op of childOps) {
        await updateOperation(db, {
          ...op,
          nextAttemptAt: new Date(0).toISOString(),
          status: "pending",
        });
      }

      const patchParticipant = vi.fn(async () => ({ error: null }));
      await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: { upsertItem: async () => ({ error: null }), patchParticipant },
      });
      expect(patchParticipant).toHaveBeenCalled();
      expect(
        await getActiveOperationsForEntity(db, userId, "participant", `pp:${ITEM}`),
      ).toHaveLength(0);
    });
  });

  it("FK: restart preserves dependencies", async () => {
    const userId = uid();
    const db = await openSyncV3Db(userId);
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await commitLocalMutation({ userId, db, draft: draft({ title: "parent" }) });
    await commitDomainMutation({
      userId,
      db,
      entityType: "tag_assignment",
      entityId: `ta:${ITEM}`,
      operationType: "upsert",
      snapshot: { id: `ta:${ITEM}`, itemId: ITEM, tagIds: [TAG] },
    });
    db.close();
    const db2 = await openSyncV3Db(userId);
    try {
      const ops = await listReadyOperations(db2, userId);
      const { ready, deferred } = await filterFkReadyOperations(userId, ops, db2);
      expect(ready.some((o) => o.entityType === "item")).toBe(true);
      expect(deferred.some((o) => o.entityType === "tag_assignment")).toBe(true);
    } finally {
      db2.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });
});
