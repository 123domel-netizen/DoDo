import { filterVisibleItems, isItemDeleted } from "@/lib/items";
import { useStore } from "@/state/store";
import {
  loadOutbox,
  saveOutbox,
  type PersistedOutbox,
} from "@/lib/syncOutbox";

/** Stan synchronizacji Sync v2 — Supabase = źródło prawdy, IDB = cache. */
export const syncState = {
  ready: false,
  booting: false,
  pushBlocked: false,
  applyingRemote: false,
  lastPullAt: null as string | null,
  lastPushAt: null as string | null,
  lastPushError: null as string | null,
  dirtyItemIds: new Set<string>(),
  /** SHARE uczestnik — osobna kolejka (nie push jako owned). */
  dirtyParticipantIds: new Set<string>(),
  tagAssignmentsDirty: false,
};

// ---------------------------------------------------------------------------
// Trwałość kolejki — bez niej restart aplikacji gubił informację „jest co wysłać"
// ---------------------------------------------------------------------------

const PERSIST_DEBOUNCE_MS = 250;

let outboxUserId: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function outboxSnapshot(): PersistedOutbox {
  return {
    itemIds: [...syncState.dirtyItemIds],
    participantIds: [...syncState.dirtyParticipantIds],
    tagAssignmentsDirty: syncState.tagAssignmentsDirty,
  };
}

function cancelScheduledPersist() {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistTimer = null;
}

function schedulePersistOutbox() {
  cancelScheduledPersist();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void saveOutbox(outboxUserId, outboxSnapshot());
  }, PERSIST_DEBOUNCE_MS);
}

/** Zapis bez czekania na debounce — przy `pagehide` liczy się każda milisekunda. */
export async function persistOutboxNow(): Promise<void> {
  cancelScheduledPersist();
  await saveOutbox(outboxUserId, outboxSnapshot());
}

/**
 * Podłącza kolejkę do konta i odtwarza to, co nie zdążyło pójść do chmury.
 * Zwraca liczbę odtworzonych wpisów (diagnostyka / logi).
 */
export async function restoreOutboxForUser(userId: string | null): Promise<number> {
  // Odłożony zapis poprzedniego konta nie może trafić pod nowy klucz.
  cancelScheduledPersist();
  outboxUserId = userId;
  syncState.dirtyItemIds.clear();
  syncState.dirtyParticipantIds.clear();
  syncState.tagAssignmentsDirty = false;

  if (!userId) return 0;

  const stored = await loadOutbox(userId);
  for (const id of stored.itemIds) syncState.dirtyItemIds.add(id);
  for (const id of stored.participantIds) syncState.dirtyParticipantIds.add(id);
  syncState.tagAssignmentsDirty = stored.tagAssignmentsDirty;
  return stored.itemIds.length + stored.participantIds.length;
}

export function shouldTrackLocalChanges(): boolean {
  return syncState.ready && !syncState.booting && !syncState.applyingRemote;
}

export function shouldSchedulePush(): boolean {
  return shouldTrackLocalChanges() && !syncState.pushBlocked;
}

export function markItemDirty(id: string) {
  if (!shouldTrackLocalChanges()) return;
  enqueueItem(id);
}

/**
 * Kolejkuje z pominięciem bramek `shouldTrackLocalChanges`.
 * Używane przez rekoncyliację po pullu — tam wiemy z porównania z chmurą, że
 * wpis nie został wysłany, niezależnie od tego, czy trwa właśnie boot.
 */
export function enqueueItem(id: string) {
  const item = useStore.getState().items[id];
  if (item?.shareRole === "participant") {
    syncState.dirtyParticipantIds.add(id);
  } else {
    syncState.dirtyItemIds.add(id);
  }
  schedulePersistOutbox();
}

export function markTagAssignmentsDirty() {
  syncState.tagAssignmentsDirty = true;
  schedulePersistOutbox();
}

export function clearDirtyItems(ids: Iterable<string>) {
  let changed = false;
  for (const id of ids) changed = syncState.dirtyItemIds.delete(id) || changed;
  if (changed) schedulePersistOutbox();
}

export function clearDirtyParticipants(ids: Iterable<string>) {
  let changed = false;
  for (const id of ids) changed = syncState.dirtyParticipantIds.delete(id) || changed;
  if (changed) schedulePersistOutbox();
}

export function clearTagAssignmentsDirty() {
  if (!syncState.tagAssignmentsDirty) return;
  syncState.tagAssignmentsDirty = false;
  schedulePersistOutbox();
}

export function hasPendingPush(): boolean {
  return (
    syncState.dirtyItemIds.size > 0 ||
    syncState.dirtyParticipantIds.size > 0 ||
    syncState.tagAssignmentsDirty
  );
}

export function resetSyncState() {
  syncState.ready = false;
  syncState.booting = false;
  syncState.pushBlocked = false;
  syncState.applyingRemote = false;
  syncState.lastPullAt = null;
  syncState.lastPushAt = null;
  syncState.lastPushError = null;
  syncState.dirtyItemIds.clear();
  syncState.dirtyParticipantIds.clear();
  syncState.tagAssignmentsDirty = false;
  outboxUserId = null;
  cancelScheduledPersist();
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
    markTagAssignmentsDirty();
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
    lastPushError: syncState.lastPushError,
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