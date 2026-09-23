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
  clearDirtyParticipants,
  getSyncDiagnostics,
  resetSyncState,
  restoreOutboxForUser,
  syncState,
} from "@/lib/syncState";
import { bootstrapSyncV3, hydrateZustandFromV3 } from "@/lib/syncv3/bootstrap";
import {
  applyRemoteGroupsToStore,
  applyRemoteItemsToStore,
  applyRemoteTagAssignmentsToStore,
  applyRemoteTagsToStore,
  applyRemoteResultToZustand,
} from "@/lib/syncv3/cloudRemoteBridge";
import { applyRemoteEntities } from "@/lib/syncv3/remoteApply";
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

/**
 * v2 orphan scan / reconcileNeverPushed â€” USUNIÄTE z runtime.
 * Local-only recovery = Sync v3 migration + worker operations.
 */
async function reconcileNeverPushed(_opts?: { flush?: boolean }): Promise<number> {
  return 0;
}
void reconcileNeverPushed;

let userId: string | null = null;
let userEmail: string | null = null;
let previousUserId: string | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let storeSubscribed = false;
let realtimeSubscribed = false;
let realtimeEverSubscribed = false;
let realtimeFailureStreak = 0;
let realtimeResubscribeTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let lifecycleBound = false;

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

export function getCloudDomainSnapshots() {
  return { lastTagsSnapshot, lastAssignmentsSnapshot };
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

async function pushUserTags() {
  // Push tagĂłw: wyĹ‚Ä…cznie Sync v3 worker (persistTagViaSyncV3).
  return;
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

async function pushTagAssignments() {
  // Push assignments: Sync v3 worker.
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
 * Sprowadza listÄ™ zdalnych grup do jednej grupy systemowej kaĹĽdego typu.
 * Zwraca teĹĽ mapÄ™ remap (stare id duplikatu â†’ id zachowane) oraz id do usuniÄ™cia.
 */
function reconcileGroups(remote: Group[]): {
  groups: Group[];
  remap: Map<string, string>;
  deleteIds: string[];
} {
  const remap = new Map<string, string>();
  const deleteIds: string[] = [];
  let archiveKept: Group | null = null;
  // SHARE jest tylko wirtualny w aplikacji â€” usuĹ„ z bazy, jeĹ›li kiedyĹ› trafiĹ‚.
  // Deduplikacja grup uĹĽytkownika po nazwie â€” naprawia duplikaty powstaĹ‚e, gdy
  // dwa urzÄ…dzenia zasiaĹ‚y tabelÄ™ zanim siÄ™ nawzajem zobaczyĹ‚y.
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
      // Legacy â€” integracja Google usuniÄ™ta.
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

  if (remote.length === 0) {
    groupsReady = true;
    lastGroupsSnapshot = groupsSnapshot(useStore.getState().groups);
    return;
  }

  const { groups, remap, deleteIds } = reconcileGroups(remote);
  const googleIds = new Set(remote.filter(isGoogleGroup).map((g) => g.id));
  const ensured = ensureShareGroup(ensureArchiveGroup(groups));

  setApplyingRemote(true);
  try {
    const result = await applyRemoteGroupsToStore(userId, ensured);
    if (!result.ok) return;
    // Remap google refs lokalnie po IDB apply (items juĹĽ w store)
    if (remap.size || googleIds.size) {
      useStore.setState((s) => ({
        items: clearGoogleGroupRefs(remapItemGroups(s.items, remap), googleIds),
      }));
    }
    lastGroupsSnapshot = groupsSnapshot(useStore.getState().groups);
  } finally {
    setApplyingRemote(false);
  }

  groupsReady = true;

  if (deleteIds.length) {
    await supabase.from("groups").delete().in("id", deleteIds);
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

async function pullAllViaSyncV3() {
  if (!supabase || !userId) return;
  const { rows, error } = await fetchAllItemRows();
  if (error) {
    console.warn("[cloud] item pull failed:", error);
    return;
  }
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
    const result = await applyRemoteItemsToStore(userId, items);
    if (!result.ok) {
      console.warn("[cloud] remote apply failed:", result.error);
      return; // cursor / lastPullAt nie przesuwamy
    }
    await hydrateZustandFromV3(userId);
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

/**
 * KanaĹ‚ potrafi umrzeÄ‡ po uĹ›pieniu laptopa i nigdy siÄ™ nie podnieĹ›Ä‡ â€” wtedy
 * urzÄ…dzenie przestaje widzieÄ‡ zmiany z innych urzÄ…dzeĹ„ aĹĽ do przeĹ‚adowania.
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

/** WywoĹ‚ywane po powrocie sieci / do zakĹ‚adki â€” cisza w kanale bywa milczÄ…ca. */
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
            const result = await applyRemoteEntities({
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
            if (!result.ok) return;
          } else {
            const row = payload.new as Record<string, unknown>;
            const ownerId = row.user_id as string;
            const role = ownerId === uid ? "owner" : "participant";
            const remote = rowToItem(row, role);
            const result = await applyRemoteItemsToStore(uid, [remote]);
            if (!result.ok) return;
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
            const result = await applyRemoteEntities({
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
                useStore.setState((s) => ({
                  groups: s.groups.filter((g) => g.id !== id),
                }));
              },
            });
            if (!result.ok) return;
          } else {
            const group = rowToGroup(payload.new as Record<string, unknown>);
            await applyRemoteGroupsToStore(uid, [group]);
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

/** Czy bezpieczny auto-pull moĹĽe siÄ™ wykonaÄ‡ (bez side effects). */
export function canAutoCloudRefresh(): boolean {
  if (!cloudEnabled || !supabase || !userId) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;

  const diag = getSyncDiagnostics();
  if (!diag.syncReady || diag.syncBooting || diag.applyingRemote || diag.pushBlocked) {
    return false;
  }
  // NiewysĹ‚ane zmiany celowo NIE blokujÄ… auto-pulla: auto-pull scala po
  // `updated_at` i niczego lokalnie nie kasuje. WczeĹ›niejsza blokada oznaczaĹ‚a,
  // ĹĽe jeden wpis, ktĂłrego nie daĹ‚o siÄ™ wypchnÄ…Ä‡, wyĹ‚Ä…czaĹ‚ pobieranie na staĹ‚e.
  if (autoPullInProgress) return false;
  if (useStore.getState().draft) return false;
  if (isUserActivelyEditing()) return false;

  const sincePull = msSinceLastPull();
  if (sincePull !== null && sincePull < AUTO_PULL_MIN_INTERVAL_MS) return false;

  return true;
}

/**
 * ScalajÄ…cy pull â€” nigdy nie kasuje lokalnych wpisĂłw, wiÄ™c jest bezpieczny
 * takĹĽe wtedy, gdy coĹ› czeka jeszcze w kolejce wysyĹ‚ki.
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

/** Bezpieczny auto-pull: najpierw dosyĹ‚a zalegĹ‚oĹ›ci, potem scala z chmurÄ…. */
export async function tryAutoCloudRefresh(): Promise<boolean> {
  if (!canAutoCloudRefresh()) return false;

  autoPullInProgress = true;
  try {
    await flushPendingPush();
    const ok = await cloudMergeRefresh();
    if (ok) lastAutoPullAt = new Date().toISOString();
    return ok;
  } finally {
    autoPullInProgress = false;
  }
}

/** PeĹ‚ny pull z chmury â€” zastÄ™puje lokalny cache itemĂłw (Sync v2). */
export async function forceCloudRefresh(): Promise<{ ok: boolean; message: string }> {
  if (!cloudEnabled || !supabase || !userId) {
    return { ok: false, message: "Synchronizacja niedostÄ™pna" };
  }

  // Najpierw dosyĹ‚ka: pull z podmianÄ… nie moĹĽe wyprzedziÄ‡ zmian, ktĂłre jeszcze
  // nie dotarĹ‚y do chmury (to byĹ‚a prosta droga do cichej utraty wydarzenia).
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

    return { ok: true, message: "Dane odĹ›wieĹĽone" };
  } catch (err) {
    console.warn("[cloud] force refresh failed:", err);
    return { ok: false, message: "OdĹ›wieĹĽanie nie powiodĹ‚o siÄ™" };
  } finally {
    syncState.booting = false;
    syncState.pushBlocked = false;
    syncState.ready = true;
    // Pull mĂłgĹ‚ wykryÄ‡ wpisy nieobecne w chmurze â€” wyĹ›lij je od razu.
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
    // Najpierw zmiana klucza IDB â€” inaczej resetLocalUserState() zapisuje pusty
    // `items` pod kluczem zalogowanego uĹĽytkownika i kasuje wpisy, ktĂłre nigdy
    // nie zdÄ…ĹĽyĹ‚y wyjĹ›Ä‡ do chmury (telefon widzi je, PC juĹĽ nigdy).
    await switchPersistUser(null);
    resetLocalUserState();
    previousUserId = null;
    groupsReady = false;
    lastGroupsSnapshot = "";
    pendingGroupDeletes.clear();
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
  pendingGroupDeletes.clear();

  await switchPersistUser(nextUserId);
  // Kolejka przeĹĽywa restart â€” inaczej zmiany zrobione tuĹĽ przed zamkniÄ™ciem
  // aplikacji zostawaĹ‚y tylko w lokalnym cache'u i nie trafiaĹ‚y na inne urzÄ…dzenia.
  const restored = await restoreOutboxForUser(nextUserId);
  if (restored) console.info(`[cloud] odtworzono kolejkÄ™ wysyĹ‚ki: ${restored}`);

  const { data: sessionData } = await supabase.auth.getUser();
  userEmail = sessionData.user?.email?.toLowerCase() ?? null;
  useStore.getState().setAuthUser(nextUserId, userEmail);

  // Przy zmianie konta czyĹ›cimy tylko UI â€” NIE kasujemy items przed pullem.
  // WczeĹ›niejszy resetLocalUserState() zapisywaĹ‚ pusty store do IDB i niszczyĹ‚
  // never-pushed zanim pullAll(replace) zdÄ…ĹĽyĹ‚ je zachowaÄ‡ / wysĹ‚aÄ‡.
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

    // Sync v3: migracja â†’ flags â†’ hydrate â†’ pull IDB-first â†’ realtime
    await bootstrapSyncV3(nextUserId);
    await pullUserTags();
    await pullTagAssignments();
    await pullGroups();
    await pullAll(false);

    teardownRealtime();
    setupRealtime();
  } finally {
    syncState.booting = false;
    syncState.ready = true;
  }
}

async function pushDirtyItems() {
  // v2 item push removed — Sync v3 worker only.
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

async function runPush(): Promise<boolean> {
  if (!supabase || !userId) return true;
  if (syncState.booting || syncState.pushBlocked) return false;
  if (pushInFlight) return false;
  pushInFlight = true;
  try {
    const { wakeSyncV3Worker } = await import("@/lib/syncv3/bootstrap");
    wakeSyncV3Worker();
    await pushDirtyParticipants();
    syncState.lastPushAt = new Date().toISOString();
  } finally {
    pushInFlight = false;
  }
  syncState.v2PushFailureMsg = null;
  return true;
}

function schedulePushRetry() {
  // v2 item retry removed
}

function schedulePush() {
  void import("@/lib/syncv3/bootstrap").then((m) => m.wakeSyncV3Worker());
}

// Retain schedulePush for online wake path callers.
void schedulePush;


/** Internal wake — no manual flush UI. */
export async function flushPendingPush(): Promise<boolean> {
  const { wakeSyncV3Worker } = await import("@/lib/syncv3/bootstrap");
  wakeSyncV3Worker();
  return runPush();
}

/** Lifecycle: realtime + v3 worker wake. No v2 orphan/push timers. */
function bindSyncLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;

  window.addEventListener("online", () => {
    realtimeFailureStreak = 0;
    void import("@/lib/syncv3/bootstrap").then((m) => m.wakeSyncV3Worker());
    ensureRealtimeAlive();
  });

  window.addEventListener("pagehide", () => {});

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") return;
    ensureRealtimeAlive();
    void import("@/lib/syncv3/bootstrap").then((m) => m.wakeSyncV3Worker());
  });
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
      previewItemRow: (item: Item) => itemToRow(item) as Record<string, unknown>,
    });
    installSyncDebugApi();

    // v2 notify/enqueue/trackStoreDirty removed — Sync v3 commitLocalMutation only.

    const { data } = await supabase.auth.getUser();
    await handleAuthUserChange(data.user?.id ?? null);

    supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthUserChange(session?.user?.id ?? null);
    });

    if (!storeSubscribed) {
      storeSubscribed = true;
      useStore.subscribe((state, prev) => {
        // Domain deletes still tracked for cleanup helpers; push via Sync v3.
        trackGroupChange(prev.groups, state.groups);
        trackTagChange(prev.tags, state.tags);
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

void pushDirtyItems;
void schedulePushRetry;
void schedulePush;
void pushUserTags;
void pushTagAssignments;
void pushGroupsFull;
void syncItemParticipants;
void syncMyTagIdsFromOwnedItems;
void tagToRow;
