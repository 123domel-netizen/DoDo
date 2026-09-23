import { cloudEnabled, supabase } from "@/lib/supabase";
import {
  canRunV2Writer,
  isSyncV3Active,
  loadLegacyFromIdb,
  openSyncV3Db,
  resolveWriterMode,
  runSyncV3Migration,
  runSyncV3WorkerPass,
  scheduleWakeWorker,
  getMigrationState,
} from "@/lib/syncv3";
import { useStore } from "@/state/store";
import { fetchAllRemoteItemIdsForUser } from "@/lib/syncv3/remoteIds";

let activeUserId: string | null = null;
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function getSyncV3ActiveUserId(): string | null {
  return activeUserId;
}

export async function isV2WriterAllowed(userId: string | null): Promise<boolean> {
  if (!userId) return true;
  return canRunV2Writer(userId);
}

/** Cache synchroniczny dla store (aktualizowany po migracji). */
let v3ActiveCache = false;

export function isSyncV3ActiveCached(): boolean {
  return v3ActiveCache;
}

export async function refreshV3ActiveCache(userId: string): Promise<boolean> {
  v3ActiveCache = await isSyncV3Active(userId);
  return v3ActiveCache;
}

export function wakeSyncV3Worker(): void {
  if (!activeUserId || !v3ActiveCache || !supabase) return;
  const uid = activeUserId;
  scheduleWakeWorker(() => {
    void runSyncV3WorkerPass({
      userId: uid,
      authUserId: uid,
      transport: {
        upsertItem: async (row) => {
          const { error } = await supabase!.from("items").upsert(row);
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

function startWorkerLoop(userId: string) {
  stopWorkerLoop();
  workerTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    wakeSyncV3Worker();
  }, 15_000);
  wakeSyncV3Worker();
  void userId;
}

function stopWorkerLoop() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

/**
 * Po auth: migracja → active ⇒ wyłącz v2, uruchom worker.
 * Przed active: safe_readonly / v2 wg resolveWriterMode.
 */
export async function bootstrapSyncV3(userId: string | null): Promise<void> {
  stopWorkerLoop();
  activeUserId = userId;
  v3ActiveCache = false;
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
  v3ActiveCache = mode === "v3";

  if (meta.migrationState === "awaiting_remote") {
    // ponów gdy online
    const onOnline = () => {
      window.removeEventListener("online", onOnline);
      void bootstrapSyncV3(userId);
    };
    window.addEventListener("online", onOnline);
  }

  if (v3ActiveCache) {
    startWorkerLoop(userId);
    // Załaduj encje v3 do store jeśli puste orphan — merge w osobnym kroku; na start
    // zachowaj istniejący Zustand (już zhydratowany z v2 key).
    void useStore.getState();
  }
}

export async function syncV3WriterModeLabel(userId: string | null): Promise<string> {
  if (!userId) return "v2";
  return resolveWriterMode(await getMigrationState(userId));
}
