import type { RealtimeChannel } from "@supabase/supabase-js";
import { withNormalizedAllDay } from "@/lib/allDay";
import {
  ensureArchiveGroup,
  ensureShareGroup,
  isArchiveGroup,
  isGoogleGroup,
  resolveGroupVisibility,
  stripGoogleGroups,
} from "@/lib/groups";
import { isShareGroup, updateSharedItemContent, updateOwnParticipationReminders } from "@/lib/share";
import { mergeItemOnSync } from "@/lib/items";
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
import { migrateGroupColor, LEGACY_GROUP_COLOR_MAP } from "@/lib/factory";
import {
  clearDirtyItems,
  clearDirtyParticipants,
  clearTagAssignmentsDirty,
  enqueueItem,
  getSyncDiagnostics,
  hasPendingPush,
  persistOutboxNow,
  resetSyncState,
  restoreOutboxForUser,
  shouldSchedulePush,
  syncState,
  trackStoreDirty,
} from "@/lib/syncState";
import { chunkIds, itemIdsMissingInCloud, loadOutbox } from "@/lib/syncOutbox";
import { registerLocalItemWriteHandler } from "@/lib/syncWrite";
import {
  beginSyncDebugCorrelation,
  getActiveSyncDebugCorrelation,
  getWatchedItemId,
  installSyncDebugApi,
  isSyncDebugEnabled,
  isWatchedItem,
  setSyncDebugHooks,
  syncDebugTrace,
} from "@/lib/syncDebug";

/**
 * Optional cloud sync. When Supabase env vars are present and a user is signed
 * in, local items are mirrored to the `items` table and remote changes are
 * streamed back via Realtime. Without configuration the app stays fully local.
 */

const ITEM_PULL_PAGE_SIZE = 1000;
const ITEM_UPSERT_CHUNK_SIZE = 100;
const ORPHAN_SCAN_INTERVAL_MS = 90_000;

/** PostgREST ucina wynik do ~1000 wierszy — bez paginacji reconcile „gubi” zdalne ID. */
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

/** Lekki skan: same ID-y z chmury (bez payloadu) — do doganiania never-pushed. */
async function fetchAllRemoteItemIds(): Promise<{ ids: string[]; error: string | null }> {
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

/**
 * Lokalne wpisy, których nie ma w chmurze → kolejka + opcjonalny flush.
 * To jest siatka bezpieczeństwa na wypadek, gdy subscribe pominął zapis
 * (boot / applyingRemote) albo outbox zgubił ID.
 */
async function reconcileNeverPushed(opts?: { flush?: boolean }): Promise<number> {
  if (!supabase || !userId) return 0;
  if (syncState.booting || syncState.applyingRemote || syncState.pushBlocked) return 0;

  const { ids, error } = await fetchAllRemoteItemIds();
  if (error) {
    console.warn("[cloud] orphan id scan failed:", error);
    return 0;
  }

  const missing = itemIdsMissingInCloud({
    localItems: useStore.getState().items,
    remoteItemIds: ids,
  });
  if (!missing.length) return 0;

  console.warn(`[cloud] orphan scan: ${missing.length} lokalnych wpis(ów) bez chmury`);
  for (const id of missing) enqueueItem(id);
  void persistOutboxNow();
  if (opts?.flush !== false) await flushPendingPush();
  return missing.length;
}

let userId: string | null = null;
let userEmail: string | null = null;
let previousUserId: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let storeSubscribed = false;
let realtimeSubscribed = false;
let realtimeEverSubscribed = false;
let realtimeFailureStreak = 0;
let realtimeResubscribeTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let pushFailureStreak = 0;
let pushRetryTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleBound = false;
let orphanScanTimer: ReturnType<typeof setInterval> | null = null;

function setApplyingRemote(v: boolean) {
  syncState.applyingRemote = v;
}

// Synchronizacja grup
let groupsReady = false;
let lastGroupsSnapshot = "";
const pendingGroupDeletes = new Set<string>();
const pendingTagDeletes = new Set<string>();
let lastTagsSnapshot = "";
let lastAssignmentsSnapshot = "";

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
    console.warn(`[cloud] item ${clean.id}: niepoprawny start/end — zdjęto termin z kalendarza`);
  }
  return clean.allDay ? withNormalizedAllDay(clean) : clean;
}

function groupToRow(group: Group) {
  const v = resolveGroupVisibility(group);
  return {
    id: group.id,
    user_id: userId,
    name: group.name,
    color: group.color,
    sort_order: group.sortOrder,
    system: group.system ?? null,
    hide_from_all: !v.showInAll,
    show_in_sidebar: v.showInSidebar,
    show_in_tasks: v.showInTasks,
    show_in_events: v.showInEvents,
    show_in_dashboard: v.showInDashboard,
    show_in_all: v.showInAll,
    icon: group.icon ?? null,
  };
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

function tagToRow(tag: UserTag) {
  return {
    id: tag.id,
    user_id: userId,
    name: tag.name,
    color: tag.color,
    created_at: tag.createdAt,
    updated_at: tag.updatedAt,
  };
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

function tagsSnapshot(tags: Record<string, UserTag>): string {
  return JSON.stringify(
    Object.values(tags).map((t) => [t.id, t.name, t.color, t.updatedAt]),
  );
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
  const tags: Record<string, UserTag> = {};
  let colorsMigrated = false;
  for (const row of data ?? []) {
    const raw = ((row.color as string) ?? "").toLowerCase();
    if (raw in LEGACY_GROUP_COLOR_MAP) colorsMigrated = true;
    tags[row.id as string] = rowToTag(row);
  }
  useStore.setState({ tags });
  lastTagsSnapshot = tagsSnapshot(tags);
  if (colorsMigrated) {
    lastTagsSnapshot = "";
    await pushUserTags();
  }
}

async function pushUserTags() {
  if (!supabase || !userId) return;
  for (const id of pendingTagDeletes) {
    await supabase.from("user_tags").delete().eq("id", id).eq("user_id", userId);
  }
  pendingTagDeletes.clear();

  const tags = useStore.getState().tags;
  const snapshot = tagsSnapshot(tags);
  if (snapshot === lastTagsSnapshot) return;
  const rows = Object.values(tags).map(tagToRow);
  if (rows.length) {
    const { error } = await supabase.from("user_tags").upsert(rows);
    if (error) {
      console.warn("[cloud] tags push failed:", error.message);
      return;
    }
  }
  lastTagsSnapshot = snapshot;
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
  const local = useStore.getState().myTagIdsByItem;
  const merged = { ...local, ...remote };
  useStore.setState({ myTagIdsByItem: merged });
  lastAssignmentsSnapshot = assignmentsSnapshot(merged);
}

async function pushTagAssignments() {
  if (!supabase || !userId) return;
  const map = useStore.getState().myTagIdsByItem;
  const snapshot = assignmentsSnapshot(map);
  if (snapshot === lastAssignmentsSnapshot) return;

  const rows = Object.entries(map)
    .filter(([, ids]) => ids.length > 0)
    .map(([itemId, tagIds]) => ({
      user_id: userId,
      item_id: itemId,
      tag_ids: tagIds,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length) {
    const { error } = await supabase.from("user_item_tag_assignments").upsert(rows, {
      onConflict: "user_id,item_id",
    });
    if (error) {
      console.warn("[cloud] tag assignments push failed:", error.message);
      return;
    }
  }
  lastAssignmentsSnapshot = snapshot;
  clearTagAssignmentsDirty();
}

function syncMyTagIdsFromOwnedItems(items: Record<string, Item>) {
  const prev = useStore.getState().myTagIdsByItem;
  let changed = false;
  const next = { ...prev };
  for (const item of Object.values(items)) {
    if (item.shareRole === "participant") continue;
    const ids = item.tagIds ?? [];
    if (JSON.stringify(prev[item.id] ?? []) !== JSON.stringify(ids)) {
      next[item.id] = ids;
      changed = true;
    }
  }
  if (changed) useStore.setState({ myTagIdsByItem: next });
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

function remapItemGroups(items: Record<string, Item>, remap: Map<string, string>): Record<string, Item> {
  if (!remap.size) return items;
  let changed = false;
  const next: Record<string, Item> = {};
  for (const [id, it] of Object.entries(items)) {
    const target = it.groupId ? remap.get(it.groupId) : undefined;
    if (target && target !== it.groupId) {
      next[id] = { ...it, groupId: target };
      changed = true;
    } else {
      next[id] = it;
    }
  }
  return changed ? next : items;
}

function clearGoogleGroupRefs(
  items: Record<string, Item>,
  googleIds: Set<string>,
): Record<string, Item> {
  if (!googleIds.size) return items;
  let changed = false;
  const next: Record<string, Item> = {};
  for (const [id, it] of Object.entries(items)) {
    if (it.groupId && googleIds.has(it.groupId)) {
      next[id] = { ...it, groupId: null };
      changed = true;
    } else {
      next[id] = it;
    }
  }
  return changed ? next : items;
}

async function pushGroupsFull() {
  if (!supabase || !userId || !groupsReady) return;
  const groups = stripGoogleGroups(useStore.getState().groups).filter((g) => !isShareGroup(g));
  const snap = groupsSnapshot(groups);
  const dels = [...pendingGroupDeletes];
  if (snap === lastGroupsSnapshot && dels.length === 0) return;
  lastGroupsSnapshot = snap;
  if (groups.length) {
    const { error } = await supabase.from("groups").upsert(groups.map(groupToRow));
    if (error) {
      console.warn("[cloud] group upsert failed:", error.message);
      lastGroupsSnapshot = "";
      return;
    }
  }
  if (dels.length) {
    pendingGroupDeletes.clear();
    await supabase.from("groups").delete().in("id", dels);
  }
}

async function pullGroups() {
  if (!supabase || !userId) return;
  const { data, error } = await supabase.from("groups").select("*");
  if (error) {
    console.warn("[cloud] group pull failed:", error.message);
    groupsReady = true;
    return;
  }
  const remote = (data ?? []).map(rowToGroup);
  const colorsMigrated = (data ?? []).some((row) => {
    const c = ((row.color as string) ?? "").toLowerCase();
    return c in LEGACY_GROUP_COLOR_MAP;
  });

  if (remote.length === 0) {
    // Pierwsze urządzenie: zasiej bazę lokalnymi grupami.
    groupsReady = true;
    lastGroupsSnapshot = "";
    await pushGroupsFull();
    return;
  }

  const { groups, remap, deleteIds } = reconcileGroups(remote);
  const googleIds = new Set(remote.filter(isGoogleGroup).map((g) => g.id));
  const ensured = ensureShareGroup(ensureArchiveGroup(groups));

  setApplyingRemote(true);
  try {
    useStore.setState((s) => ({
      groups: ensured,
      items: clearGoogleGroupRefs(remapItemGroups(s.items, remap), googleIds),
    }));
  } finally {
    setApplyingRemote(false);
  }

  groupsReady = true;
  lastGroupsSnapshot = groupsSnapshot(ensured);

  if (deleteIds.length) {
    await supabase.from("groups").delete().in("id", deleteIds);
  }
  // Dosyłka, gdy ensure dodał brakującą grupę systemową, remap lub migracja kolorów.
  if (ensured.length !== remote.length - deleteIds.length || remap.size || colorsMigrated) {
    lastGroupsSnapshot = "";
    await pushGroupsFull();
  }
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

async function syncItemParticipants(item: Item) {
  if (!supabase || !userId || item.shareRole === "participant" || item.deletedAt) return;
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
    if (error) console.warn("[cloud] participants sync failed:", error.message);
  }
}

async function pushParticipantPatches(items: Item[]): Promise<string[]> {
  if (!supabase || !userId) return [];
  const pushed: string[] = [];
  for (const item of items) {
    if (item.shareRole !== "participant") continue;
    let ok = true;
    const { error: contentError } = await updateSharedItemContent(item.id, {
      description: item.description,
      checklist: item.checklist,
      attachments: item.attachments,
    });
    if (contentError) {
      console.warn("[cloud] participant patch failed:", contentError);
      ok = false;
    }

    const { error: reminderError } = await updateOwnParticipationReminders(
      item.id,
      item.personalReminders ?? [],
    );
    if (reminderError) {
      console.warn("[cloud] personal reminders patch failed:", reminderError);
      ok = false;
    }

    if (ok) pushed.push(item.id);
  }
  return pushed;
}

async function pullAll(replace = false) {
  if (!supabase || !userId) return;
  const { rows, error } = await fetchAllItemRows();
  if (error) {
    console.warn("[cloud] item pull failed:", error);
    return;
  }
  const participantByItem = await pullOwnerParticipantRows();
  const owned: Record<string, Item> = {};
  for (const row of rows) {
    let item = rowToItem(row, "owner");
    const dbRows = participantByItem[item.id];
    if (dbRows?.length) {
      item = { ...item, participants: mergeParticipantsWithDb(item.participants, dbRows) };
    }
    owned[item.id] = item;
  }

  const shared = await pullSharedItems();
  const remoteItems = { ...owned, ...shared };

  // Wpisy, które mamy lokalnie, a których nie ma w chmurze, nigdy nie zostały
  // wysłane (usuwanie jest miękkie — tombstone zostaje wierszem). Pull nie może
  // ich skasować, a kolejka musi je odzyskać nawet gdy zgubiła je awaria.
  const localBefore = useStore.getState().items;
  const neverPushedIds = itemIdsMissingInCloud({
    localItems: localBefore,
    remoteItemIds: Object.keys(remoteItems),
  });

  setApplyingRemote(true);
  try {
    let next: Record<string, Item>;
    if (replace) {
      next = { ...remoteItems };
      for (const id of neverPushedIds) {
        const local = localBefore[id];
        if (local) next[id] = local;
      }
    } else {
      next = { ...localBefore };
      for (const [id, remote] of Object.entries(remoteItems)) {
        next[id] = mergeItemOnSync(localBefore[id], remote);
      }
    }
    useStore.setState({ items: next });
    syncMyTagIdsFromOwnedItems(next);
  } finally {
    setApplyingRemote(false);
  }

  if (neverPushedIds.length) {
    console.warn(
      `[cloud] ${neverPushedIds.length} wpis(ów) nie ma w chmurze — ponawiam wysyłkę`,
    );
    for (const id of neverPushedIds) enqueueItem(id);
    schedulePush();
  }
  syncState.lastPullAt = new Date().toISOString();
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

/**
 * Kanał potrafi umrzeć po uśpieniu laptopa i nigdy się nie podnieść — wtedy
 * urządzenie przestaje widzieć zmiany z innych urządzeń aż do przeładowania.
 */
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

/** Wywoływane po powrocie sieci / do zakładki — cisza w kanale bywa milcząca. */
function ensureRealtimeAlive() {
  if (!cloudEnabled || !supabase || !userId) return;
  if (realtimeSubscribed) return;
  teardownRealtime();
  setupRealtime();
}

function setupRealtime() {
  if (!supabase || !userId || realtimeChannel) return;
  realtimeChannel = supabase
    .channel(`items-sync-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (payload) => {
      setApplyingRemote(true);
      try {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id: string }).id;
          const next = { ...useStore.getState().items };
          delete next[id];
          useStore.setState({ items: next });
        } else {
          const row = payload.new as Record<string, unknown>;
          const ownerId = row.user_id as string;
          const role = ownerId === userId ? "owner" : "participant";
          const remote = rowToItem(row, role);
          const local = useStore.getState().items[remote.id];
          const merged = mergeItemOnSync(local, remote);
          useStore.setState((s) => ({ items: { ...s.items, [remote.id]: merged } }));
        }
      } finally {
        setApplyingRemote(false);
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, (payload) => {
      setApplyingRemote(true);
      try {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id: string }).id;
          useStore.setState((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
        } else {
          const group = rowToGroup(payload.new as Record<string, unknown>);
          useStore.setState((s) => ({
            groups: s.groups.some((g) => g.id === group.id)
              ? s.groups.map((g) => (g.id === group.id ? group : g))
              : [...s.groups, group],
          }));
        }
        lastGroupsSnapshot = groupsSnapshot(useStore.getState().groups);
      } finally {
        setApplyingRemote(false);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        realtimeSubscribed = true;
        realtimeFailureStreak = 0;
        // Po *ponownym* podłączeniu dociągnij, co uciekło w czasie ciszy.
        // Pierwsze podłączenie następuje tuż po pullu z bootstrapu.
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

/** Czy bezpieczny auto-pull może się wykonać (bez side effects). */
export function canAutoCloudRefresh(): boolean {
  if (!cloudEnabled || !supabase || !userId) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;

  const diag = getSyncDiagnostics();
  if (!diag.syncReady || diag.syncBooting || diag.applyingRemote || diag.pushBlocked) {
    return false;
  }
  // Niewysłane zmiany celowo NIE blokują auto-pulla: auto-pull scala po
  // `updated_at` i niczego lokalnie nie kasuje. Wcześniejsza blokada oznaczała,
  // że jeden wpis, którego nie dało się wypchnąć, wyłączał pobieranie na stałe.
  if (autoPullInProgress) return false;
  if (useStore.getState().draft) return false;
  if (isUserActivelyEditing()) return false;

  const sincePull = msSinceLastPull();
  if (sincePull !== null && sincePull < AUTO_PULL_MIN_INTERVAL_MS) return false;

  return true;
}

/**
 * Scalający pull — nigdy nie kasuje lokalnych wpisów, więc jest bezpieczny
 * także wtedy, gdy coś czeka jeszcze w kolejce wysyłki.
 */
async function cloudMergeRefresh(): Promise<boolean> {
  if (!cloudEnabled || !supabase || !userId) return false;
  if (syncState.booting || syncState.applyingRemote) return false;
  try {
    await pullGroups();
    await pullAll(false);
    return true;
  } catch (err) {
    console.warn("[cloud] merge refresh failed:", err);
    return false;
  }
}

/** Bezpieczny auto-pull: najpierw dosyła zaległości, potem scala z chmurą. */
export async function tryAutoCloudRefresh(): Promise<boolean> {
  if (!canAutoCloudRefresh()) return false;

  autoPullInProgress = true;
  try {
    await flushPendingPush();
    const ok = await cloudMergeRefresh();
    if (ok) lastAutoPullAt = new Date().toISOString();
    // Pull mógł dopiero co wykryć never-pushed — wyślij zanim zniknie szansa.
    if (hasPendingPush()) await flushPendingPush();
    // Lekki skan ID — łapie wpisy pominięte przez subscribe w trakcie bootu.
    await reconcileNeverPushed({ flush: true });
    return ok;
  } finally {
    autoPullInProgress = false;
  }
}

/** Pełny pull z chmury — zastępuje lokalny cache itemów (Sync v2). */
export async function forceCloudRefresh(): Promise<{ ok: boolean; message: string }> {
  if (!cloudEnabled || !supabase || !userId) {
    return { ok: false, message: "Synchronizacja niedostępna" };
  }

  // Najpierw dosyłka: pull z podmianą nie może wyprzedzić zmian, które jeszcze
  // nie dotarły do chmury (to była prosta droga do cichej utraty wydarzenia).
  await flushPendingPush();

  syncState.pushBlocked = true;
  syncState.booting = true;
  try {
    await pullUserTags();
    await pullTagAssignments();
    await pullGroups();
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

    return { ok: true, message: "Dane odświeżone" };
  } catch (err) {
    console.warn("[cloud] force refresh failed:", err);
    return { ok: false, message: "Odświeżanie nie powiodło się" };
  } finally {
    syncState.booting = false;
    syncState.pushBlocked = false;
    syncState.ready = true;
    // Pull mógł wykryć wpisy nieobecne w chmurze — wyślij je od razu.
    void flushPendingPush();
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
    // Najpierw zmiana klucza IDB — inaczej resetLocalUserState() zapisuje pusty
    // `items` pod kluczem zalogowanego użytkownika i kasuje wpisy, które nigdy
    // nie zdążyły wyjść do chmury (telefon widzi je, PC już nigdy).
    await switchPersistUser(null);
    resetLocalUserState();
    previousUserId = null;
    groupsReady = false;
    lastGroupsSnapshot = "";
    pendingGroupDeletes.clear();
    resetSyncState();
    syncState.ready = true;
    return;
  }

  const isUserSwitch = previousUserId !== null && previousUserId !== nextUserId;
  previousUserId = nextUserId;

  syncState.booting = true;
  syncState.ready = false;

  groupsReady = false;
  lastGroupsSnapshot = "";
  pendingGroupDeletes.clear();

  await switchPersistUser(nextUserId);
  // Kolejka przeżywa restart — inaczej zmiany zrobione tuż przed zamknięciem
  // aplikacji zostawały tylko w lokalnym cache'u i nie trafiały na inne urządzenia.
  const restored = await restoreOutboxForUser(nextUserId);
  if (restored) console.info(`[cloud] odtworzono kolejkę wysyłki: ${restored}`);

  const { data: sessionData } = await supabase.auth.getUser();
  userEmail = sessionData.user?.email?.toLowerCase() ?? null;
  useStore.getState().setAuthUser(nextUserId, userEmail);

  // Przy zmianie konta czyścimy tylko UI — NIE kasujemy items przed pullem.
  // Wcześniejszy resetLocalUserState() zapisywał pusty store do IDB i niszczył
  // never-pushed zanim pullAll(replace) zdążył je zachować / wysłać.
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
    // Accept pending org invites before loading membership / contacts.
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

    // Grupy najpierw — items.group_id ma klucz obcy do groups(id).
    await pullUserTags();
    await pullTagAssignments();
    await pullGroups();
    await pullAll(isUserSwitch);

    pendingGroupDeletes.clear();

    teardownRealtime();
    setupRealtime();
  } finally {
    syncState.booting = false;
    syncState.ready = true;
  }

  // Dopiero teraz wolno wysyłać: kolejka jest odtworzona, a pull dołożył wpisy,
  // których zabrakło w chmurze.
  void flushPendingPush().then(() => reconcileNeverPushed({ flush: true }));
}

async function pushDirtyItems() {
  if (!supabase || !userId) return;

  const dirtyIds = [...syncState.dirtyItemIds];
  const watchedId = getWatchedItemId();
  const corr = getActiveSyncDebugCorrelation() ?? beginSyncDebugCorrelation();

  if (isSyncDebugEnabled()) {
    syncDebugTrace({
      correlationId: corr,
      itemId: watchedId,
      stage: "PENDING_IDS_CAPTURED",
      result: `dirtyItemIds=${dirtyIds.length}`,
      snapshot: {
        dirtyIdsSample: dirtyIds.slice(0, 40),
        watchedId,
        watchedInDirty: watchedId ? dirtyIds.includes(watchedId) : null,
      },
    });
    if (watchedId) {
      if (dirtyIds.includes(watchedId)) {
        syncDebugTrace({
          correlationId: corr,
          itemId: watchedId,
          stage: "TARGET_ID_PRESENT",
          result: "present_in_dirtyItemIds",
        });
      } else {
        syncDebugTrace({
          correlationId: corr,
          itemId: watchedId,
          stage: "TARGET_ID_ABSENT",
          result: "absent_from_dirtyItemIds",
          skipReason: "not_in_dirty",
        });
      }
    }
  }

  if (!dirtyIds.length) return;

  const state = useStore.getState();
  const ownedItems = dirtyIds
    .map((id) => state.items[id])
    .filter((i): i is Item => Boolean(i) && i.shareRole !== "participant");

  if (watchedId && isSyncDebugEnabled()) {
    const raw = state.items[watchedId];
    if (!raw) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "ITEM_MISSING_IN_STORE",
        result: "missing_from_store",
        skipReason: "missing_from_store",
      });
    } else if (raw.shareRole === "participant") {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "TARGET_EXCLUDED_FROM_BATCH",
        result: "participant_item",
        skipReason: "participant_item",
        snapshot: {
          title: raw.title,
          type: raw.type,
          shareRole: raw.shareRole,
        },
      });
    } else {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "ITEM_FOUND_IN_STORE",
        result: "found",
        snapshot: {
          title: raw.title,
          type: raw.type,
          coercedType: coerceItemType(raw),
          groupId: raw.groupId,
          shareRole: raw.shareRole ?? null,
          deletedAt: raw.deletedAt ?? null,
          updatedAt: raw.updatedAt,
        },
      });
    }
  }

  const missingIds = dirtyIds.filter((id) => !state.items[id]);
  if (missingIds.length) clearDirtyItems(missingIds);

  if (!ownedItems.length) return;

  const pushedIds: string[] = [];
  const ids = ownedItems.map((i) => i.id);
  const payloadExtrasById = new Map<string, Record<string, unknown>>();
  const { data: existingRows } = await supabase
    .from("items")
    .select("id, payload")
    .in("id", ids);
  for (const row of existingRows ?? []) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const extras: Record<string, unknown> = {};
    if (payload.googleReminderEventIds) {
      extras.googleReminderEventIds = payload.googleReminderEventIds;
    }
    if (payload.syncSource) extras.syncSource = payload.syncSource;
    if (payload.googleRecurrence) extras.googleRecurrence = payload.googleRecurrence;
    if (payload.googleRecurringSeriesId) {
      extras.googleRecurringSeriesId = payload.googleRecurringSeriesId;
    }
    if (payload.googleRecurrenceExceptions) {
      extras.googleRecurrenceExceptions = payload.googleRecurrenceExceptions;
    }
    if (payload.googleCalendarEventId) {
      extras.googleCalendarEventId = payload.googleCalendarEventId;
    }
    if (Object.keys(extras).length) payloadExtrasById.set(row.id as string, extras);
  }

  const localGroupIds = new Set(useStore.getState().groups.map((g) => g.id));

  // Sanityzacja przed upsertem: jeden legacy wpis z type=null potrafił wywalić
  // całą paczkę (NOT NULL) i zatrzymać kolejkę 100+ zmian na stałe.
  const prepared: { item: Item; row: ReturnType<typeof itemToRow> }[] = [];
  const skippedIds: string[] = [];
  for (const raw of ownedItems) {
    const { item } = sanitizeItemDates(raw);
    if (item !== raw) {
      useStore.setState((s) =>
        s.items[item.id] ? { items: { ...s.items, [item.id]: item } } : {},
      );
    }
    if (item.type !== "event" && item.type !== "task") {
      skippedIds.push(item.id);
      if (isWatchedItem(item.id)) {
        syncDebugTrace({
          correlationId: corr,
          itemId: item.id,
          stage: "TARGET_EXCLUDED_FROM_BATCH",
          result: "invalid_payload_type",
          skipReason: "invalid_payload",
          snapshot: { type: item.type, title: item.title },
        });
      }
      continue;
    }
    if (isWatchedItem(item.id)) {
      syncDebugTrace({
        correlationId: corr,
        itemId: item.id,
        stage: "ITEM_TO_ROW_INPUT",
        result: "ok",
        snapshot: {
          title: item.title,
          type: item.type,
          groupId: item.groupId,
          start: item.start,
          end: item.end,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt ?? null,
        },
      });
    }
    const row = itemToRow(item, payloadExtrasById.get(item.id));
    if (row.group_id && !localGroupIds.has(row.group_id as string)) row.group_id = null;
    if (isWatchedItem(item.id)) {
      syncDebugTrace({
        correlationId: corr,
        itemId: item.id,
        stage: "ITEM_TO_ROW_OUTPUT",
        result: "ok",
        snapshot: {
          id: row.id,
          user_id: row.user_id,
          type: row.type,
          title: row.title,
          group_id: row.group_id,
          start_at: row.start_at,
          end_at: row.end_at,
          deleted_at: row.deleted_at,
          updated_at: row.updated_at,
        },
      });
    }
    prepared.push({ item, row });
  }
  if (skippedIds.length) {
    console.warn(`[cloud] pominięto ${skippedIds.length} wpis(ów) nie nadających się do upsertu`);
    clearDirtyItems(skippedIds);
  }

  if (watchedId && isSyncDebugEnabled()) {
    const included = prepared.some((p) => p.item.id === watchedId);
    syncDebugTrace({
      correlationId: corr,
      itemId: watchedId,
      stage: included ? "TARGET_INCLUDED_IN_BATCH" : "TARGET_EXCLUDED_FROM_BATCH",
      result: included ? "included" : "excluded",
      skipReason: included
        ? undefined
        : dirtyIds.includes(watchedId)
          ? skippedIds.includes(watchedId)
            ? "invalid_payload"
            : "unknown"
          : "not_in_dirty",
      snapshot: {
        preparedCount: prepared.length,
        skippedIdsSample: skippedIds.slice(0, 20),
      },
    });
  }

  const rows = prepared.map((p) => p.row);

  // Paczkami; przy błędzie — per wiersz, żeby jeden trucizna nie blokowała reszty.
  for (const rowChunk of chunkIds(rows, ITEM_UPSERT_CHUNK_SIZE)) {
    const chunkHasWatch = watchedId
      ? rowChunk.some((r) => r.id === watchedId)
      : false;
    if (chunkHasWatch) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "SUPABASE_UPSERT_STARTED",
        result: `chunk_size=${rowChunk.length}`,
        snapshot: {
          mode: "chunk",
          chunkIds: rowChunk.map((r) => r.id),
        },
      });
    }
    const { error } = await supabase.from("items").upsert(rowChunk);
    if (!error) {
      for (const row of rowChunk) pushedIds.push(row.id as string);
      if (chunkHasWatch) {
        syncDebugTrace({
          correlationId: corr,
          itemId: watchedId,
          stage: "SUPABASE_UPSERT_RESULT",
          result: "chunk_ok",
          snapshot: { mode: "chunk", chunkSize: rowChunk.length },
        });
      }
      continue;
    }
    console.warn("[cloud] item upsert chunk failed:", error.message);
    syncState.lastPushError = error.message;
    if (isSyncDebugEnabled() && (chunkHasWatch || watchedId)) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "SUPABASE_UPSERT_RESULT",
        result: "chunk_failed",
        snapshot: {
          mode: "chunk",
          message: error.message,
          code: (error as { code?: string }).code ?? null,
          details: (error as { details?: string }).details ?? null,
          chunkIds: rowChunk.map((r) => r.id),
          watchInChunk: chunkHasWatch,
        },
      });
    }
    for (const row of rowChunk) {
      if (isWatchedItem(row.id as string)) {
        syncDebugTrace({
          correlationId: corr,
          itemId: row.id as string,
          stage: "SUPABASE_UPSERT_STARTED",
          result: "per_row_fallback",
          snapshot: {
            mode: "row",
            type: row.type,
            user_id: row.user_id,
            title: row.title,
          },
        });
      }
      const { error: rowError } = await supabase.from("items").upsert(row);
      if (rowError) {
        console.warn(`[cloud] item upsert ${row.id}:`, rowError.message);
        syncState.lastPushError = rowError.message;
        if (isWatchedItem(row.id as string) || (isSyncDebugEnabled() && rowError.message)) {
          syncDebugTrace({
            correlationId: corr,
            itemId: row.id as string,
            stage: "SUPABASE_UPSERT_RESULT",
            result: "row_failed",
            snapshot: {
              mode: "row",
              message: rowError.message,
              code: (rowError as { code?: string }).code ?? null,
              details: (rowError as { details?: string }).details ?? null,
              title: row.title,
              type: row.type,
              user_id: row.user_id,
            },
          });
        }
        continue;
      }
      pushedIds.push(row.id as string);
      if (isWatchedItem(row.id as string)) {
        syncDebugTrace({
          correlationId: corr,
          itemId: row.id as string,
          stage: "SUPABASE_UPSERT_RESULT",
          result: "row_ok",
          snapshot: { mode: "row" },
        });
      }
    }
  }

  const pushedSet = new Set(pushedIds);
  for (const { item } of prepared) {
    if (!pushedSet.has(item.id)) continue;
    await syncItemParticipants(item);
  }

  if (watchedId && isSyncDebugEnabled()) {
    if (pushedSet.has(watchedId)) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "DIRTY_CLEARED",
        result: "cleared",
      });
    } else if (dirtyIds.includes(watchedId)) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "DIRTY_RETAINED",
        result: "retained_in_dirty",
        snapshot: { lastPushError: syncState.lastPushError },
      });
    }
  }

  clearDirtyItems(pushedIds);

  if (isSyncDebugEnabled()) {
    // Tylko odczyt — clearDirtyItems i tak schedule'uje persist; tu nie zapisujemy.
    const authId = useStore.getState().authUserId;
    const persisted = await loadOutbox(authId);
    syncDebugTrace({
      correlationId: corr,
      itemId: watchedId,
      stage: "OUTBOX_PERSISTED_AFTER_ATTEMPT",
      result: "observed",
      snapshot: {
        dirtyRemainingRam: syncState.dirtyItemIds.size,
        watchStillDirtyRam: watchedId ? syncState.dirtyItemIds.has(watchedId) : null,
        watchInPersistedOutbox: watchedId
          ? persisted.itemIds.includes(watchedId) ||
            persisted.participantIds.includes(watchedId)
          : null,
        lastPushError: syncState.lastPushError,
      },
    });
  }
}

async function pushDirtyParticipants() {
  if (!supabase || !userId) return;

  const dirtyIds = [...syncState.dirtyParticipantIds];
  if (!dirtyIds.length) return;

  const state = useStore.getState();
  const items = dirtyIds
    .map((id) => state.items[id])
    .filter((i): i is Item => Boolean(i) && i.shareRole === "participant");

  const missingIds = dirtyIds.filter((id) => !state.items[id]);
  if (missingIds.length) clearDirtyParticipants(missingIds);

  if (!items.length) return;

  const pushed = await pushParticipantPatches(items);
  clearDirtyParticipants(pushed);
}

const PUSH_DEBOUNCE_MS = 800;
const PUSH_RETRY_BASE_MS = 5_000;
const PUSH_RETRY_MAX_MS = 5 * 60_000;

/**
 * Jedno przejście kolejki. Zwraca `true`, gdy nic nie zostało do wysłania.
 * Nieudany push zostaje w kolejce (trwałej) i jest ponawiany z backoffem —
 * wcześniej pojedynczy błąd sieci oznaczał, że wpis nie trafiał do chmury już
 * nigdy, bo nic nie planowało kolejnej próby.
 */
async function runPush(): Promise<boolean> {
  const corr = isSyncDebugEnabled()
    ? (getActiveSyncDebugCorrelation() ?? beginSyncDebugCorrelation())
    : null;
  const watchedId = getWatchedItemId();

  if (!shouldSchedulePush() || !supabase || !userId) {
    if (corr) {
      const reason = !supabase
        ? "no_supabase"
        : !userId
          ? "no_auth_user"
          : syncState.pushBlocked
            ? "push_blocked"
            : syncState.booting
              ? "booting"
              : syncState.applyingRemote
                ? "applying_remote"
                : !syncState.ready
                  ? "sync_not_ready"
                  : "unknown";
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "RUN_PUSH_EARLY_RETURN",
        result: reason,
        skipReason: reason,
        snapshot: {
          ready: syncState.ready,
          booting: syncState.booting,
          applyingRemote: syncState.applyingRemote,
          pushBlocked: syncState.pushBlocked,
          hasUserId: Boolean(userId),
          hasSupabase: Boolean(supabase),
        },
      });
    }
    return false;
  }
  if (pushInFlight) {
    if (corr) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "RUN_PUSH_EARLY_RETURN",
        result: "in_flight_early_return",
        skipReason: "in_flight_early_return",
      });
    }
    return false;
  }

  pushInFlight = true;
  try {
    await pushGroupsFull();
    await pushUserTags();
    await pushDirtyItems();
    await pushDirtyParticipants();
    await pushTagAssignments();
    syncState.lastPushAt = new Date().toISOString();
  } finally {
    pushInFlight = false;
  }

  if (hasPendingPush()) {
    pushFailureStreak += 1;
    schedulePushRetry();
    if (corr) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "SEND_ATTEMPT_FINISHED",
        result: "pending_remains",
        snapshot: {
          dirtyItems: syncState.dirtyItemIds.size,
          dirtyParticipants: syncState.dirtyParticipantIds.size,
          tagAssignmentsDirty: syncState.tagAssignmentsDirty,
          lastPushError: syncState.lastPushError,
          watchStillDirty: watchedId ? syncState.dirtyItemIds.has(watchedId) : null,
        },
      });
    }
    return false;
  }
  pushFailureStreak = 0;
  syncState.lastPushError = null;
  if (corr) {
    syncDebugTrace({
      correlationId: corr,
      itemId: watchedId,
      stage: "SEND_ATTEMPT_FINISHED",
      result: "queue_empty",
      snapshot: { lastPushAt: syncState.lastPushAt },
    });
  }
  return true;
}

function schedulePushRetry() {
  if (pushRetryTimer) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const delay = Math.min(
    PUSH_RETRY_BASE_MS * 2 ** Math.min(pushFailureStreak - 1, 6),
    PUSH_RETRY_MAX_MS,
  );
  pushRetryTimer = setTimeout(() => {
    pushRetryTimer = null;
    void runPush();
  }, delay);
}

function schedulePush() {
  if (!shouldSchedulePush() || !supabase || !userId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void runPush();
  }, PUSH_DEBOUNCE_MS);
}

/** Natychmiastowa wysyłka z pominięciem debounce'u (powrót do apki, online, refresh). */
export async function flushPendingPush(): Promise<boolean> {
  const corr = isSyncDebugEnabled()
    ? (getActiveSyncDebugCorrelation() ?? beginSyncDebugCorrelation())
    : null;
  const watchedId = getWatchedItemId();
  if (corr) {
    syncDebugTrace({
      correlationId: corr,
      itemId: watchedId,
      stage: "FLUSH_ENTERED",
      result: "entered",
      snapshot: {
        dirtyItems: syncState.dirtyItemIds.size,
        dirtyParticipants: syncState.dirtyParticipantIds.size,
        tagAssignmentsDirty: syncState.tagAssignmentsDirty,
        navigatorOnline: typeof navigator !== "undefined" ? navigator.onLine : null,
        pushInFlight,
      },
    });
  }

  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (pushRetryTimer) {
    clearTimeout(pushRetryTimer);
    pushRetryTimer = null;
  }
  if (!hasPendingPush()) {
    if (corr) {
      syncDebugTrace({
        correlationId: corr,
        itemId: watchedId,
        stage: "SEND_ATTEMPT_FINISHED",
        result: "empty_pending",
        skipReason: "empty_pending",
      });
    }
    return true;
  }
  const ok = await runPush();
  // `runPush` odmawia pracy w trakcie bootu / blokady pulla. Bez tego kolejka
  // czekałaby wtedy na przypadkową kolejną zmianę w store.
  if (!ok && hasPendingPush() && !pushRetryTimer) {
    pushFailureStreak += 1;
    schedulePushRetry();
  }
  return ok;
}

/**
 * Zdarzenia cyklu życia strony. Na telefonie PWA znika w tle bez ostrzeżenia,
 * więc `pagehide` / `hidden` to ostatni moment, żeby utrwalić kolejkę.
 */
function bindSyncLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;

  window.addEventListener("online", () => {
    pushFailureStreak = 0;
    realtimeFailureStreak = 0;
    void flushPendingPush();
    ensureRealtimeAlive();
  });

  window.addEventListener("pagehide", () => {
    void persistOutboxNow();
    void flushPendingPush();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Mobile PWA często dostaje tylko `hidden`, bez wiarygodnego pagehide —
      // to ostatnia szansa, żeby kolejka i push nie zostały w RAM.
      void persistOutboxNow();
      void flushPendingPush();
      return;
    }
    void flushPendingPush();
    ensureRealtimeAlive();
    void reconcileNeverPushed({ flush: true });
  });

  if (!orphanScanTimer) {
    orphanScanTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void reconcileNeverPushed({ flush: true });
    }, ORPHAN_SCAN_INTERVAL_MS);
  }
}

function trackGroupChange(prev: Group[], next: Group[]) {
  if (syncState.applyingRemote || prev === next) return;
  const nextIds = new Set(next.map((g) => g.id));
  for (const g of prev) {
    if (!nextIds.has(g.id)) pendingGroupDeletes.add(g.id);
  }
}

function trackTagChange(prev: Record<string, UserTag>, next: Record<string, UserTag>) {
  if (syncState.applyingRemote || prev === next) return;
  for (const id of Object.keys(prev)) {
    if (!next[id]) pendingTagDeletes.add(id);
  }
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
      getPushInFlight: () => pushInFlight,
      getCloudModuleUserId: () => userId,
      previewItemRow: (item) => itemToRow(item) as Record<string, unknown>,
    });
    installSyncDebugApi();

    // Zapis z UI (także w trakcie bootu) zawsze trafia do trwałej kolejki —
    // wcześniej subscribe gubił commitDraft, gdy booting/applyingRemote=true.
    registerLocalItemWriteHandler((itemId) => {
      enqueueItem(itemId);
      void persistOutboxNow();
      if (shouldSchedulePush()) schedulePush();
    });

    const { data } = await supabase.auth.getUser();
    await handleAuthUserChange(data.user?.id ?? null);

    supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthUserChange(session?.user?.id ?? null);
    });

    if (!storeSubscribed) {
      storeSubscribed = true;
      useStore.subscribe((state, prev) => {
        trackGroupChange(prev.groups, state.groups);
        trackTagChange(prev.tags, state.tags);
        trackStoreDirty(prev, state);
        schedulePush();
      });
    }
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
