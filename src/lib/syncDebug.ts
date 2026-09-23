/**
 * Tymczasowa, observer-only diagnostyka syncu (konsola).
 *
 * Włączanie (na urządzeniu, w DevTools / remote console):
 *   localStorage.setItem('dodo-sync-debug', '1')
 *   location.reload()
 *
 * Potem:
 *   await __dodoSyncInspect.inspectByTitle('Bachusz podpisy')
 *   await __dodoSyncInspect.watchTitle('Bachusz podpisy')  // śledzi UUID przy następnym Wyślij
 *   __dodoSyncInspect.getTrace()
 *
 * Nie enqueue, nie pushuje, nie czyści, nie naprawia.
 */

import { get } from "idb-keyval";
import { coerceItemType } from "@/lib/dates";
import { outboxStorageKey, loadOutbox } from "@/lib/syncOutbox";
import {
  getOutboxUserId,
  getSyncDiagnostics,
  syncState,
} from "@/lib/syncState";
import { useStore } from "@/state/store";
import type { Item } from "@/types";

const FLAG_KEY = "dodo-sync-debug";
const WATCH_ID_KEY = "dodo-sync-debug-watch-id";
const WATCH_TITLE_KEY = "dodo-sync-debug-watch-title";

export type SyncPushSkipReason =
  | "not_in_dirty"
  | "not_in_outbox"
  | "missing_from_store"
  | "participant_item"
  | "not_owned"
  | "invalid_payload"
  | "push_blocked"
  | "auth_user_mismatch"
  | "outbox_user_mismatch"
  | "batch_stopped_before_target"
  | "in_flight_early_return"
  | "offline"
  | "booting"
  | "applying_remote"
  | "sync_not_ready"
  | "no_supabase"
  | "no_auth_user"
  | "empty_pending"
  | "unknown";

export type SyncPushTraceStage =
  | "SEND_CLICKED"
  | "FLUSH_ENTERED"
  | "PENDING_IDS_CAPTURED"
  | "TARGET_ID_PRESENT"
  | "TARGET_ID_ABSENT"
  | "ITEM_FOUND_IN_STORE"
  | "ITEM_MISSING_IN_STORE"
  | "ITEM_TO_ROW_INPUT"
  | "ITEM_TO_ROW_OUTPUT"
  | "TARGET_INCLUDED_IN_BATCH"
  | "TARGET_EXCLUDED_FROM_BATCH"
  | "SUPABASE_UPSERT_STARTED"
  | "SUPABASE_UPSERT_RESULT"
  | "DIRTY_CLEARED"
  | "DIRTY_RETAINED"
  | "OUTBOX_PERSISTED_AFTER_ATTEMPT"
  | "SEND_ATTEMPT_FINISHED"
  | "RUN_PUSH_EARLY_RETURN";

export interface SyncPushTraceEntry {
  timestamp: string;
  correlationId: string;
  itemId: string | null;
  stage: SyncPushTraceStage;
  result: string;
  skipReason?: SyncPushSkipReason;
  snapshot?: Record<string, unknown>;
}

export interface SyncInspectReport {
  queryTitle: string;
  foundInStore: boolean;
  itemSnapshot: {
    id: string;
    title: string;
    type: Item["type"] | null | undefined;
    coercedType: ReturnType<typeof coerceItemType>;
    groupId: string | null | undefined;
    start: string | null | undefined;
    end: string | null | undefined;
    updatedAt: string | null | undefined;
    deletedAt: string | null | undefined;
    shareRole: string | null | undefined;
    showInCalendar: boolean | undefined;
    showInTodo: boolean | undefined;
  } | null;
  itemId: string | null;
  duplicateTitleCount: number;
  foundInPersistedItems: boolean;
  foundInDirtyItemIds: boolean;
  foundInDirtyParticipantIds: boolean;
  foundInPersistedOutbox: boolean;
  outboxUserId: string | null;
  currentAuthUserId: string | null;
  cloudModuleUserId: string | null;
  persistStorageKey: string;
  outboxStorageKey: string;
  syncReady: boolean;
  booting: boolean;
  applyingRemote: boolean;
  pushBlocked: boolean;
  pushInFlight: boolean;
  navigatorOnline: boolean | null;
  lastPushError: string | null;
  lastPushAttemptAt: string | null;
  lastPushSuccessAt: string | null;
  previewRow: Record<string, unknown> | null;
  dirtyItemIdsSample: string[];
  persistedOutboxItemIdsSample: string[];
}

export interface SyncDebugHooks {
  getPushInFlight: () => boolean;
  getCloudModuleUserId: () => string | null;
  /** Bezpieczny podgląd payloadu jak itemToRow — bez side effects. */
  previewItemRow: (item: Item) => Record<string, unknown>;
}

let hooks: SyncDebugHooks | null = null;
const traceRing: SyncPushTraceEntry[] = [];
const TRACE_CAP = 200;
let activeCorrelationId: string | null = null;

export function isSyncDebugEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSyncDebugHooks(next: SyncDebugHooks | null) {
  hooks = next;
}

export function beginSyncDebugCorrelation(): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeCorrelationId = id;
  return id;
}

export function getActiveSyncDebugCorrelation(): string | null {
  return activeCorrelationId;
}

export function getWatchedItemId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(WATCH_ID_KEY);
  } catch {
    return null;
  }
}

function itemSnapshot(item: Item): SyncInspectReport["itemSnapshot"] {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    coercedType: coerceItemType(item),
    groupId: item.groupId,
    start: item.start,
    end: item.end,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt ?? null,
    shareRole: item.shareRole ?? null,
    showInCalendar: item.showInCalendar,
    showInTodo: item.showInTodo,
  };
}

function safeRowSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    group_id: row.group_id,
    start_at: row.start_at,
    end_at: row.end_at,
    deleted_at: row.deleted_at,
    updated_at: row.updated_at,
    created_at: row.created_at,
    all_day: row.all_day,
    show_in_calendar: row.show_in_calendar,
    show_in_todo: row.show_in_todo,
    done: row.done,
  };
}

export function syncDebugTrace(
  partial: Omit<SyncPushTraceEntry, "timestamp" | "correlationId"> & {
    correlationId?: string;
  },
) {
  if (!isSyncDebugEnabled()) return;
  const correlationId =
    partial.correlationId ?? activeCorrelationId ?? beginSyncDebugCorrelation();
  const entry: SyncPushTraceEntry = {
    timestamp: new Date().toISOString(),
    correlationId,
    itemId: partial.itemId,
    stage: partial.stage,
    result: partial.result,
    skipReason: partial.skipReason,
    snapshot: partial.snapshot,
  };
  traceRing.push(entry);
  if (traceRing.length > TRACE_CAP) traceRing.splice(0, traceRing.length - TRACE_CAP);
  console.info("[dodo-sync-debug]", entry);
}

export function isWatchedItem(itemId: string | null | undefined): boolean {
  if (!itemId) return false;
  const watched = getWatchedItemId();
  return Boolean(watched && watched === itemId);
}

export async function inspectItemByTitle(queryTitle: string): Promise<SyncInspectReport> {
  const s = useStore.getState();
  const diag = getSyncDiagnostics();
  const authUserId = s.authUserId;
  const persistStorageKey = authUserId
    ? `kalendarz-todo-v1-${authUserId}`
    : "kalendarz-todo-v1-local";
  const outboxKey = outboxStorageKey(authUserId);
  const outboxUid = getOutboxUserId();

  const matches = Object.values(s.items).filter((it) => it.title === queryTitle);
  const item = matches[0] ?? null;
  const itemId = item?.id ?? null;

  let foundInPersistedItems = false;
  try {
    const raw = await get<string>(persistStorageKey);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as { state?: { items?: Record<string, Item> } };
      const items = parsed?.state?.items ?? {};
      if (itemId) {
        foundInPersistedItems = Boolean(items[itemId]);
      } else {
        foundInPersistedItems = Object.values(items).some((it) => it?.title === queryTitle);
      }
    }
  } catch {
    foundInPersistedItems = false;
  }

  const persistedOutbox = await loadOutbox(authUserId);
  const foundInDirtyItemIds = itemId ? syncState.dirtyItemIds.has(itemId) : false;
  const foundInDirtyParticipantIds = itemId
    ? syncState.dirtyParticipantIds.has(itemId)
    : false;
  const foundInPersistedOutbox = itemId
    ? persistedOutbox.itemIds.includes(itemId) ||
      persistedOutbox.participantIds.includes(itemId)
    : false;

  let previewRow: Record<string, unknown> | null = null;
  if (item && hooks) {
    try {
      previewRow = safeRowSnapshot(hooks.previewItemRow(item));
    } catch (err) {
      previewRow = { previewError: String(err) };
    }
  }

  return {
    queryTitle,
    foundInStore: Boolean(item),
    itemSnapshot: item ? itemSnapshot(item) : null,
    itemId,
    duplicateTitleCount: matches.length,
    foundInPersistedItems,
    foundInDirtyItemIds,
    foundInDirtyParticipantIds,
    foundInPersistedOutbox,
    outboxUserId: outboxUid,
    currentAuthUserId: authUserId,
    cloudModuleUserId: hooks?.getCloudModuleUserId() ?? null,
    persistStorageKey,
    outboxStorageKey: outboxKey,
    syncReady: diag.syncReady,
    booting: diag.syncBooting,
    applyingRemote: diag.applyingRemote,
    pushBlocked: diag.pushBlocked,
    pushInFlight: hooks?.getPushInFlight() ?? false,
    navigatorOnline: typeof navigator !== "undefined" ? navigator.onLine : null,
    lastPushError: diag.lastPushError,
    lastPushAttemptAt: diag.lastPushAt,
    // Nie jest osobno śledzone w syncState — sukces = brak pending + brak lastPushError.
    lastPushSuccessAt:
      !diag.lastPushError &&
      syncState.dirtyItemIds.size === 0 &&
      syncState.dirtyParticipantIds.size === 0 &&
      !syncState.tagAssignmentsDirty
        ? diag.lastPushAt
        : null,
    previewRow,
    dirtyItemIdsSample: [...syncState.dirtyItemIds].slice(0, 40),
    persistedOutboxItemIdsSample: persistedOutbox.itemIds.slice(0, 40),
  };
}

export async function watchTitle(queryTitle: string): Promise<SyncInspectReport> {
  const report = await inspectItemByTitle(queryTitle);
  try {
    localStorage.setItem(FLAG_KEY, "1");
    localStorage.setItem(WATCH_TITLE_KEY, queryTitle);
    if (report.itemId) localStorage.setItem(WATCH_ID_KEY, report.itemId);
    else localStorage.removeItem(WATCH_ID_KEY);
  } catch {
    /* private mode */
  }
  console.info("[dodo-sync-debug] watching", {
    queryTitle,
    itemId: report.itemId,
    report,
  });
  return report;
}

export function getSyncDebugTrace(): SyncPushTraceEntry[] {
  return [...traceRing];
}

export function clearSyncDebugTrace() {
  traceRing.length = 0;
}

export function installSyncDebugApi() {
  if (typeof window === "undefined") return;
  const api = {
    enable: () => {
      localStorage.setItem(FLAG_KEY, "1");
      console.info("[dodo-sync-debug] enabled — przeładuj stronę jeśli API było wcześniej niedostępne");
    },
    disable: () => {
      localStorage.removeItem(FLAG_KEY);
      localStorage.removeItem(WATCH_ID_KEY);
      localStorage.removeItem(WATCH_TITLE_KEY);
    },
    inspectByTitle: inspectItemByTitle,
    watchTitle,
    getTrace: getSyncDebugTrace,
    clearTrace: clearSyncDebugTrace,
    isEnabled: isSyncDebugEnabled,
    getWatchedItemId,
  };
  (window as unknown as { __dodoSyncInspect: typeof api }).__dodoSyncInspect = api;
  if (isSyncDebugEnabled()) {
    console.info(
      "[dodo-sync-debug] ready — __dodoSyncInspect.inspectByTitle('Bachusz podpisy')",
    );
  }
}
