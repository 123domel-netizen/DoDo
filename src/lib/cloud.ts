import type { RealtimeChannel } from "@supabase/supabase-js";
import { withNormalizedAllDay } from "@/lib/allDay";
import {
  ensureArchiveGroup,
  ensureGoogleGroup,
  findGoogleGroup,
  isArchiveGroup,
  isGoogleGroup,
} from "@/lib/groups";
import type { Group, Item } from "@/types";
import { resetLocalUserState, switchPersistUser, useStore } from "@/state/store";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { enqueueGoogleSync } from "@/lib/googleSync";

/**
 * Optional cloud sync. When Supabase env vars are present and a user is signed
 * in, local items are mirrored to the `items` table and remote changes are
 * streamed back via Realtime. Without configuration the app stays fully local.
 */

let userId: string | null = null;
let previousUserId: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let googleSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushedSnapshot = "";
let applyingRemote = false;
const pendingGoogleItemIds = new Set<string>();
let pendingGoogleDelete = false;
let realtimeChannel: RealtimeChannel | null = null;
let storeSubscribed = false;

// Synchronizacja grup
let groupsReady = false;
let lastGroupsSnapshot = "";
const pendingGroupDeletes = new Set<string>();

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
      hasDueDate: item.hasDueDate,
      preArchiveGroupId: item.preArchiveGroupId ?? null,
      googleSyncOverride: item.googleSyncOverride ?? null,
      googleLinkGroupId: item.googleLinkGroupId ?? null,
      googleRecurrence: item.googleRecurrence,
      googleRecurringSeriesId: item.googleRecurringSeriesId ?? null,
      googleRecurrenceExceptions: item.googleRecurrenceExceptions,
      googleCalendarEventId: item.googleCalendarEventId ?? null,
      ...payloadExtras,
    },
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

function rowToItem(row: Record<string, unknown>): Item {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  // Importy z Google bez przypisanej grupy trafiają do lokalnej grupy „GOOGLE”.
  let groupId = (row.group_id as string | null) ?? null;
  if (!groupId && payload.syncSource === "google") {
    groupId = findGoogleGroup(useStore.getState().groups)?.id ?? null;
  }
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
    googleSyncOverride: (payload.googleSyncOverride as Item["googleSyncOverride"]) ?? null,
    googleLinkGroupId: (payload.googleLinkGroupId as string | null) ?? null,
    googleRecurrence: (payload.googleRecurrence as string[] | undefined) ?? undefined,
    googleRecurringSeriesId: (payload.googleRecurringSeriesId as string | undefined) ?? undefined,
    googleRecurrenceExceptions:
      (payload.googleRecurrenceExceptions as Item["googleRecurrenceExceptions"]) ?? undefined,
    googleCalendarEventId: (payload.googleCalendarEventId as string | undefined) ?? undefined,
    syncSource: (payload.syncSource as Item["syncSource"]) ?? undefined,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
  return item.allDay ? withNormalizedAllDay(item) : item;
}

function isGoogleOriginatedRow(row: Record<string, unknown>): boolean {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return payload.syncSource === "google";
}

function groupToRow(group: Group) {
  return {
    id: group.id,
    user_id: userId,
    name: group.name,
    color: group.color,
    sort_order: group.sortOrder,
    system: group.system ?? null,
    hide_from_all: group.hideFromAll ?? false,
  };
}

function rowToGroup(row: Record<string, unknown>): Group {
  const name = (row.name as string) ?? "";
  const base = { name, system: (row.system as Group["system"]) ?? undefined };
  const system: Group["system"] =
    base.system ?? (isArchiveGroup(base) ? "archive" : isGoogleGroup(base) ? "google" : undefined);
  return {
    id: row.id as string,
    name,
    color: (row.color as string) ?? "#5E7FA8",
    sortOrder: (row.sort_order as number) ?? 0,
    system,
    hideFromAll: (row.hide_from_all as boolean | null) ?? undefined,
  };
}

function groupsSnapshot(groups: Group[]): string {
  return JSON.stringify(
    groups.map((g) => [g.id, g.name, g.color, g.sortOrder, g.system ?? null, g.hideFromAll ?? false]),
  );
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
  let googleKept: Group | null = null;
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
    } else if (isGoogleGroup(g)) {
      if (googleKept) {
        remap.set(g.id, googleKept.id);
        deleteIds.push(g.id);
      } else {
        googleKept = g;
        result.push(g);
      }
    } else {
      result.push(g);
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

async function pushGroupsFull() {
  if (!supabase || !userId || !groupsReady) return;
  const groups = useStore.getState().groups;
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
    // Pierwsze urządzenie: zasiej bazę lokalnymi grupami.
    groupsReady = true;
    lastGroupsSnapshot = "";
    await pushGroupsFull();
    return;
  }

  const { groups, remap, deleteIds } = reconcileGroups(remote);
  const ensured = ensureGoogleGroup(ensureArchiveGroup(groups));

  applyingRemote = true;
  try {
    useStore.setState((s) => ({
      groups: ensured,
      items: remapItemGroups(s.items, remap),
    }));
  } finally {
    applyingRemote = false;
  }

  groupsReady = true;
  lastGroupsSnapshot = groupsSnapshot(ensured);

  if (deleteIds.length) {
    await supabase.from("groups").delete().in("id", deleteIds);
  }
  // Dosyłka, gdy ensure dodał brakującą grupę systemową lub trzeba poprawić wiersze.
  if (ensured.length !== remote.length - deleteIds.length || remap.size) {
    lastGroupsSnapshot = "";
    await pushGroupsFull();
  }
}

async function pullAll(replace = false) {
  if (!supabase || !userId) return;
  const { data, error } = await supabase.from("items").select("*");
  if (error || !data) return;
  const remoteItems: Record<string, Item> = {};
  for (const row of data) remoteItems[row.id] = rowToItem(row);

  if (replace) {
    useStore.setState({ items: remoteItems });
    return;
  }

  const local = useStore.getState().items;
  const merged = { ...local };
  for (const [id, remote] of Object.entries(remoteItems)) {
    const l = local[id];
    if (!l || new Date(remote.updatedAt) >= new Date(l.updatedAt)) merged[id] = remote;
  }
  useStore.setState({ items: merged });
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
      applyingRemote = true;
      try {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id: string }).id;
          const next = { ...useStore.getState().items };
          delete next[id];
          useStore.setState({ items: next });
        } else {
          const row = payload.new as Record<string, unknown>;
          const item = rowToItem(row);
          useStore.setState((s) => ({ items: { ...s.items, [item.id]: item } }));
          if (isGoogleOriginatedRow(row)) {
            pendingGoogleItemIds.delete(item.id);
          }
        }
      } finally {
        applyingRemote = false;
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, (payload) => {
      applyingRemote = true;
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
        applyingRemote = false;
      }
    })
    .subscribe();
}

export async function handleAuthUserChange(nextUserId: string | null) {
  if (!cloudEnabled || !supabase) return;
  if (nextUserId === previousUserId) return;

  userId = nextUserId;

  if (!nextUserId) {
    teardownRealtime();
    resetLocalUserState();
    await switchPersistUser(null);
    previousUserId = null;
    lastPushedSnapshot = "";
    pendingGoogleItemIds.clear();
    pendingGoogleDelete = false;
    groupsReady = false;
    lastGroupsSnapshot = "";
    pendingGroupDeletes.clear();
    return;
  }

  const isUserSwitch = previousUserId !== null && previousUserId !== nextUserId;
  previousUserId = nextUserId;

  groupsReady = false;
  lastGroupsSnapshot = "";
  pendingGroupDeletes.clear();

  await switchPersistUser(nextUserId);

  if (isUserSwitch) resetLocalUserState();

  // Grupy najpierw — items.group_id ma klucz obcy do groups(id).
  await pullGroups();
  await pullAll(isUserSwitch);

  // Odrzuć ewentualne „usunięcia" wywołane resetem stanu przy przełączaniu konta.
  pendingGroupDeletes.clear();

  teardownRealtime();
  setupRealtime();
}

function schedulePush() {
  if (!supabase || !userId || applyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    // Grupy przed itemami — items.group_id ma klucz obcy do groups(id).
    await pushGroupsFull();

    const items = Object.values(useStore.getState().items);
    const snapshot = JSON.stringify(items.map((i) => [i.id, i.updatedAt]));
    if (snapshot === lastPushedSnapshot) return;
    lastPushedSnapshot = snapshot;

    const ids = items.map((i) => i.id);
    const payloadExtrasById = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data: existingRows } = await supabase!
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
    }

    // Defensywnie: nie wysyłaj group_id wskazującego grupę, której nie ma lokalnie
    // (klucz obcy items.group_id → groups.id). Inaczej jeden „osierocony" wiersz
    // wywala cały batch i blokuje synchronizację wszystkich elementów.
    const localGroupIds = new Set(useStore.getState().groups.map((g) => g.id));
    const rows = items.map((item) => {
      const row = itemToRow(item, payloadExtrasById.get(item.id));
      if (row.group_id && !localGroupIds.has(row.group_id)) row.group_id = null;
      return row;
    });
    if (rows.length) {
      const { error } = await supabase!.from("items").upsert(rows);
      if (error) {
        console.warn("[cloud] item upsert failed:", error.message);
        lastPushedSnapshot = ""; // ponów przy następnej zmianie
        return;
      }
    }
    scheduleGoogleSync();
  }, 800);
}

function scheduleGoogleSync() {
  if (!cloudEnabled || !userId) return;
  if (googleSyncTimer) clearTimeout(googleSyncTimer);
  googleSyncTimer = setTimeout(async () => {
    try {
      const ids = pendingGoogleDelete
        ? undefined
        : pendingGoogleItemIds.size
          ? [...pendingGoogleItemIds]
          : undefined;
      pendingGoogleItemIds.clear();
      pendingGoogleDelete = false;
      await enqueueGoogleSync(ids);
    } catch (err) {
      console.warn("[cloud] google sync enqueue failed:", err);
    }
  }, 1500);
}

function trackLocalChange(prev: Record<string, Item>, next: Record<string, Item>) {
  if (applyingRemote) return;
  for (const id of Object.keys(next)) {
    const item = next[id];
    const was = prev[id];
    if (!was || item.updatedAt !== was.updatedAt) {
      pendingGoogleItemIds.add(id);
    }
  }
  for (const id of Object.keys(prev)) {
    if (!next[id]) pendingGoogleDelete = true;
  }
  scheduleGoogleSync();
}

function trackGroupChange(prev: Group[], next: Group[]) {
  if (applyingRemote || prev === next) return;
  const nextIds = new Set(next.map((g) => g.id));
  for (const g of prev) {
    if (!nextIds.has(g.id)) pendingGroupDeletes.add(g.id);
  }
}

export async function initCloudSync() {
  if (!cloudEnabled || !supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    await handleAuthUserChange(data.user?.id ?? null);

    supabase.auth.onAuthStateChange((_event, session) => {
      void handleAuthUserChange(session?.user?.id ?? null);
    });

    if (!storeSubscribed) {
      storeSubscribed = true;
      useStore.subscribe((state, prev) => {
        trackLocalChange(prev.items, state.items);
        trackGroupChange(prev.groups, state.groups);
        schedulePush();
      });
    }
  } catch (err) {
    console.warn("[cloud] sync disabled:", err);
  }
}
