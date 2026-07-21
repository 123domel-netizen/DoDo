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
  getSyncDiagnostics,
  resetSyncState,
  shouldSchedulePush,
  syncState,
  trackStoreDirty,
} from "@/lib/syncState";

/**
 * Optional cloud sync. When Supabase env vars are present and a user is signed
 * in, local items are mirrored to the `items` table and remote changes are
 * streamed back via Realtime. Without configuration the app stays fully local.
 */

let userId: string | null = null;
let userEmail: string | null = null;
let previousUserId: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let storeSubscribed = false;

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
    type: item.type,
    title: item.title,
    description: item.description,
    start_at: item.start,
    end_at: item.end,
    all_day: item.allDay,
    group_id: item.groupId,
    show_in_calendar: item.showInCalendar,
    show_in_todo: item.showInTodo,
    done: item.done,
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
  return item.allDay ? withNormalizedAllDay(item) : item;
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
  syncState.tagAssignmentsDirty = false;
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
  const { data, error } = await supabase.from("items").select("*");
  if (error) return;
  const participantByItem = await pullOwnerParticipantRows();
  const owned: Record<string, Item> = {};
  for (const row of data ?? []) {
    let item = rowToItem(row, "owner");
    const dbRows = participantByItem[item.id];
    if (dbRows?.length) {
      item = { ...item, participants: mergeParticipantsWithDb(item.participants, dbRows) };
    }
    owned[item.id] = item;
  }

  const shared = await pullSharedItems();
  const remoteItems = { ...owned, ...shared };

  if (replace) {
    setApplyingRemote(true);
    try {
      useStore.setState({ items: remoteItems });
      syncMyTagIdsFromOwnedItems(remoteItems);
    } finally {
      setApplyingRemote(false);
    }
    syncState.lastPullAt = new Date().toISOString();
    return;
  }

  setApplyingRemote(true);
  try {
    const local = useStore.getState().items;
    const merged = { ...local };
    for (const [id, remote] of Object.entries(remoteItems)) {
      merged[id] = mergeItemOnSync(local[id], remote);
    }
    useStore.setState({ items: merged });
    syncMyTagIdsFromOwnedItems(merged);
  } finally {
    setApplyingRemote(false);
  }
  syncState.lastPullAt = new Date().toISOString();
}

function teardownRealtime() {
  if (realtimeChannel && supabase) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
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
    .subscribe();
}

export function getSyncDiagnosticsSnapshot() {
  return {
    ...getSyncDiagnostics(),
    autoPullEnabled: cloudEnabled,
    lastAutoPullAt,
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
  if (diag.dirtyItemsCount > 0 || diag.dirtyParticipantCount > 0 || diag.tagAssignmentsDirty) {
    return false;
  }
  if (autoPullInProgress) return false;
  if (useStore.getState().draft) return false;
  if (isUserActivelyEditing()) return false;

  const sincePull = msSinceLastPull();
  if (sincePull !== null && sincePull < AUTO_PULL_MIN_INTERVAL_MS) return false;

  return true;
}

/** Bezpieczny auto-pull — używa tej samej ścieżki co manualny refresh. */
export async function tryAutoCloudRefresh(): Promise<boolean> {
  if (!canAutoCloudRefresh()) return false;

  autoPullInProgress = true;
  try {
    const result = await forceCloudRefresh();
    if (result.ok) lastAutoPullAt = new Date().toISOString();
    return result.ok;
  } finally {
    autoPullInProgress = false;
  }
}

/** Pełny pull z chmury — zastępuje lokalny cache itemów (Sync v2). */
export async function forceCloudRefresh(): Promise<{ ok: boolean; message: string }> {
  if (!cloudEnabled || !supabase || !userId) {
    return { ok: false, message: "Synchronizacja niedostępna" };
  }

  syncState.pushBlocked = true;
  syncState.booting = true;
  try {
    syncState.dirtyItemIds.clear();
    syncState.dirtyParticipantIds.clear();
    syncState.tagAssignmentsDirty = false;

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
    resetLocalUserState();
    await switchPersistUser(null);
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
  syncState.dirtyItemIds.clear();
  syncState.dirtyParticipantIds.clear();
  syncState.tagAssignmentsDirty = false;

  groupsReady = false;
  lastGroupsSnapshot = "";
  pendingGroupDeletes.clear();

  await switchPersistUser(nextUserId);

  const { data: sessionData } = await supabase.auth.getUser();
  userEmail = sessionData.user?.email?.toLowerCase() ?? null;
  useStore.getState().setAuthUser(nextUserId, userEmail);

  if (isUserSwitch) resetLocalUserState();

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
}

async function pushDirtyItems() {
  if (!supabase || !userId) return;

  const dirtyIds = [...syncState.dirtyItemIds];
  if (!dirtyIds.length) return;

  const state = useStore.getState();
  const ownedItems = dirtyIds
    .map((id) => state.items[id])
    .filter((i): i is Item => Boolean(i) && i.shareRole !== "participant");

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
  const rows = ownedItems.map((item) => {
    const row = itemToRow(item, payloadExtrasById.get(item.id));
    if (row.group_id && !localGroupIds.has(row.group_id)) row.group_id = null;
    return row;
  });

  const { error } = await supabase.from("items").upsert(rows);
  if (error) {
    console.warn("[cloud] item upsert failed:", error.message);
    return;
  }

  for (const item of ownedItems) {
    await syncItemParticipants(item);
    pushedIds.push(item.id);
  }

  clearDirtyItems(pushedIds);
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

function schedulePush() {
  if (!shouldSchedulePush() || !supabase || !userId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (!shouldSchedulePush()) return;

    await pushGroupsFull();
    await pushUserTags();
    await pushDirtyItems();
    await pushDirtyParticipants();
    await pushTagAssignments();

    syncState.lastPushAt = new Date().toISOString();
  }, 800);
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
    return;
  }
  syncState.booting = true;
  syncState.ready = false;
  try {
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
