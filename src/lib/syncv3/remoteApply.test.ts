import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  applyRemoteEntities,
  remoteGroupInput,
  remoteItemInput,
  remoteTagAssignmentInput,
  remoteTagInput,
  commitLocalMutation,
  deleteSyncV3Db,
  getEntity,
  getActiveOperationsForEntity,
  listReadyOperations,
  openSyncV3Db,
  putMeta,
  ackOperation,
  updateOperation,
  runSyncV3WorkerPass,
  resolveWriterMode,
  type SyncV3Meta,
} from "@/lib/syncv3";
import { DEFAULT_META } from "@/lib/syncv3/types";
import { setSyncV3WriteFlags, resetSyncV3Flags } from "@/lib/syncv3/activeFlag";
import { shouldRegisterV2ItemWriter } from "@/lib/syncv3/bootstrap";
import { filterFkReadyOperations } from "@/lib/syncv3/bootstrap";

const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TAG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let seq = 0;
function nextUser() {
  seq += 1;
  return `11111111-1111-4111-8111-${String(seq).padStart(12, "0")}`;
}

async function withDb(fn: (ctx: { userId: string; db: IDBDatabase }) => Promise<void>) {
  const userId = nextUser();
  const db = await openSyncV3Db(userId);
  try {
    await putMeta(db, {
      ...DEFAULT_META,
      migrationState: "active",
      migrationVersion: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    } satisfies SyncV3Meta);
    setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
    await fn({ userId, db });
  } finally {
    db.close();
    await deleteSyncV3Db(userId);
    resetSyncV3Flags();
  }
}

describe("applyRemoteEntities — IDB-first", () => {
  it("remote item → IDB then UI callback", async () => {
    await withDb(async ({ userId, db }) => {
      const ui = vi.fn();
      const item = {
        id: ITEM,
        type: "event" as const,
        title: "from-remote",
        start: "2026-09-23T10:00:00.000Z",
        end: "2026-09-23T11:00:00.000Z",
        updatedAt: "2026-09-23T12:00:00.000Z",
      };
      const r = await applyRemoteEntities({
        userId,
        db,
        remotes: [remoteItemInput(item as never)],
        applyToUi: ui,
      });
      expect(r.ok).toBe(true);
      expect(ui).toHaveBeenCalledOnce();
      expect((await getEntity(db, ITEM))?.snapshot.title).toBe("from-remote");
    });
  });

  it("remote group/tag/assignment → IDB", async () => {
    await withDb(async ({ userId, db }) => {
      const r = await applyRemoteEntities({
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
      expect(r.ok).toBe(true);
      expect((await getEntity(db, GROUP))?.entityType).toBe("group");
      expect((await getEntity(db, TAG))?.entityType).toBe("user_tag");
      expect((await getEntity(db, `ta:${ITEM}`))?.entityType).toBe("tag_assignment");
    });
  });

  it("IDB failure does not call applyToUi", async () => {
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

  it("pending local is not overwritten", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "local-pending",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      await applyRemoteEntities({
        userId,
        db,
        remotes: [
          remoteItemInput({
            id: ITEM,
            type: "event",
            title: "remote-newer",
            start: "2026-09-23T10:00:00.000Z",
            end: "2026-09-23T11:00:00.000Z",
            updatedAt: "2099-01-01T00:00:00.000Z",
          } as never),
        ],
      });
      expect((await getEntity(db, ITEM))?.snapshot.title).toBe("local-pending");
      expect(
        (await getActiveOperationsForEntity(db, userId, "item", ITEM)).length,
      ).toBeGreaterThan(0);
    });
  });

  it("restart restores remote-applied entity from IDB", async () => {
    const userId = nextUser();
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
        remoteItemInput({
          id: ITEM,
          type: "event",
          title: "persisted",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          updatedAt: "2026-09-23T12:00:00.000Z",
        } as never),
      ],
    });
    db.close();
    const db2 = await openSyncV3Db(userId);
    expect((await getEntity(db2, ITEM))?.snapshot.title).toBe("persisted");
    db2.close();
    await deleteSyncV3Db(userId);
  });

  it("idempotent remote apply", async () => {
    await withDb(async ({ userId, db }) => {
      const remotes = [
        remoteItemInput({
          id: ITEM,
          type: "event",
          title: "same",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          updatedAt: "2026-09-23T12:00:00.000Z",
        } as never),
      ];
      await applyRemoteEntities({ userId, db, remotes });
      const r2 = await applyRemoteEntities({ userId, db, remotes });
      expect(r2.ok).toBe(true);
      expect((await getEntity(db, ITEM))?.snapshot.title).toBe("same");
    });
  });
});

describe("migration states — mutation policy", () => {
  const cases: Array<{
    state: SyncV3Meta["migrationState"];
    mode: ReturnType<typeof resolveWriterMode>;
  }> = [
    { state: "not_started", mode: "v3_local" },
    { state: "backing_up", mode: "v3_local" },
    { state: "migrating", mode: "v3_local" },
    { state: "verifying", mode: "v3_local" },
    { state: "cutover_ready", mode: "v3_local" },
    { state: "awaiting_remote", mode: "v3_local" },
    { state: "active", mode: "v3" },
    { state: "failed", mode: "blocked" },
  ];

  for (const c of cases) {
    it(`${c.state} → mode ${c.mode}`, () => {
      expect(resolveWriterMode(c.state)).toBe(c.mode);
    });
  }

  it("v3_local accepts durable mutation; worker does not run until active", async () => {
    const userId = nextUser();
    const db = await openSyncV3Db(userId);
    try {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "migrating",
        startedAt: new Date().toISOString(),
      });
      setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: false });
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "during-migration",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      expect(await getEntity(db, ITEM)).toBeTruthy();
      expect(await listReadyOperations(db, userId)).toHaveLength(1);
      const pass = await runSyncV3WorkerPass({
        userId,
        authUserId: userId,
        db,
        transport: {
          upsertItem: async () => ({ error: null }),
        },
      });
      expect(pass.processed).toBe(0);
      expect(await listReadyOperations(db, userId)).toHaveLength(1);
    } finally {
      db.close();
      await deleteSyncV3Db(userId);
      resetSyncV3Flags();
    }
  });
});

describe("ACK / auth / FK", () => {
  it("older ACK does not remove newer pending", async () => {
    await withDb(async ({ userId, db }) => {
      const r1 = await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "v1",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      await updateOperation(db, { ...r1.operation, status: "in_flight" });
      const r2 = await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "v2",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      expect(r2.operation.localRevision).toBeGreaterThan(r1.operation.localRevision);
      await ackOperation(db, r1.operation.operationId, r1.operation.localRevision);
      const still = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(still.some((o) => o.operationId === r2.operation.operationId)).toBe(true);
    });
  });

  it("auth session B cannot push user A ops (authUserId mismatch)", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "a",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      const other = nextUser();
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

  it("FK: tag_assignment deferred when item parent in same queue", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "parent",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      const { commitDomainMutation } = await import("@/lib/syncv3/domains");
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
      expect(deferred.some((o) => o.entityType === "tag_assignment")).toBe(true);
      expect(ready.some((o) => o.entityType === "item")).toBe(true);
    });
  });

  it("v2 writer registration always false", () => {
    expect(shouldRegisterV2ItemWriter()).toBe(false);
  });
});

describe("create-edit-delete / restore before ACK", () => {
  it("create → edit → delete coalesces to delete pending", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "c",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "e",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "d",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          deletedAt: new Date().toISOString(),
        },
        operationType: "delete",
      });
      const ops = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(ops.some((o) => o.operationType === "delete")).toBe(true);
    });
  });

  it("delete → restore before ACK becomes upsert", async () => {
    await withDb(async ({ userId, db }) => {
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "x",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      await commitLocalMutation({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "x",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
          deletedAt: new Date().toISOString(),
        },
        operationType: "delete",
      });
      const { commitLocalRestore } = await import("@/lib/syncv3/mutation");
      await commitLocalRestore({
        userId,
        db,
        draft: {
          id: ITEM,
          type: "event",
          title: "restored",
          start: "2026-09-23T10:00:00.000Z",
          end: "2026-09-23T11:00:00.000Z",
        },
      });
      const ops = await getActiveOperationsForEntity(db, userId, "item", ITEM);
      expect(ops.every((o) => o.operationType === "upsert")).toBe(true);
      expect((await getEntity(db, ITEM))?.snapshot.title).toBe("restored");
    });
  });
});
