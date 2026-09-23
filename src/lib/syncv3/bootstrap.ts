import { setSyncV3BlocksNotify } from "@/lib/syncWrite";
import {
  setSyncV3WriteFlags,
  resetSyncV3Flags,
  isSyncV3ActiveCached as readWorkerFlag,
} from "@/lib/syncv3/activeFlag";
import { registerSyncV3Wake } from "@/lib/syncv3/wake";
import { useStore } from "@/state/store";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { fetchAllRemoteItemIdsForUser } from "@/lib/syncv3/remoteIds";
import type { SyncOperation } from "@/lib/syncv3/types";
import {
  getMigrationState,
  resolveWriterMode,
  migrationStateAllowsV3Writes,
  migrationStateAllowsWorker,
} from "@/lib/syncv3/engine";
import { loadLegacyFromIdb, runSyncV3Migration } from "@/lib/syncv3/migrate";
import { canonicalToItem } from "@/lib/syncv3/canonical";
import { getEntity, listEntities, listReadyOperations, openSyncV3Db } from "@/lib/syncv3/db";
import { runSyncV3WorkerPass, scheduleWakeWorker } from "@/lib/syncv3/worker";
import type { Group, Item, UserTag } from "@/types";
import { parseTagAssignmentItemId } from "@/lib/syncv3/entityIds";

let activeUserId: string | null = null;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function getSyncV3ActiveUserId(): string | null {
  return activeUserId;
}

/** v2 writer usunięty z runtime. */
export async function isV2WriterAllowed(_userId: string | null): Promise<boolean> {
  return false;
}

export function isSyncV3ActiveCached(): boolean {
  return readWorkerFlag();
}

export async function refreshV3ActiveCache(userId: string): Promise<boolean> {
  const state = await getMigrationState(userId);
  const writes = migrationStateAllowsV3Writes(state);
  const worker = migrationStateAllowsWorker(state);
  setSyncV3WriteFlags({
    writesEnabled: writes,
    workerEnabled: worker,
    migrationBlocked: resolveWriterMode(state) === "blocked",
  });
  setSyncV3BlocksNotify(true); // notify nigdy nie jest durability po Sync v3
  return worker;
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

/**
 * FK readiness: tag_assignment czeka aż item i tagi istnieją lokalnie LUB
 * nie ma dla nich pending parent ops — wtedy defer (nextAttemptAt +5s), bez
 * blokowania niezależnych operacji w tej samej kolejce.
 */
export async function filterFkReadyOperations(
  _userId: string,
  ops: SyncOperation[],
  db: Awaited<ReturnType<typeof openSyncV3Db>>,
): Promise<{ ready: SyncOperation[]; deferred: SyncOperation[] }> {
  const ready: SyncOperation[] = [];
  const deferred: SyncOperation[] = [];
  const pendingParents = new Set(
    ops
      .filter((o) => o.entityType === "group" || o.entityType === "user_tag" || o.entityType === "item")
      .map((o) => `${o.entityType}:${o.entityId}`),
  );

  for (const op of ops) {
    if (op.entityType === "tag_assignment") {
      const itemId = parseTagAssignmentItemId(op.entityId);
      const snap = op.payload as unknown as { tagIds?: string[] };
      const itemMissing =
        pendingParents.has(`item:${itemId}`) || !(await getEntity(db, itemId));
      let tagMissing = false;
      for (const tagId of snap.tagIds ?? []) {
        if (pendingParents.has(`user_tag:${tagId}`)) {
          tagMissing = true;
          break;
        }
        if (!(await getEntity(db, tagId))) {
          // tag może już być w chmurze — pozwól workerowi spróbować; defer tylko gdy parent w TEJ kolejce
          tagMissing = false;
        }
      }
      if (itemMissing && pendingParents.has(`item:${itemId}`)) {
        deferred.push(op);
        continue;
      }
      if (tagMissing) {
        deferred.push(op);
        continue;
      }
    }
    if (op.entityType === "item") {
      const groupId = (op.payload as { groupId?: string | null }).groupId;
      if (groupId && pendingParents.has(`group:${groupId}`)) {
        deferred.push(op);
        continue;
      }
    }
    ready.push(op);
  }
  return { ready, deferred };
}

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
      if (!(ent.snapshot as { deletedAt?: string | null }).deletedAt) {
        groups.push(ent.snapshot as unknown as Group);
      }
    } else if (ent.entityType === "user_tag") {
      if (!(ent.snapshot as { deletedAt?: string | null }).deletedAt) {
        tags[ent.entityId] = ent.snapshot as unknown as UserTag;
      }
    } else if (ent.entityType === "tag_assignment") {
      const snap = ent.snapshot as unknown as { itemId?: string; tagIds?: string[] };
      myTagIdsByItem[snap.itemId ?? parseTagAssignmentItemId(ent.entityId)] =
        snap.tagIds ?? [];
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
  if (!activeUserId || !readWorkerFlag() || !supabase) return;
  const uid = activeUserId;
  scheduleWakeWorker(() => {
    void (async () => {
      const db = await openSyncV3Db(uid);
      const pending = await listReadyOperations(db, uid);
      const { ready, deferred } = await filterFkReadyOperations(uid, pending, db);
      const now = new Date().toISOString();
      const { updateOperation } = await import("@/lib/syncv3/db");
      for (const op of deferred) {
        await updateOperation(db, {
          ...op,
          nextAttemptAt: new Date(Date.now() + 5_000).toISOString(),
          updatedAt: now,
          lastErrorCode: "fk_deferred",
          lastErrorMessage: "waiting for parent entity in queue",
        });
      }
      await runSyncV3WorkerPass({
        userId: uid,
        authUserId: uid,
        db,
        sortOps: (ops) => [...ops].sort((a, b) => entityPushOrder(a) - entityPushOrder(b)),
        // Worker i tak listuje ready — defer już przesunięte; filtrujemy do ready ids
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
      void ready;
    })();
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
 * Call graph:
 * auth → userId → open v3 → migrate → set write flags → hydrate →
 * (active ⇒ start worker) → cloud pull via applyRemoteEntities
 */
export async function bootstrapSyncV3(userId: string | null): Promise<void> {
  stopWorkerLoop();
  activeUserId = userId;
  resetSyncV3Flags();
  setSyncV3BlocksNotify(true);
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
  const writes = mode === "v3" || mode === "v3_local";
  const worker = mode === "v3";
  setSyncV3WriteFlags({
    writesEnabled: writes,
    workerEnabled: worker,
    migrationBlocked: mode === "blocked",
  });
  setSyncV3BlocksNotify(true);

  if (meta.migrationState === "awaiting_remote") {
    const onOnline = () => {
      window.removeEventListener("online", onOnline);
      void bootstrapSyncV3(userId);
    };
    window.addEventListener("online", onOnline);
  }

  await hydrateZustandFromV3(userId);

  if (worker) {
    startWorkerLoop();
  }
}

export async function syncV3WriterModeLabel(userId: string | null): Promise<string> {
  if (!userId) return "local_only";
  return resolveWriterMode(await getMigrationState(userId));
}

/** Zawsze false — v2 item writer usunięty. */
export function shouldRegisterV2ItemWriter(): boolean {
  return false;
}
