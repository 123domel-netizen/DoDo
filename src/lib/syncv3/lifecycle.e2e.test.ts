import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  cloudEnabled: true,
  supabase: {
    from: (_table: string) => ({
      upsert: async () => ({ error: null }),
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/syncv3/remoteIds", () => ({
  fetchAllRemoteItemIdsForUser: async () => ({ ids: [] as string[], error: null }),
}));

vi.mock("@/lib/syncWrite", () => ({
  setSyncV3BlocksNotify: () => undefined,
}));

import {
  applyRemoteEntities,
  commitLocalMutation,
  deleteSyncV3Db,
  getEntity,
  getMeta,
  listReadyOperations,
  openSyncV3Db,
  remoteItemInput,
  runSyncV3WorkerPass,
} from "@/lib/syncv3";
import { bootstrapSyncV3 } from "@/lib/syncv3/bootstrap";
import { resetSyncV3Flags, setSyncV3WriteFlags } from "@/lib/syncv3/activeFlag";

const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let seq = 0;
function uid(): string {
  seq += 1;
  return `33333333-3333-4333-8333-${String(seq).padStart(12, "0")}`;
}

/** Stop bootstrap worker interval; keep IDB; re-enable writes for a controlled pass. */
async function pauseAutoWorker() {
  await bootstrapSyncV3(null);
  setSyncV3WriteFlags({ writesEnabled: true, workerEnabled: true });
}

describe("Sync v3 — full two-client lifecycle", () => {
  beforeEach(() => {
    resetSyncV3Flags();
  });

  it("lifecycle: A creates offline, closes, new A online, worker restores, backend accepts, B pulls — no manual send", async () => {
    const userA = uid();
    const userB = uid();

    // A: bootstrap migrates via public API
    await bootstrapSyncV3(userA);
    {
      const db = await openSyncV3Db(userA);
      expect((await getMeta(db)).migrationState).toBe("active");
      db.close();
    }

    // Offline create: stop auto-worker so op stays pending (no manual outbox insert)
    await pauseAutoWorker();
    const dbA1 = await openSyncV3Db(userA);
    await commitLocalMutation({
      userId: userA,
      db: dbA1,
      draft: {
        id: ITEM,
        type: "event",
        title: "lifecycle-offline",
        start: "2026-09-23T10:00:00.000Z",
        end: "2026-09-23T11:00:00.000Z",
        showInCalendar: true,
      },
    });
    expect(await listReadyOperations(dbA1, userA)).toHaveLength(1);
    dbA1.close();

    // Close A session
    await bootstrapSyncV3(null);
    resetSyncV3Flags();

    // New A instance online: bootstrap restores v3 outbox from IDB
    await bootstrapSyncV3(userA);
    {
      const db = await openSyncV3Db(userA);
      expect((await getMeta(db)).migrationState).toBe("active");
      expect(await listReadyOperations(db, userA)).toHaveLength(1);
      db.close();
    }
    await pauseAutoWorker();

    const dbA2 = await openSyncV3Db(userA);
    const backend = new Map<string, Record<string, unknown>>();
    const pass = await runSyncV3WorkerPass({
      userId: userA,
      authUserId: userA,
      db: dbA2,
      transport: {
        upsertItem: async (row) => {
          backend.set(row.id as string, row);
          return { error: null, remoteUpdatedAt: row.updated_at as string };
        },
      },
    });
    expect(pass.acked).toBe(1);
    expect(backend.has(ITEM)).toBe(true);
    expect(await listReadyOperations(dbA2, userA)).toHaveLength(0);
    dbA2.close();
    await bootstrapSyncV3(null);

    // B pulls without realtime — applyRemoteEntities only (IDB then UI)
    await bootstrapSyncV3(userB);
    await pauseAutoWorker();
    const dbB = await openSyncV3Db(userB);
    const row = backend.get(ITEM)!;
    const ui = vi.fn();
    const applied = await applyRemoteEntities({
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
          showInCalendar: true,
        } as never),
      ],
      applyToUi: ui,
    });
    expect(applied.ok).toBe(true);
    expect(ui).toHaveBeenCalledOnce();
    expect((await getEntity(dbB, ITEM))?.snapshot.title).toBe("lifecycle-offline");
    dbB.close();

    await deleteSyncV3Db(userA);
    await deleteSyncV3Db(userB);
    resetSyncV3Flags();
  });
});
