import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  ackOperation,
  canonicalToItem,
  commitLocalMutation,
  commitLocalRestore,
  deleteSyncV3Db,
  getActiveOperationsForEntity,
  getEntity,
  getMeta,
  getOperationsForEntity,
  isSyncV3Active,
  listReadyOperations,
  loadLegacyFromIdb,
  mergeRemoteIntoLocal,
  normalizeToCanonical,
  openSyncV3Db,
  putMeta,
  resolveWriterMode,
  runSyncV3Migration,
  runSyncV3WorkerPass,
  updateOperation,
  validateCanonicalForPush,
  type LegacyV2Snapshot,
  type SyncV3Meta,
} from "@/lib/syncv3";
import { DEFAULT_META } from "@/lib/syncv3/types";
import { setSyncV3WriteFlags, resetSyncV3Flags } from "@/lib/syncv3/activeFlag";

const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_POISON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let userSeq = 0;
function nextUser(): string {
  userSeq += 1;
  return `11111111-1111-4111-8111-${String(userSeq).padStart(12, "0")}`;
}

async function withUser(
  fn: (ctx: {
    userId: string;
    db: Awaited<ReturnType<typeof openSyncV3Db>>;
  }) => Promise<void>,
) {
  const userId = nextUser();
  const db = await openSyncV3Db(userId);
  try {
    await fn({ userId, db });
  } finally {
    db.close();
    await deleteSyncV3Db(userId);
    resetSyncV3Flags();
  }
}

async function forceActive(db: Awaited<ReturnType<typeof openSyncV3Db>>) {
  const meta: SyncV3Meta = {
    ...DEFAULT_META,
    migrationState: "active",
    migrationVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  await putMeta(db, meta);
  setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
}

function baseDraft(over: Record<string, unknown> = {}) {
  return {
    id: ITEM_A,
    type: "event" as const,
    title: "Test",
    description: "",
    start: "2026-09-23T10:00:00.000Z",
    end: "2026-09-23T11:00:00.000Z",
    allDay: false,
    groupId: null,
    showInCalendar: true,
    showInTodo: false,
    done: false,
    hasDueDate: true,
    checklist: [],
    participants: [],
    attachments: [],
    reminders: [],
    createdAt: "2026-09-23T09:00:00.000Z",
    updatedAt: "2026-09-23T09:00:00.000Z",
    ...over,
  };
}

describe("Sync v3 — canonical", () => {
  it("normalizes legacy missing type deterministically", () => {
    const c = normalizeToCanonical({
      id: ITEM_A,
      title: "x",
      showInTodo: true,
      showInCalendar: false,
    } as never);
    expect(c.type).toBe("task");
    expect(validateCanonicalForPush(c).ok).toBe(true);
  });
});

describe("Sync v3 — atomic mutation", () => {
  it("writes entity+operation before UI", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      const order: string[] = [];
      await commitLocalMutation({
        userId,
        db,
        draft: baseDraft({ title: "Atomic" }),
        applyToUi: () => order.push("ui"),
        wakeWorker: () => order.push("wake"),
      });
      expect(order).toEqual(["ui", "wake"]);
      expect((await getEntity(db, ITEM_A))?.snapshot.title).toBe("Atomic");
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_A)).toHaveLength(1);
    });
  });

  it("does not apply UI when IDB write fails", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      let ui = false;
      db.close();
      await expect(
        commitLocalMutation({
          userId,
          db,
          draft: baseDraft(),
          applyToUi: () => {
            ui = true;
          },
        }),
      ).rejects.toThrow();
      expect(ui).toBe(false);
    });
  });
});

describe("Sync v3 — coalescing & revision", () => {
  it("coalesces pending edits", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "v1" }) });
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "v2" }) });
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "v3" }) });
      const pending = (await getOperationsForEntity(db, userId, "item", ITEM_A)).filter(
        (o) => o.status === "pending",
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]?.payload.title).toBe("v3");
      expect(pending[0]?.localRevision).toBe(3);
    });
  });

  it("older ACK does not remove newer pending", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      const r1 = await commitLocalMutation({
        userId,
        db,
        draft: baseDraft({ title: "old" }),
      });
      await updateOperation(db, { ...r1.operation, status: "in_flight" });
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "new" }) });
      await ackOperation(db, r1.operation.operationId, r1.operation.localRevision);
      const after = await getActiveOperationsForEntity(db, userId, "item", ITEM_A);
      expect(after).toHaveLength(1);
      expect(after[0]?.payload.title).toBe("new");
    });
  });

  it("create → edit → delete before ACK", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "c" }) });
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "e" }) });
      await commitLocalMutation({
        userId,
        db,
        draft: baseDraft({ title: "e" }),
        operationType: "delete",
      });
      const pending = await getActiveOperationsForEntity(db, userId, "item", ITEM_A);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operationType).toBe("delete");
    });
  });

  it("delete → restore before ACK", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({
        userId,
        db,
        draft: baseDraft(),
        operationType: "delete",
      });
      await commitLocalRestore({
        userId,
        db,
        draft: baseDraft({ title: "restored" }),
      });
      const pending = await getActiveOperationsForEntity(db, userId, "item", ITEM_A);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operationType).toBe("upsert");
      expect(pending[0]?.payload.deletedAt).toBeNull();
    });
  });
});

describe("Sync v3 — worker", () => {
  it("quarantine does not block other ops", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({
        userId,
        db,
        draft: baseDraft({ id: ITEM_POISON, title: "poison" }),
      });
      await commitLocalMutation({
        userId,
        db,
        draft: baseDraft({ id: ITEM_B, title: "good" }),
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

  it("stale retry skips upsert against newer remote", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({ userId, db, draft: baseDraft({ title: "old" }) });
      const ops = await getActiveOperationsForEntity(db, userId, "item", ITEM_A);
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
      expect(await getActiveOperationsForEntity(db, userId, "item", ITEM_A)).toHaveLength(0);
    });
  });
});

describe("Sync v3 — migration", () => {
  function legacyFixture(): LegacyV2Snapshot {
    return {
      items: {
        [ITEM_A]: canonicalToItem(
          normalizeToCanonical({
            id: ITEM_A,
            type: "event",
            title: "Bachusz podpisy",
            start: "2026-09-20T08:00:00.000Z",
            end: "2026-09-20T09:00:00.000Z",
          }),
        ),
        [ITEM_POISON]: canonicalToItem(
          normalizeToCanonical({
            id: ITEM_POISON,
            title: "legacy",
            showInCalendar: true,
            showInTodo: false,
          } as never),
        ),
      },
      groups: [],
      tags: {},
      myTagIdsByItem: {},
      dirtyItemIds: [ITEM_POISON],
      dirtyParticipantIds: [],
      outboxItemIds: [ITEM_POISON],
      outboxParticipantIds: [],
      tagAssignmentsDirty: false,
      zustandPersistRaw: { state: { items: {} } },
      outboxRaw: {
        itemIds: [ITEM_POISON],
        participantIds: [],
        tagAssignmentsDirty: false,
      },
    };
  }

  it("recovers local-only by UUID (Bachusz is fixture title only)", async () => {
    await withUser(async ({ userId, db }) => {
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyFixture(),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(meta.migrationState).toBe("active");
      expect((await getEntity(db, ITEM_A))?.snapshot.title).toBe("Bachusz podpisy");
      expect(
        (await getActiveOperationsForEntity(db, userId, "item", ITEM_A)).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("remote fetch error → awaiting_remote, keeps entities", async () => {
    await withUser(async ({ userId, db }) => {
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyFixture(),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: "network down" }) },
      });
      expect(meta.migrationState).toBe("awaiting_remote");
      expect(await isSyncV3Active(userId, db)).toBe(false);
      expect(await getEntity(db, ITEM_A)).toBeTruthy();
    });
  });

  it("idempotent migration", async () => {
    await withUser(async ({ userId, db }) => {
      const opts = {
        userId,
        db,
        loadLegacy: async () => legacyFixture(),
        remote: { fetchRemoteItemIds: async () => ({ ids: [] as string[], error: null }) },
      };
      await runSyncV3Migration(opts);
      const before = await listReadyOperations(db, userId);
      await runSyncV3Migration(opts);
      expect(await listReadyOperations(db, userId)).toHaveLength(before.length);
    });
  });

  it("restart from backing_up completes", async () => {
    await withUser(async ({ userId, db }) => {
      await putMeta(db, {
        ...DEFAULT_META,
        migrationState: "backing_up",
        startedAt: "2026-09-23T00:00:00.000Z",
      });
      const meta = await runSyncV3Migration({
        userId,
        db,
        loadLegacy: async () => legacyFixture(),
        remote: { fetchRemoteItemIds: async () => ({ ids: [], error: null }) },
      });
      expect(meta.migrationState).toBe("active");
    });
  });
});

describe("Sync v3 — merge & engine", () => {
  it("merge protects pending local", async () => {
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({
        userId,
        db,
        draft: baseDraft({ title: "local-pending" }),
      });
      const merged = await mergeRemoteIntoLocal({
        userId,
        db,
        remoteItems: [
          {
            id: ITEM_A,
            updatedAt: "2099-01-01T00:00:00.000Z",
            raw: baseDraft({ title: "remote-newer" }),
          },
        ],
      });
      expect(merged.items[ITEM_A]?.title).toBe("local-pending");
      expect(merged.protectedPendingIds).toContain(ITEM_A);
    });
  });

  it("writer modes: v3 / v3_local / blocked", async () => {
    expect(resolveWriterMode("active")).toBe("v3");
    expect(resolveWriterMode("not_started")).toBe("v3_local");
    expect(resolveWriterMode("migrating")).toBe("v3_local");
    expect(resolveWriterMode("failed")).toBe("blocked");
    await withUser(async ({ userId, db }) => {
      await forceActive(db);
      await commitLocalMutation({ userId, db, draft: baseDraft() });
      const meta = await getMeta(db);
      expect(resolveWriterMode(meta.migrationState)).toBe("v3");
    });
  });

  it("loadLegacyFromIdb exported for UUID recovery", () => {
    expect(typeof loadLegacyFromIdb).toBe("function");
  });
});
