import type { RealtimeChannel } from "@supabase/supabase-js";
import { withNormalizedAllDay } from "@/lib/allDay";
import { findGoogleGroup } from "@/lib/groups";
import type { Item } from "@/types";
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
    return;
  }

  const isUserSwitch = previousUserId !== null && previousUserId !== nextUserId;
  previousUserId = nextUserId;

  await switchPersistUser(nextUserId);

  if (isUserSwitch) {
    resetLocalUserState();
    await pullAll(true);
  } else {
    await pullAll(false);
  }

  teardownRealtime();
  setupRealtime();
}

function schedulePush() {
  if (!supabase || !userId || applyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
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

    const rows = items.map((item) => itemToRow(item, payloadExtrasById.get(item.id)));
    if (rows.length) await supabase!.from("items").upsert(rows);
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
        schedulePush();
      });
    }
  } catch (err) {
    console.warn("[cloud] sync disabled:", err);
  }
}
