/**
 * Lekki stan koordynacji UI ↔ cloud (boot/pull), BEZ kolejki dirty Sync v2.
 * Dirty/outbox v2 żyje wyłącznie w syncv3/legacyReader (migracja).
 */
import { filterVisibleItems, isItemDeleted } from "@/lib/items";
import { useStore } from "@/state/store";

export const syncState = {
  ready: false,
  booting: false,
  /** Blokada pulla podczas force refresh — nie kolejka v2. */
  pushBlocked: false,
  applyingRemote: false,
  lastPullAt: null as string | null,
  lastPushAt: null as string | null,
};

export function resetSyncState() {
  syncState.ready = false;
  syncState.booting = false;
  syncState.pushBlocked = false;
  syncState.applyingRemote = false;
  syncState.lastPullAt = null;
  syncState.lastPushAt = null;
}

export function getSyncDiagnostics() {
  const s = useStore.getState();
  const all = Object.values(s.items);
  const visible = filterVisibleItems(all);
  const deleted = all.filter((it) => isItemDeleted(it));
  return {
    syncReady: syncState.ready,
    syncBooting: syncState.booting,
    applyingRemote: syncState.applyingRemote,
    pushBlocked: syncState.pushBlocked,
    lastPullAt: syncState.lastPullAt,
    lastPushAt: syncState.lastPushAt,
    localItemsCount: all.length,
    visibleItemsCount: visible.length,
    deletedItemsCount: deleted.length,
    activeGroupFilter: s.activeGroupFilter,
    userId: s.authUserId,
    userEmail: s.authUserEmail,
  };
}
