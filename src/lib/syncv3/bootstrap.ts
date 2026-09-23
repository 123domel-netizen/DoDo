import { setSyncV3BlocksNotify } from "@/lib/syncWrite";
import { setSyncV3ActiveFlag, isSyncV3ActiveCached as readActiveFlag } from "@/lib/syncv3/activeFlag";
import { registerSyncV3Wake } from "@/lib/syncv3/wake";
import { useStore } from "@/state/store";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { fetchAllRemoteItemIdsForUser } from "@/lib/syncv3/remoteIds";
import type { SyncOperation } from "@/lib/syncv3/types";
import { canRunV2Writer, isSyncV3Active, getMigrationState, resolveWriterMode } from "@/lib/syncv3/engine";
import { loadLegacyFromIdb, runSyncV3Migration } from "@/lib/syncv3/migrate";
import { canonicalToItem } from "@/lib/syncv3/canonical";
import { listEntities, openSyncV3Db } from "@/lib/syncv3/db";
import { runSyncV3WorkerPass, scheduleWakeWorker } from "@/lib/syncv3/worker";
import type { Group, Item, UserTag } from "@/types";

let activeUserId: string | null = null;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function getSyncV3ActiveUserId(): string | null {
  return activeUserId;
}

export async function isV2WriterAllowed(userId: string | null): Promise<boolean> {
  if (!userId) return true;
  return canRunV2Writer(userId);
}

export function isSyncV3ActiveCached(): boolean {
  return readActiveFlag();
}

export async function refreshV3ActiveCache(userId: string): Promise<boolean> {
  const active = await isSyncV3Active(userId);
  setSyncV3ActiveFlag(active);
  setSyncV3BlocksNotify(active);
  return active;
}

function entityPushOrder(op: SyncOperation): number {
  switch (op.entityType) {
    case "group":
      return 0;
    case "user_tag":
      return 1;
    case "item":
      return 2;
    case "participant":
      return 3;
    case "tag_assignment":
      return 4;
    default:
      return 9;
  }
}

/** Hydracja Zustand z entity store po cutoverze (IDB jest źródłem prawdy). */
export async function hydrateZustandFromV3(userId: string): Promise<void> {
  const db = await openSyncV3Db(userId);
  const entities = await listEntities(db, userId);
  const items: Record<string, Item> = {};
  const groups: Group[] = [];
  const tags: Record<string, UserTag> = {};
  const myTagIdsByItem: Record<string, string[]> = {};

  for (const ent of entities) {
    if (ent.entityType === "item") {
      items[ent.entityId] = canonicalToItem(ent.snapshot);
    } else if (ent.entityType === "group") {
      groups.push(ent.snapshot as unknown as Group);
    } else if (ent.entityType === "user_tag") {
      tags[ent.entityId] = ent.snapshot as unknown as UserTag;
    } else if (ent.entityType === "tag_assignment") {
      const snap = ent.snapshot as unknown as { itemId?: string; tagIds?: string[] };
      myTagIdsByItem[snap.itemId ?? ent.entityId] = snap.tagIds ?? [];
    }
  }

  useStore.setState({
    items: { ...useStore.getState().items, ...items },
    groups: groups.length ? groups : useStore.getState().groups,
    tags: { ...useStore.getState().tags, ...tags },
    myTagIdsByItem: { ...useStore.getState().myTagIdsByItem, ...myTagIdsByItem },
  });
}

export function wakeSyncV3Worker(): void {
  if (!activeUserId || !readActiveFlag() || !supabase) return;
  const uid = activeUserId;
  scheduleWakeWorker(() => {
    void runSyncV3WorkerPass({
      userId: uid,
      authUserId: uid,
      sortOps: (ops) => [...ops].sort((a, b) => entityPushOrder(a) - entityPushOrder(b)),
      transport: {
        upsertItem: async (row) => {
          const { error } = await supabase!.from("items").upsert(row);
          return { error: error ? { code: error.code, message: error.message } : null };
        },
        upsertGroup: async (row) => {
          const { error } = await supabase!.from("groups").upsert(row);
          return { error: error ? { code: error.code, message: error.message } : null };
        },
        upsertUserTag: async (row) => {
          const { error } = await supabase!.from("user_tags").upsert(row);
          return { error: error ? { code: error.code, message: error.message } : null };
        },
        upsertTagAssignment: async (row) => {
          const { error } = await supabase!
            .from("user_item_tag_assignments")
            .upsert(row, { onConflict: "user_id,item_id,tag_id" });
          return { error: error ? { code: error.code, message: error.message } : null };
        },
        deleteGroup: async (id) => {
          const { error } = await supabase!.from("groups").delete().eq("id", id);
          return { error: error ? { code: error.code, message: error.message } : null };
        },
        deleteUserTag: async (id) => {
          const { error } = await supabase!.from("user_tags").delete().eq("id", id);
          return { error: error ? { code: error.code, message: error.message } : null };
        },
        fetchRemoteUpdatedAt: async (id) => {
          const { data } = await supabase!
            .from("items")
            .select("updated_at")
            .eq("id", id)
            .maybeSingle();
          return (data?.updated_at as string | undefined) ?? null;
        },
      },
    });
  });
}

function startWorkerLoop() {
  stopWorkerLoop();
  registerSyncV3Wake(() => wakeSyncV3Worker());
  workerTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    wakeSyncV3Worker();
  }, 15_000);
  wakeSyncV3Worker();
}

function stopWorkerLoop() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

/**
 * Call graph (normalne otwarcie aplikacji):
 * auth resolved → userId → open v3 DB → inspect migrationState →
 * backup v2 → migrate entities → fetch remote IDs → verify →
 * atomic cutover active → start worker → hydrate Zustand.
 * Pull/merge wywoływane przez cloud po bootstrapie gdy active.
 */
export async function bootstrapSyncV3(userId: string | null): Promise<void> {
  stopWorkerLoop();
  activeUserId = userId;
  setSyncV3ActiveFlag(false);
  setSyncV3BlocksNotify(false);
  if (!userId || !cloudEnabled || !supabase) return;

  const db = await openSyncV3Db(userId);
  const meta = await runSyncV3Migration({
    userId,
    db,
    loadLegacy: () => loadLegacyFromIdb(userId),
    remote: {
      fetchRemoteItemIds: () => fetchAllRemoteItemIdsForUser(userId),
    },
  });

  const mode = resolveWriterMode(meta.migrationState);
  const active = mode === "v3";
  setSyncV3ActiveFlag(active);
  setSyncV3BlocksNotify(active);

  if (meta.migrationState === "awaiting_remote") {
    const onOnline = () => {
      window.removeEventListener("online", onOnline);
      void bootstrapSyncV3(userId);
    };
    window.addEventListener("online", onOnline);
  }

  if (active) {
    await hydrateZustandFromV3(userId);
    startWorkerLoop();
  }
}

export async function syncV3WriterModeLabel(userId: string | null): Promise<string> {
  if (!userId) return "v2";
  return resolveWriterMode(await getMigrationState(userId));
}

export function shouldRegisterV2ItemWriter(): boolean {
  return !readActiveFlag();
}
