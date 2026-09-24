import type { RealtimeChannel } from "@supabase/supabase-js";
import { withNormalizedAllDay } from "@/lib/allDay";
import {
  ensureArchiveGroup,
  ensureShareGroup,
  isArchiveGroup,
  isGoogleGroup,
  resolveGroupVisibility,
} from "@/lib/groups";
import { isShareGroup, updateSharedItemContent, updateOwnParticipationReminders } from "@/lib/share";
import { sanitizeItemDates, coerceItemType } from "@/lib/dates";
import {
  participantRowFromParticipant,
  mergeParticipantsWithDb,
  personalRemindersFromDbRow,
  type ParticipantDbRow,
} from "@/lib/participants";
import type { Group, Item, UserTag } from "@/types";
import { resetLocalUserState, switchPersistUser, useStore } from "@/state/store";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { bootstrapOrgs } from "@/lib/orgs";
import { loadAssignableContacts } from "@/lib/contacts";
import { migrateGroupColor } from "@/lib/factory";
import {
  getSyncDiagnostics,
  resetSyncState,
  syncState,
} from "@/lib/syncState";
import { bootstrapSyncV3, wakeSyncV3Worker } from "@/lib/syncv3/bootstrap";
import {
  applyRemoteGroupsToStore,
  applyRemoteItemsToStore,
  applyRemoteTagAssignmentsToStore,
  applyRemoteTagsToStore,
  applyRemoteResultToZustand,
  applyRemoteSnapshotAtomically,
} from "@/lib/syncv3/cloudRemoteBridge";
import { applyRemoteEntities, remoteGroupInput, remoteItemInput } from "@/lib/syncv3/remoteApply";
import { mergeRemotePartialIntoZustand } from "@/lib/syncv3/consistentSnapshot";
import { installSyncDebugApi, setSyncDebugHooks } from "@/lib/syncDebug";

/**
 * Optional cloud sync. When Supabase env vars are present and a user is signed
 * in, local items are mirrored to the `items` table and remote changes are
 * streamed back via Realtime. Without configuration the app stays fully local.
 */

const ITEM_PULL_PAGE_SIZE = 1000;

/** PostgREST ucina wynik do ~1000 wierszy â€” bez paginacji reconcile â€žgubiâ€ť zdalne ID. */
async function fetchAllItemRows(): Promise<{
  rows: Record<string, unknown>[];
  error: string | null;
}> {
  if (!supabase || !userId) return { rows: [], error: null };
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += ITEM_PULL_PAGE_SIZE) {
    const to = from + ITEM_PULL_PAGE_SIZE - 1;
    const { data, error } = await supabase.from("items").select("*").range(from, to);
    if (error) return { rows, error: error.message };
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < ITEM_PULL_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

/** Lekki skan: same ID-y z chmury (bez payloadu) â€” do doganiania never-pushed. */
/** Lekki skan remote ID — używany przez Sync v3 remoteIds; zachowany dla testów. */
export async function fetchAllRemoteItemIds(): Promise<{ ids: string[]; error: string | null }> {
  if (!supabase || !userId) return { ids: [], error: null };
  const ids: string[] = [];
  for (let from = 0; ; from += ITEM_PULL_PAGE_SIZE) {
    const to = from + ITEM_PULL_PAGE_SIZE - 1;
    const { data, error } = await supabase.from("items").select("id").range(from, to);
    if (error) return { ids, error: error.message };
    const page = data ?? [];
    for (const row of page) {
      if (typeof row.id === "string" && row.id) ids.push(row.id);
    }
    if (page.length < ITEM_PULL_PAGE_SIZE) break;
  }
  return { ids, error: null };
}

let userId: string | null = null;
let userEmail: string | null = null;
let previousUserId: string | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let realtimeSubscribed = false;
let realtimeEverSubscribed = false;
let realtimeFailureStreak = 0;
let realtimeResubscribeTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleBound = false;

function setApplyingRemote(v: boolean) {
  syncState.applyingRemote = v;
}

// Synchronizacja grup
let groupsReady = false;
let lastGroupsSnapshot = "";
let lastTagsSnapshot = "";
let lastAssignmentsSnapshot = "";

export function getCloudDomainSnapshots() {
  return { lastTagsSnapshot, lastAssignmentsSnapshot, lastGroupsSnapshot, groupsReady };
}

function itemToRow(item: Item, payloadExtras?: Record<string, unknown>) {
  return {
    id: item.id,
    user_id: userId,
    type: coerceItemType(item),
    title: typeof item.title === "string" ? item.title : item.title == null ? "" : String(item.title),
    description:
      typeof item.description === "string"
        ? item.description
        : item.description == null
          ? ""
          : String(item.description),
    start_at: item.start,
    end_at: item.end,
    all_day: Boolean(item.allDay),
    group_id: item.groupId,
    show_in_calendar: Boolean(item.showInCalendar),
    show_in_todo: Boolean(item.showInTodo),
    done: Boolean(item.done),
    payload: {
      checklist: item.checklist,
      participants: item.participants,
      attachments: item.attachments,
      reminders: item.reminders,
      deadlineAt: item.deadlineAt ?? null,
      hasDueDate: item.hasDueDate,
      preArchiveGroupId: item.preArchiveGroupId ?? null,
      googleSyncOverride: item.googleSyncOverride ?? null,
      googleLinkGroupId: item.googleLinkGroupId ?? null,
      googleRecurrence: item.googleRecurrence,
      googleRecurringSeriesId: item.googleRecurringSeriesId ?? null,
      googleRecurrenceExceptions: item.googleRecurrenceExceptions,
      googleCalendarEventId: item.googleCalendarEventId ?? null,
      groupPromptDismissed: item.groupPromptDismissed ?? false,
      tagIds: item.tagIds ?? [],
      recurrence: item.recurrence ?? null,
      pinnedAt: item.pinnedAt ?? null,
      ...payloadExtras,
    },
    deleted_at: item.deletedAt ?? null,
    deleted_by: item.deletedBy ?? null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function rowToItem(row: Record<string, unknown>, shareRole: Item["shareRole"] = "owner"): Item {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const groupId = (row.group_id as string | null) ?? null;
  const ownerUserId = row.user_id as string;
  const item: Item = {
    id: row.id as string,
    type: row.type as Item["type"],
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    start: row.start_at as string,
    end: row.end_at as string,
    allDay: (row.all_day as boolean) ?? false,
    groupId,
    showInCalendar: (row.show_in_calendar as boolean) ?? true,
    showInTodo: (row.show_in_todo as boolean) ?? false,
    done: (row.done as boolean) ?? false,
    hasDueDate: (payload.hasDueDate as boolean) ?? true,
    preArchiveGroupId: (payload.preArchiveGroupId as string | null) ?? null,
    checklist: (payload.checklist as Item["checklist"]) ?? [],
    participants: (payload.participants as Item["participants"]) ?? [],
    attachments: (payload.attachments as Item["attachments"]) ?? [],
    reminders: (payload.reminders as Item["reminders"]) ?? [],
    deadlineAt: (payload.deadlineAt as string | null | undefined) ?? null,
    tagIds: (payload.tagIds as string[] | undefined) ?? [],
    recurrence: (payload.recurrence as Item["recurrence"]) ?? null,
    pinnedAt: (payload.pinnedAt as string | null | undefined) ?? null,
    googleSyncOverride: (payload.googleSyncOverride as Item["googleSyncOverride"]) ?? null,
    googleLinkGroupId: (payload.googleLinkGroupId as string | null) ?? null,
    googleRecurrence: (payload.googleRecurrence as string[] | undefined) ?? undefined,
    googleRecurringSeriesId: (payload.googleRecurringSeriesId as string | undefined) ?? undefined,
    googleRecurrenceExceptions:
      (payload.googleRecurrenceExceptions as Item["googleRecurrenceExceptions"]) ?? undefined,
    googleCalendarEventId: (payload.googleCalendarEventId as string | undefined) ?? undefined,
    syncSource: (payload.syncSource as Item["syncSource"]) ?? undefined,
    ownerUserId,
    shareRole,
    groupPromptDismissed: (payload.groupPromptDismissed as boolean) ?? false,
    deletedAt: (row.deleted_at as string | null) ?? null,
    deletedBy: (row.deleted_by as string | null) ?? null,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
  const { item: clean, demotedDueDate } = sanitizeItemDates(item);
  if (demotedDueDate) {
    console.warn(`[cloud] item ${clean.id}: niepoprawny start/end â€” zdjÄ™to termin z kalendarza`);
  }
  return clean.allDay ? withNormalizedAllDay(clean) : clean;
}

function rowToGroup(row: Record<string, unknown>): Group {
  const name = (row.name as string) ?? "";
  const base = { name, system: (row.system as Group["system"]) ?? undefined };
  const system: Group["system"] =
    base.system ??
    (isArchiveGroup(base) ? "archive" : isShareGroup(base) ? "share" : isGoogleGroup(base) ? "google" : undefined);
  const hideFromAll = (row.hide_from_all as boolean | null) ?? false;
  const showInAllCol = row.show_in_all as boolean | null | undefined;
  return {
    id: row.id as string,
    name,
    color: migrateGroupColor((row.color as string) ?? "#4A8FC4"),
    sortOrder: (row.sort_order as number) ?? 0,
    icon: (row.icon as string | null) ?? undefined,
    system,
    hideFromAll: hideFromAll || undefined,
    showInSidebar: (row.show_in_sidebar as boolean | null) ?? undefined,
    showInTasks: (row.show_in_tasks as boolean | null) ?? undefined,
    showInEvents: (row.show_in_events as boolean | null) ?? undefined,
    showInDashboard: (row.show_in_dashboard as boolean | null) ?? undefined,
    showInAll:
      showInAllCol !== null && showInAllCol !== undefined
        ? showInAllCol
        : hideFromAll
          ? false
          : undefined,
  };
}

function groupsSnapshot(groups: Group[]): string {
  return JSON.stringify(
    groups.map((g) => {
      const v = resolveGroupVisibility(g);
      return [
        g.id,
        g.name,
        g.color,
        g.icon ?? null,
        g.sortOrder,
        g.system ?? null,
        v.showInAll,
        v.showInSidebar,
        v.showInTasks,
        v.showInEvents,
        v.showInDashboard,
      ];
    }),
  );
}

function tagsSnapshot(tags: Record<string, UserTag>): string {
  return JSON.stringify(
    Object.values(tags).map((t) => [t.id, t.name, t.color, t.updatedAt]),
  );
}

function rowToTag(row: Record<string, unknown>): UserTag {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: (row.name as string) ?? "",
    color: migrateGroupColor((row.color as string) ?? "#7A6CB8"),
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function assignmentsSnapshot(map: Record<string, string[]>): string {
  return JSON.stringify(
    Object.entries(map)
      .filter(([, ids]) => ids.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function pullUserTags() {
  if (!supabase || !userId) return;
  const { data, error } = await supabase.from("user_tags").select("*").eq("user_id", userId);
  if (error) {
    console.warn("[cloud] tags pull failed:", error.message);
    return;
  }
  const tags: UserTag[] = [];
  for (const row of data ?? []) {
    tags.push(rowToTag(row));
  }
  setApplyingRemote(true);
  try {
    const result = await applyRemoteTagsToStore(userId, tags);
    if (result.ok) lastTagsSnapshot = tagsSnapshot(useStore.getState().tags);
  } finally {
    setApplyingRemote(false);
  }
}

async function pullTagAssignments() {
  if (!supabase || !userId) return;
  const { data, error } = await supabase
    .from("user_item_tag_assignments")
    .select("item_id, tag_ids")
    .eq("user_id", userId);
  if (error) {
    console.warn("[cloud] tag assignments pull failed:", error.message);
    return;
  }
  const remote: Record<string, string[]> = {};
  for (const row of data ?? []) {
    remote[row.item_id as string] = (row.tag_ids as string[]) ?? [];
  }
  setApplyingRemote(true);
  try {
    const result = await applyRemoteTagAssignmentsToStore(userId, remote);
    if (result.ok) lastAssignmentsSnapshot = assignmentsSnapshot(useStore.getState().myTagIdsByItem);
  } finally {
    setApplyingRemote(false);
  }
}

/**
 * Sprowadza listę zdalnych grup do jednej grupy systemowej każdego typu.
 * Zwraca też mapę remap (stare id duplikatu → id zachowane) oraz id do usunięcia.
 */
function reconcileGroups(remote: Group[]): {
  groups: Group[];
  remap: Map<string, string>;
  deleteIds: string[];
} {
  const remap = new Map<string, string>();
  const deleteIds: string[] = [];
  let archiveKept: Group | null = null;
  // SHARE jest tylko wirtualny w aplikacji — usuń z bazy, jeśli kiedyś trafił.
  // Deduplikacja grup użytkownika po nazwie — naprawia duplikaty powstałe, gdy
  // dwa urządzenia zasiały tabelę zanim się nawzajem zobaczyły.
  const userByName = new Map<string, Group>();
  const result: Group[] = [];

  for (const g of remote) {
    if (isArchiveGroup(g)) {
      if (archiveKept) {
        remap.set(g.id, archiveKept.id);
        deleteIds.push(g.id);
      } else {
        archiveKept = g;
        result.push(g);
      }
    } else if (isShareGroup(g)) {
      deleteIds.push(g.id);
    } else if (isGoogleGroup(g)) {
      // Legacy — integracja Google usunięta.
      deleteIds.push(g.id);
    } else {
      const key = g.name.trim().toLowerCase();
      const kept = userByName.get(key);
      if (kept) {
        remap.set(g.id, kept.id);
        deleteIds.push(g.id);
      } else {
        userByName.set(key, g);
        result.push(g);
      }
    }
  }
  return { groups: result, remap, deleteIds };
}

async function pullSharedItems(): Promise<Record<string, Item>> {
  if (!supabase || !userId) return {};
  const email = userEmail?.toLowerCase() ?? "";
  let query = supabase
    .from("item_participants")
    .select("status, personal_reminders, items(*)")
    .neq("status", "rejected");

  if (email) {
    query = query.or(`participant_user_id.eq.${userId},participant_email.eq.${email}`);
  } else {
    query = query.eq("participant_user_id", userId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[cloud] shared items pull failed:", error.message);
    return {};
  }

  const out: Record<string, Item> = {};
  for (const row of data ?? []) {
    const itemRow = row.items as unknown as Record<string, unknown> | null;
    if (!itemRow) continue;
    const item = rowToItem(itemRow, "participant");
    item.personalReminders = personalRemindersFromDbRow({
      personal_reminders: row.personal_reminders,
    } as ParticipantDbRow);
    out[item.id] = item;
  }
  return out;
}

async function pullOwnerParticipantRows(): Promise<Record<string, ParticipantDbRow[]>> {
  if (!supabase || !userId) return {};
  const { data, error } = await supabase
    .from("item_participants")
    .select("*")
    .eq("owner_user_id", userId);
  if (error) {
    console.warn("[cloud] owner participants pull failed:", error.message);
    return {};
  }
  const byItem: Record<string, ParticipantDbRow[]> = {};
  for (const row of data ?? []) {
    const itemId = row.item_id as string;
    (byItem[itemId] ??= []).push(row as ParticipantDbRow);
  }
  return byItem;
}


/** Owner participants sync — used by Sync v3 worker after item upsert. */
export async function syncOwnerItemParticipants(item: Item): Promise<{ error: { message: string } | null }> {
  if (!supabase || !userId || item.shareRole === "participant" || item.deletedAt) {
    return { error: null };
  }
  const rows = item.participants
    .filter((p) => p.status !== "rejected")
    .map((p) => participantRowFromParticipant(item.id, userId!, p))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const payloadEmails = new Set(rows.map((r) => r.participant_email));

  const { data: existing } = await supabase
    .from("item_participants")
    .select("id, participant_email, status")
    .eq("item_id", item.id);

  for (const row of existing ?? []) {
    const email = row.participant_email as string;
    const status = row.status as string;
    if (status === "rejected") continue;
    if (!payloadEmails.has(email)) {
      await supabase.from("item_participants").delete().eq("id", row.id as string);
    }
  }

  if (rows.length) {
    const { error } = await supabase.from("item_participants").upsert(rows, {
      onConflict: "item_id,participant_email",
    });
    if (error) return { error: { message: error.message } };
  }
  return { error: null };
}

export async function patchParticipantViaRpc(input: {
  itemId: string;
  description?: string;
  checklist?: unknown;
  attachments?: unknown;
  personalReminders?: unknown;
}): Promise<{ error: { message: string } | null }> {
  if (!supabase || !userId) return { error: { message: "no auth" } };
  let ok = true;
  if (
    input.description !== undefined ||
    input.checklist !== undefined ||
    input.attachments !== undefined
  ) {
    const { error } = await updateSharedItemContent(input.itemId, {
      description: (input.description as string) ?? "",
      checklist: (input.checklist as Item["checklist"]) ?? [],
      attachments: (input.attachments as Item["attachments"]) ?? [],
    });
    if (error) {
      console.warn("[cloud] participant patch failed:", error);
      ok = false;
    }
  }
  if (input.personalReminders !== undefined) {
    const { error } = await updateOwnParticipationReminders(
      input.itemId,
      (input.personalReminders as Item["personalReminders"]) ?? [],
    );
    if (error) {
      console.warn("[cloud] personal reminders patch failed:", error);
      ok = false;
    }
  }
  return ok ? { error: null } : { error: { message: "participant_patch_failed" } };
}

async function pullAllViaSyncV3() {
  if (!supabase || !userId) return;

  // Pobierz groups + items PRZED publikacją — potem jedna txn IDB i jeden snapshot.
  const groupsRes = await supabase.from("groups").select("*");
  if (groupsRes.error) {
    console.warn("[cloud] group pull failed:", groupsRes.error.message);
    // Nie czyść lokalnych groups; nadal spróbuj items, ale publikuj atomowo z IDB.
  }

  const { rows, error } = await fetchAllItemRows();
  if (error) {
    console.warn("[cloud] item pull failed:", error);
    return;
  }

  const remoteGroups = (groupsRes.data ?? []).map(rowToGroup);
  const { groups: reconciled } = groupsRes.error
    ? { groups: [] as Group[] }
    : reconcileGroups(remoteGroups);
  const ensuredGroups =
    !groupsRes.error && remoteGroups.length
      ? ensureShareGroup(ensureArchiveGroup(reconciled))
      : [];

  const participantByItem = await pullOwnerParticipantRows();
  const items: Item[] = [];
  for (const row of rows) {
    let item = rowToItem(row, "owner");
    const dbRows = participantByItem[item.id];
    if (dbRows?.length) {
      item = { ...item, participants: mergeParticipantsWithDb(item.participants, dbRows) };
    }
    items.push(item);
  }
  const shared = await pullSharedItems();
  items.push(...Object.values(shared));

  setApplyingRemote(true);
  try {
    const remotes = [
      ...ensuredGroups.map((g) => remoteGroupInput(g)),
      ...items.map(remoteItemInput),
    ];
    const result = await applyRemoteEntities({
      userId,
      remotes,
      // Nie publikuj cząstkowo — po commit IDB pełny snapshot.
      applyToUi: undefined,
    });
    if (!result.ok) {
      console.warn("[cloud] remote apply failed:", result.error);
      return;
    }
    await applyRemoteSnapshotAtomically(userId, result);
    if (!groupsRes.error) {
      groupsReady = true;
      lastGroupsSnapshot = groupsSnapshot(useStore.getState().groups);
    }
    syncState.lastPullAt = new Date().toISOString();
  } finally {
    setApplyingRemote(false);
  }
}

async function pullAll(_replace = false) {
  await pullAllViaSyncV3();
}

function teardownRealtime() {
  if (realtimeResubscribeTimer) {
    clearTimeout(realtimeResubscribeTimer);
    realtimeResubscribeTimer = null;
  }
  if (realtimeChannel && supabase) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeSubscribed = false;
}

function scheduleRealtimeResubscribe() {
  if (realtimeResubscribeTimer || !userId) return;
  const attempt = Math.min(realtimeFailureStreak, 5);
  const delay = Math.min(2_000 * 2 ** attempt, 60_000);
  realtimeResubscribeTimer = setTimeout(() => {
    realtimeResubscribeTimer = null;
    teardownRealtime();
    setupRealtime();
  }, delay);
}

function ensureRealtimeAlive() {
  if (!cloudEnabled || !supabase || !userId) return;
  if (realtimeSubscribed) return;
  teardownRealtime();
  setupRealtime();
}

function setupRealtime() {
  if (!supabase || !userId || realtimeChannel) return;
  const uid = userId;
  realtimeChannel = supabase
    .channel(`items-sync-${uid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (payload) => {
      void (async () => {
        setApplyingRemote(true);
        try {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            await applyRemoteEntities({
              userId: uid,
              remotes: [
                {
                  entityType: "item",
                  entityId: id,
                  snapshot: { id, updatedAt: new Date().toISOString() },
                  updatedAt: new Date().toISOString(),
                  deleted: true,
                },
              ],
              applyToUi: applyRemoteResultToZustand,
            });
          } else {
            const row = payload.new as Record<string, unknown>;
            const ownerId = row.user_id as string;
            const role = ownerId === uid ? "owner" : "participant";
            await applyRemoteItemsToStore(uid, [rowToItem(row, role)]);
          }
        } finally {
          setApplyingRemote(false);
        }
      })();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, (payload) => {
      void (async () => {
        setApplyingRemote(true);
        try {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            await applyRemoteEntities({
              userId: uid,
              remotes: [
                {
                  entityType: "group",
                  entityId: id,
                  snapshot: { id },
                  updatedAt: new Date().toISOString(),
                  deleted: true,
                },
              ],
              applyToUi: (r) => {
                if (!r.ok) return;
                mergeRemotePartialIntoZustand({ removedGroupIds: [id] });
              },
            });
          } else {
            await applyRemoteGroupsToStore(uid, [rowToGroup(payload.new as Record<string, unknown>)]);
          }
          lastGroupsSnapshot = groupsSnapshot(useStore.getState().groups);
        } finally {
          setApplyingRemote(false);
        }
      })();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        realtimeSubscribed = true;
        realtimeFailureStreak = 0;
        if (realtimeEverSubscribed) void cloudMergeRefresh();
        realtimeEverSubscribed = true;
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        realtimeSubscribed = false;
        realtimeFailureStreak += 1;
        scheduleRealtimeResubscribe();
      }
    });
}

export function getSyncDiagnosticsSnapshot() {
  return {
    ...getSyncDiagnostics(),
    autoPullEnabled: cloudEnabled,
    lastAutoPullAt,
    realtimeSubscribed,
  };
}

const AUTO_PULL_MIN_INTERVAL_MS = 60_000;
let autoPullInProgress = false;
let lastAutoPullAt: string | null = null;

function isUserActivelyEditing(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function msSinceLastPull(): number | null {
  if (!syncState.lastPullAt) return null;
  const t = new Date(syncState.lastPullAt).getTime();
  return Number.isNaN(t) ? null : Date.now() - t;
}

export function canAutoCloudRefresh(): boolean {
  if (!cloudEnabled || !supabase || !userId) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const diag = getSyncDiagnostics();
  if (!diag.syncReady || diag.syncBooting || diag.applyingRemote || diag.pushBlocked) {
    return false;
  }
  if (autoPullInProgress) return false;
  if (useStore.getState().draft) return false;
  if (isUserActivelyEditing()) return false;
  const since = msSinceLastPull();
  if (since != null && since < AUTO_PULL_MIN_INTERVAL_MS) return false;
  return true;
}

async function cloudMergeRefresh(): Promise<boolean> {
  if (!cloudEnabled || !supabase || !userId) return false;
  if (syncState.booting || syncState.applyingRemote) return false;
  try {
    // Jedna ścieżka: groups+items atomowo (bez pośredniego czyszczenia groups).
    await pullAll(false);
    return true;
  } catch (err) {
    console.warn("[cloud] merge refresh failed:", err);
    return false;
  }
}

export async function tryAutoCloudRefresh(): Promise<boolean> {
  if (!canAutoCloudRefresh()) return false;
  autoPullInProgress = true;
  try {
    wakeSyncV3Worker();
    const ok = await cloudMergeRefresh();
    if (ok) lastAutoPullAt = new Date().toISOString();
    return ok;
  } finally {
    autoPullInProgress = false;
  }
}

export async function forceCloudRefresh(): Promise<{ ok: boolean; message: string }> {
  if (!cloudEnabled || !supabase || !userId) {
    return { ok: false, message: "Synchronizacja niedostepna" };
  }
  wakeSyncV3Worker();
  syncState.pushBlocked = true;
  syncState.booting = true;
  try {
    await pullUserTags();
    await pullTagAssignments();
    await pullAll(true);
    const orgs = await bootstrapOrgs();
    useStore.getState().setOrgBootstrap(orgs);
    const st = useStore.getState();
    const contacts = await loadAssignableContacts({
      orgId: st.activeOrgId ?? st.myOrgs[0]?.id ?? null,
      ownerUserId: st.authUserId,
    });
    st.setTeamMembers(contacts);
    lastGroupsSnapshot = groupsSnapshot(useStore.getState().groups);
    lastTagsSnapshot = tagsSnapshot(useStore.getState().tags);
    lastAssignmentsSnapshot = assignmentsSnapshot(useStore.getState().myTagIdsByItem);
    return { ok: true, message: "Dane odswiezone" };
  } catch (err) {
    console.warn("[cloud] force refresh failed:", err);
    return { ok: false, message: "Odswiezenie nie powiodlo sie" };
  } finally {
    syncState.booting = false;
    syncState.pushBlocked = false;
    syncState.ready = true;
    wakeSyncV3Worker();
  }
}

export async function handleAuthUserChange(nextUserId: string | null) {
  if (!cloudEnabled || !supabase) return;
  if (nextUserId === previousUserId) return;

  userId = nextUserId;

  if (!nextUserId) {
    teardownRealtime();
    userEmail = null;
    useStore.getState().setAuthUser(null, null);
    await switchPersistUser(null);
    resetLocalUserState();
    previousUserId = null;
    groupsReady = false;
    lastGroupsSnapshot = "";
    resetSyncState();
    syncState.ready = true;
    await bootstrapSyncV3(null);
    return;
  }

  const isUserSwitch = previousUserId !== null && previousUserId !== nextUserId;
  previousUserId = nextUserId;

  syncState.booting = true;
  syncState.ready = false;
  groupsReady = false;
  lastGroupsSnapshot = "";

  await switchPersistUser(nextUserId);

  const { data: sessionData } = await supabase.auth.getUser();
  userEmail = sessionData.user?.email?.toLowerCase() ?? null;
  useStore.getState().setAuthUser(nextUserId, userEmail);

  if (isUserSwitch) {
    useStore.setState({
      clipboard: null,
      editingId: null,
      draft: null,
      teamMembers: [],
      groupPromptItemId: null,
      orgInviteNotice: null,
    });
  }

  try {
    const orgs = await bootstrapOrgs();
    useStore.getState().setOrgBootstrap(orgs);
    {
      const st = useStore.getState();
      const contacts = await loadAssignableContacts({
        orgId: st.activeOrgId ?? st.myOrgs[0]?.id ?? null,
        ownerUserId: st.authUserId,
      });
      st.setTeamMembers(contacts);
    }

    await bootstrapSyncV3(nextUserId);
    await pullUserTags();
    await pullTagAssignments();
    // groups+items w jednej atomowej ścieżce (pullAllViaSyncV3)
    await pullAll(false);

    teardownRealtime();
    setupRealtime();
  } finally {
    syncState.booting = false;
    syncState.ready = true;
  }
}

function bindSyncLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;

  window.addEventListener("online", () => {
    realtimeFailureStreak = 0;
    wakeSyncV3Worker();
    ensureRealtimeAlive();
  });

  window.addEventListener("pagehide", () => {});

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") return;
    ensureRealtimeAlive();
    wakeSyncV3Worker();
  });
}

export async function initCloudSync() {
  if (!cloudEnabled || !supabase) {
    syncState.ready = true;
    installSyncDebugApi();
    return;
  }
  syncState.booting = true;
  syncState.ready = false;
  try {
    setSyncDebugHooks({
      getPushInFlight: () => false,
      getCloudModuleUserId: () => userId,
      previewItemRow: (item: Item) => itemToRow(item) as Record<string, unknown>,
    });
    installSyncDebugApi();

    const { data } = await supabase.auth.getUser();
    await handleAuthUserChange(data.user?.id ?? null);

    supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthUserChange(session?.user?.id ?? null);
    });

    bindSyncLifecycle();
  } catch (err) {
    console.warn("[cloud] sync disabled:", err);
    syncState.booting = false;
    syncState.ready = true;
  } finally {
    if (!userId) {
      syncState.booting = false;
      syncState.ready = true;
    }
  }
}
