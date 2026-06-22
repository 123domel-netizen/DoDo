import { filterVisibleItems, isItemDeleted } from "@/lib/items";
import { useStore } from "@/state/store";

/** Stan synchronizacji Sync v2 — Supabase = źródło prawdy, IDB = cache. */
export const syncState = {
  ready: false,
  booting: false,
  pushBlocked: false,
  applyingRemote: false,
  lastPullAt: null as string | null,
  lastPushAt: null as string | null,
  dirtyItemIds: new Set<string>(),
  /** SHARE uczestnik — osobna kolejka (nie push jako owned). */
  dirtyParticipantIds: new Set<string>(),
  tagAssignmentsDirty: false,
};

export function shouldTrackLocalChanges(): boolean {
  return syncState.ready && !syncState.booting && !syncState.applyingRemote;
}

export function shouldSchedulePush(): boolean {
  return shouldTrackLocalChanges() && !syncState.pushBlocked;
}

export function markItemDirty(id: string) {
  if (!shouldTrackLocalChanges()) return;
  const item = useStore.getState().items[id];
  if (item?.shareRole === "participant") {
    syncState.dirtyParticipantIds.add(id);
    return;
  }
  syncState.dirtyItemIds.add(id);
}

export function clearDirtyItems(ids: Iterable<string>) {
  for (const id of ids) syncState.dirtyItemIds.delete(id);
}

export function clearDirtyParticipants(ids: Iterable<string>) {
  for (const id of ids) syncState.dirtyParticipantIds.delete(id);
}

export function resetSyncState() {
  syncState.ready = false;
  syncState.booting = false;
  syncState.pushBlocked = false;
  syncState.applyingRemote = false;
  syncState.lastPullAt = null;
  syncState.lastPushAt = null;
  syncState.dirtyItemIds.clear();
  syncState.dirtyParticipantIds.clear();
  syncState.tagAssignmentsDirty = false;
}

export function trackStoreDirty(prev: {
  items: Record<string, { id: string }>;
  myTagIdsByItem: Record<string, string[]>;
}, next: {
  items: Record<string, { id: string }>;
  myTagIdsByItem: Record<string, string[]>;
}) {
  if (!shouldTrackLocalChanges()) return;

  const ids = new Set([...Object.keys(prev.items), ...Object.keys(next.items)]);
  for (const id of ids) {
    if (prev.items[id] !== next.items[id]) markItemDirty(id);
  }

  if (prev.myTagIdsByItem !== next.myTagIdsByItem) {
    syncState.tagAssignmentsDirty = true;
  }
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
    dirtyItemsCount: syncState.dirtyItemIds.size,
    dirtyParticipantCount: syncState.dirtyParticipantIds.size,
    tagAssignmentsDirty: syncState.tagAssignmentsDirty,
    activeGroupFilter: s.activeGroupFilter,
    userId: s.authUserId,
    userEmail: s.authUserEmail,
  };
}
