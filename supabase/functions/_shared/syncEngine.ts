import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { googleFetch } from "./googleAuth.ts";
import type {
  ExternalLinkRow,
  GoogleSyncSettingsRow,
  ItemRow,
} from "./googleMap.ts";
import {
  shouldSkipItem,
  toCalendarEvent,
  toGoogleTask,
  toReminderShadowCalendarEvent,
  wantsCalendar,
  wantsReminderShadowEvents,
  wantsTasks,
  googleEventToItemPatch,
  googleTaskToItemPatch,
  isDodoReminderShadowEvent,
} from "./googleMap.ts";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const TASKS_BASE = "https://www.googleapis.com/tasks/v1";

async function itemHasProviderLink(
  admin: SupabaseClient,
  itemId: string,
  provider: ExternalLinkRow["provider"],
): Promise<boolean> {
  const { data } = await admin.from("item_external_links").select("id").eq("item_id", itemId).eq(
    "provider",
    provider,
  ).maybeSingle();
  return Boolean(data);
}

async function findOrphanGoogleCalendarItem(
  admin: SupabaseClient,
  userId: string,
  googleEventId: string,
  title: string,
): Promise<ItemRow | null> {
  const { data: byPayload } = await admin.from("items").select("*").eq("user_id", userId).filter(
    "payload->>googleCalendarEventId",
    "eq",
    googleEventId,
  ).limit(1);
  if (byPayload?.[0]) return byPayload[0] as ItemRow;

  const { data: candidates } = await admin.from("items").select("*").eq("user_id", userId).eq(
    "title",
    title,
  ).filter("payload->>syncSource", "eq", "google");
  for (const candidate of candidates ?? []) {
    if (await itemHasProviderLink(admin, candidate.id, "google_calendar")) continue;
    return candidate as ItemRow;
  }
  return null;
}

async function findOrphanGoogleTaskItem(
  admin: SupabaseClient,
  userId: string,
  googleTaskId: string,
  title: string,
): Promise<ItemRow | null> {
  const { data: byPayload } = await admin.from("items").select("*").eq("user_id", userId).filter(
    "payload->>googleTaskId",
    "eq",
    googleTaskId,
  ).limit(1);
  if (byPayload?.[0]) return byPayload[0] as ItemRow;

  const { data: candidates } = await admin.from("items").select("*").eq("user_id", userId).eq(
    "title",
    title,
  ).filter("payload->>syncSource", "eq", "google");
  for (const candidate of candidates ?? []) {
    if (await itemHasProviderLink(admin, candidate.id, "google_tasks")) continue;
    return candidate as ItemRow;
  }
  return null;
}

async function deleteItemAndLinks(
  admin: SupabaseClient,
  userId: string,
  itemId: string,
) {
  await admin.from("item_external_links").delete().eq("user_id", userId).eq("item_id", itemId);
  await admin.from("items").delete().eq("id", itemId);
}

/** Usuwa duplikaty po reconnect (stary wpis bez linku + nowy z linkiem). */
async function dedupeGoogleImports(admin: SupabaseClient, userId: string) {
  const { data: calLinks } = await admin.from("item_external_links").select("item_id").eq(
    "user_id",
    userId,
  ).eq("provider", "google_calendar");
  const linkedCal = new Set((calLinks ?? []).map((l) => l.item_id as string));

  const { data: calItems } = await admin.from("items").select("id, title, updated_at, payload")
    .eq("user_id", userId).eq("show_in_calendar", true).filter(
      "payload->>syncSource",
      "eq",
      "google",
    );

  const linkedCalTitles = new Set<string>();
  for (const item of calItems ?? []) {
    if (linkedCal.has(item.id as string)) linkedCalTitles.add(item.title as string);
  }

  const byCalExt = new Map<string, { id: string; hasLink: boolean; updatedAt: number }[]>();
  for (const item of calItems ?? []) {
    const payload = item.payload as { googleCalendarEventId?: string };
    const extId = payload?.googleCalendarEventId;
    if (extId) {
      const arr = byCalExt.get(extId) ?? [];
      arr.push({
        id: item.id as string,
        hasLink: linkedCal.has(item.id as string),
        updatedAt: new Date(item.updated_at as string).getTime(),
      });
      byCalExt.set(extId, arr);
    }

    if (!linkedCal.has(item.id as string) && linkedCalTitles.has(item.title as string)) {
      await deleteItemAndLinks(admin, userId, item.id as string);
    }
  }

  for (const group of byCalExt.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      if (a.hasLink !== b.hasLink) return a.hasLink ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    for (let i = 1; i < group.length; i++) {
      await deleteItemAndLinks(admin, userId, group[i].id);
    }
  }

  const { data: taskLinks } = await admin.from("item_external_links").select("item_id").eq(
    "user_id",
    userId,
  ).eq("provider", "google_tasks");
  const linkedTasks = new Set((taskLinks ?? []).map((l) => l.item_id as string));

  const { data: taskItems } = await admin.from("items").select("id, title, updated_at, payload")
    .eq("user_id", userId).eq("type", "task").filter("payload->>syncSource", "eq", "google");

  const linkedTaskTitles = new Set<string>();
  for (const item of taskItems ?? []) {
    if (linkedTasks.has(item.id as string)) linkedTaskTitles.add(item.title as string);
  }

  const byTaskExt = new Map<string, { id: string; hasLink: boolean; updatedAt: number }[]>();
  for (const item of taskItems ?? []) {
    const payload = item.payload as { googleTaskId?: string };
    const extId = payload?.googleTaskId;
    if (extId) {
      const arr = byTaskExt.get(extId) ?? [];
      arr.push({
        id: item.id as string,
        hasLink: linkedTasks.has(item.id as string),
        updatedAt: new Date(item.updated_at as string).getTime(),
      });
      byTaskExt.set(extId, arr);
    }

    if (!linkedTasks.has(item.id as string) && linkedTaskTitles.has(item.title as string)) {
      await deleteItemAndLinks(admin, userId, item.id as string);
    }
  }

  for (const group of byTaskExt.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      if (a.hasLink !== b.hasLink) return a.hasLink ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    for (let i = 1; i < group.length; i++) {
      await deleteItemAndLinks(admin, userId, group[i].id);
    }
  }
}

async function getLinks(
  admin: SupabaseClient,
  userId: string,
  itemId: string,
): Promise<ExternalLinkRow[]> {
  const { data } = await admin
    .from("item_external_links")
    .select("*")
    .eq("user_id", userId)
    .eq("item_id", itemId);
  return (data ?? []) as ExternalLinkRow[];
}

async function upsertLink(
  admin: SupabaseClient,
  link: Partial<ExternalLinkRow> & {
    user_id: string;
    item_id: string;
    provider: ExternalLinkRow["provider"];
    external_id: string;
  },
) {
  await admin.from("item_external_links").upsert(
    { ...link, updated_at: new Date().toISOString() },
    { onConflict: "user_id,item_id,provider" },
  );
}

async function deleteLink(
  admin: SupabaseClient,
  userId: string,
  itemId: string,
  provider: ExternalLinkRow["provider"],
) {
  await admin.from("item_external_links").delete().eq("user_id", userId).eq("item_id", itemId).eq(
    "provider",
    provider,
  );
}

export async function pushCalendarItem(
  admin: SupabaseClient,
  userId: string,
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
  links: ExternalLinkRow[],
) {
  const calId = encodeURIComponent(settings.calendar_id);
  const existing = links.find((l) => l.provider === "google_calendar");
  const body = toCalendarEvent(item);
  const linkGroupId = existing?.link_group_id ?? crypto.randomUUID();

  if (existing) {
    const url =
      `${CAL_BASE}/calendars/${calId}/events/${encodeURIComponent(existing.external_id)}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (existing.etag) headers["If-Match"] = existing.etag;
    let res = await googleFetch(userId, url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 412) {
      const fresh = await googleFetch(userId, url);
      if (fresh.ok) {
        const ev = await fresh.json();
        headers["If-Match"] = ev.etag;
        res = await googleFetch(userId, url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        });
      }
    }
    if (res.status === 404) {
      await deleteLink(admin, userId, item.id, "google_calendar");
      return pushCalendarItem(admin, userId, item, settings, links.filter((l) =>
        l.provider !== "google_calendar"
      ));
    }
    if (!res.ok) throw new Error(`Calendar PATCH: ${await res.text()}`);
    const ev = await res.json();
    await upsertLink(admin, {
      user_id: userId,
      item_id: item.id,
      provider: "google_calendar",
      external_id: ev.id,
      external_calendar_id: settings.calendar_id,
      etag: ev.etag,
      link_group_id: linkGroupId,
      last_pushed_at: new Date().toISOString(),
    });
  } else {
    const url = `${CAL_BASE}/calendars/${calId}/events`;
    const res = await googleFetch(userId, url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Calendar POST: ${await res.text()}`);
    const ev = await res.json();
    await upsertLink(admin, {
      user_id: userId,
      item_id: item.id,
      provider: "google_calendar",
      external_id: ev.id,
      external_calendar_id: settings.calendar_id,
      etag: ev.etag,
      link_group_id: linkGroupId,
      last_pushed_at: new Date().toISOString(),
    });
  }
}

async function syncChecklistSubtasks(
  admin: SupabaseClient,
  userId: string,
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
  parentTaskId: string,
  link: ExternalLinkRow,
) {
  const listId = encodeURIComponent(settings.task_list_id);
  const subMap = { ...(link.checklist_subtask_ids ?? {}) };
  const checklist = item.payload.checklist ?? [];

  for (const c of checklist) {
    const subId = subMap[c.id];
    const subBody = {
      title: c.text || "Punkt",
      status: c.done ? "completed" : "needsAction",
    };
    if (subId) {
      const url =
        `${TASKS_BASE}/lists/${listId}/tasks/${encodeURIComponent(subId)}`;
      await googleFetch(userId, url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subBody),
      });
    } else if (c.text.trim()) {
      const url =
        `${TASKS_BASE}/lists/${listId}/tasks?parent=${encodeURIComponent(parentTaskId)}`;
      const res = await googleFetch(userId, url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subBody),
      });
      if (res.ok) {
        const sub = await res.json();
        subMap[c.id] = sub.id;
      }
    }
  }

  await admin.from("item_external_links").update({
    checklist_subtask_ids: subMap,
    updated_at: new Date().toISOString(),
  }).eq("id", link.id);
}

export async function pushTaskItem(
  admin: SupabaseClient,
  userId: string,
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
  links: ExternalLinkRow[],
) {
  const listId = encodeURIComponent(settings.task_list_id);
  const existing = links.find((l) => l.provider === "google_tasks");
  const body = toGoogleTask(item);
  const linkGroupId = existing?.link_group_id ?? crypto.randomUUID();

  if (existing) {
    const url =
      `${TASKS_BASE}/lists/${listId}/tasks/${encodeURIComponent(existing.external_id)}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (existing.etag) headers["If-Match"] = existing.etag;
    let res = await googleFetch(userId, url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 412) {
      const fresh = await googleFetch(userId, url);
      if (fresh.ok) {
        const t = await fresh.json();
        headers["If-Match"] = t.etag;
        res = await googleFetch(userId, url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        });
      }
    }
    if (res.status === 404) {
      await deleteLink(admin, userId, item.id, "google_tasks");
      return pushTaskItem(admin, userId, item, settings, links.filter((l) =>
        l.provider !== "google_tasks"
      ));
    }
    if (!res.ok) throw new Error(`Tasks PATCH: ${await res.text()}`);
    const task = await res.json();
    const linkRow = {
      user_id: userId,
      item_id: item.id,
      provider: "google_tasks" as const,
      external_id: task.id,
      external_task_list_id: settings.task_list_id,
      etag: task.etag,
      link_group_id: linkGroupId,
      last_pushed_at: new Date().toISOString(),
      checklist_subtask_ids: existing.checklist_subtask_ids ?? {},
    };
    await upsertLink(admin, linkRow);
    await syncChecklistSubtasks(admin, userId, item, settings, task.id, {
      ...existing,
      ...linkRow,
      id: existing.id,
    } as ExternalLinkRow);
  } else {
    const url = `${TASKS_BASE}/lists/${listId}/tasks`;
    const res = await googleFetch(userId, url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Tasks POST: ${await res.text()}`);
    const task = await res.json();
    await upsertLink(admin, {
      user_id: userId,
      item_id: item.id,
      provider: "google_tasks",
      external_id: task.id,
      external_task_list_id: settings.task_list_id,
      etag: task.etag,
      link_group_id: linkGroupId,
      last_pushed_at: new Date().toISOString(),
      checklist_subtask_ids: {},
    });
    const { data: newLink } = await admin.from("item_external_links").select("*").eq(
      "user_id",
      userId,
    ).eq("item_id", item.id).eq("provider", "google_tasks").maybeSingle();
    if (newLink && (item.payload.checklist?.length ?? 0) > 0) {
      await syncChecklistSubtasks(admin, userId, item, settings, task.id, newLink as ExternalLinkRow);
    }
  }
}

async function removeCalendarLink(
  admin: SupabaseClient,
  userId: string,
  link: ExternalLinkRow,
) {
  const calId = encodeURIComponent(link.external_calendar_id ?? "primary");
  const url =
    `${CAL_BASE}/calendars/${calId}/events/${encodeURIComponent(link.external_id)}`;
  await googleFetch(userId, url, { method: "DELETE" }).catch(() => {});
  await admin.from("item_external_links").delete().eq("id", link.id);
}

async function removeTaskLink(
  admin: SupabaseClient,
  userId: string,
  link: ExternalLinkRow,
) {
  const listId = encodeURIComponent(link.external_task_list_id ?? "@default");
  const url =
    `${TASKS_BASE}/lists/${listId}/tasks/${encodeURIComponent(link.external_id)}`;
  await googleFetch(userId, url, { method: "DELETE" }).catch(() => {});
  await admin.from("item_external_links").delete().eq("id", link.id);
}

async function deleteCalendarEvent(
  userId: string,
  calendarId: string,
  eventId: string,
) {
  const calId = encodeURIComponent(calendarId);
  const url = `${CAL_BASE}/calendars/${calId}/events/${encodeURIComponent(eventId)}`;
  await googleFetch(userId, url, { method: "DELETE" }).catch(() => {});
}

async function upsertRawCalendarEvent(
  userId: string,
  calendarId: string,
  body: Record<string, unknown>,
  existing?: { external_id: string; etag: string | null },
): Promise<{ id: string; etag: string }> {
  const calId = encodeURIComponent(calendarId);
  if (existing) {
    const url =
      `${CAL_BASE}/calendars/${calId}/events/${encodeURIComponent(existing.external_id)}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (existing.etag) headers["If-Match"] = existing.etag;
    let res = await googleFetch(userId, url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 412) {
      const fresh = await googleFetch(userId, url);
      if (fresh.ok) {
        const ev = await fresh.json();
        headers["If-Match"] = ev.etag;
        res = await googleFetch(userId, url, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        });
      }
    }
    if (res.status === 404) {
      existing = undefined;
    } else {
      if (!res.ok) throw new Error(`Calendar PATCH: ${await res.text()}`);
      const ev = await res.json();
      return { id: ev.id as string, etag: ev.etag as string };
    }
  }

  const url = `${CAL_BASE}/calendars/${calId}/events`;
  const res = await googleFetch(userId, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Calendar POST: ${await res.text()}`);
  const ev = await res.json();
  return { id: ev.id as string, etag: ev.etag as string };
}

async function persistReminderEventIds(
  admin: SupabaseClient,
  item: ItemRow,
  map: Record<string, string>,
) {
  await admin.from("items").update({
    payload: { ...item.payload, googleReminderEventIds: map },
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);
}

async function clearReminderShadowEvents(
  admin: SupabaseClient,
  userId: string,
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
) {
  const map = { ...(item.payload.googleReminderEventIds ?? {}) };
  if (!Object.keys(map).length) return;

  for (const eventId of Object.values(map)) {
    await deleteCalendarEvent(userId, settings.calendar_id, eventId);
  }
  await persistReminderEventIds(admin, item, {});
}

async function syncReminderShadowEvents(
  admin: SupabaseClient,
  userId: string,
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
) {
  if (!wantsReminderShadowEvents(item, settings)) {
    await clearReminderShadowEvents(admin, userId, item, settings);
    return;
  }

  const reminders = item.payload.reminders ?? [];
  const prevMap = { ...(item.payload.googleReminderEventIds ?? {}) };
  const nextMap: Record<string, string> = {};

  for (const reminder of reminders) {
    const body = toReminderShadowCalendarEvent(item, reminder);
    const existingId = prevMap[reminder.id];
    const existing = existingId
      ? { external_id: existingId, etag: null as string | null }
      : undefined;
    const ev = await upsertRawCalendarEvent(userId, settings.calendar_id, body, existing);
    nextMap[reminder.id] = ev.id;
  }

  for (const [reminderId, eventId] of Object.entries(prevMap)) {
    if (!nextMap[reminderId]) {
      await deleteCalendarEvent(userId, settings.calendar_id, eventId);
    }
  }

  await persistReminderEventIds(admin, item, nextMap);
}

export async function pushItem(
  admin: SupabaseClient,
  userId: string,
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
) {
  const links = await getLinks(admin, userId, item.id);

  if (shouldSkipItem(item, settings)) {
    await clearReminderShadowEvents(admin, userId, item, settings);
    const calLink = links.find((l) => l.provider === "google_calendar");
    const taskLink = links.find((l) => l.provider === "google_tasks");
    if (calLink) await removeCalendarLink(admin, userId, calLink);
    if (taskLink) await removeTaskLink(admin, userId, taskLink);
    return;
  }

  const wantCal = wantsCalendar(item, settings);
  const wantTask = wantsTasks(item, settings);
  const isGoogleImport = item.payload.syncSource === "google";

  const calLink = links.find((l) => l.provider === "google_calendar");
  const taskLink = links.find((l) => l.provider === "google_tasks");

  if (wantCal && !(isGoogleImport && !calLink)) {
    await pushCalendarItem(admin, userId, item, settings, links);
  } else if (calLink) {
    await removeCalendarLink(admin, userId, calLink);
  }

  if (wantTask && !(isGoogleImport && !taskLink)) {
    await pushTaskItem(admin, userId, item, settings, links);
  } else if (taskLink) {
    await removeTaskLink(admin, userId, taskLink);
  }

  await syncReminderShadowEvents(admin, userId, item, settings);
}

export async function pullCalendar(
  admin: SupabaseClient,
  userId: string,
  settings: GoogleSyncSettingsRow,
) {
  const calId = encodeURIComponent(settings.calendar_id);
  const { data: stateRow } = await admin.from("google_sync_state").select("*").eq(
    "user_id",
    userId,
  ).maybeSingle();

  let syncToken = stateRow?.calendar_sync_token as string | undefined;
  const params = new URLSearchParams({ singleEvents: "true", showDeleted: "true" });
  if (syncToken) {
    params.set("syncToken", syncToken);
  } else {
    const timeMin = new Date(Date.now() - 30 * 86_400_000).toISOString();
    params.set("timeMin", timeMin);
  }

  let pageToken: string | undefined;
  let newSyncToken: string | undefined;

  do {
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${CAL_BASE}/calendars/${calId}/events?${params}`;
    const res = await googleFetch(userId, url);
    if (res.status === 410) {
      syncToken = undefined;
      params.delete("syncToken");
      params.set("timeMin", new Date(Date.now() - 30 * 86_400_000).toISOString());
      continue;
    }
    if (!res.ok) throw new Error(`Calendar list: ${await res.text()}`);
    const data = await res.json();
    newSyncToken = data.nextSyncToken ?? newSyncToken;
    pageToken = data.nextPageToken;

    for (const ev of data.items ?? []) {
      if (isDodoReminderShadowEvent(ev)) continue;

      if (ev.status === "cancelled") {
        const { data: link } = await admin.from("item_external_links").select("item_id").eq(
          "user_id",
          userId,
        ).eq("provider", "google_calendar").eq("external_id", ev.id).maybeSingle();
        if (link) {
          await admin.from("items").delete().eq("id", link.item_id);
          await admin.from("item_external_links").delete().eq("user_id", userId).eq(
            "external_id",
            ev.id,
          );
        }
        continue;
      }

      const { data: link } = await admin.from("item_external_links").select("*").eq(
        "user_id",
        userId,
      ).eq("provider", "google_calendar").eq("external_id", ev.id).maybeSingle();

      let existing: ItemRow | null = null;
      if (link) {
        const { data: item } = await admin.from("items").select("*").eq("id", link.item_id)
          .maybeSingle();
        existing = item as ItemRow | null;
      }

      const patch = googleEventToItemPatch(ev, existing);
      if (link && existing) {
        await admin.from("items").update({
          title: patch.title ?? existing.title,
          description: patch.description ?? existing.description,
          start_at: patch.start_at ?? existing.start_at,
          end_at: patch.end_at ?? existing.end_at,
          all_day: patch.all_day ?? existing.all_day,
          show_in_calendar: true,
          payload: patch.payload,
          updated_at: patch.updated_at ?? new Date().toISOString(),
        }).eq("id", existing.id);
        await admin.from("item_external_links").update({
          etag: ev.etag,
          last_pulled_at: new Date().toISOString(),
        }).eq("id", link.id);
      } else if (!link) {
        const googleEventId = ev.id as string;
        const orphan = await findOrphanGoogleCalendarItem(
          admin,
          userId,
          googleEventId,
          patch.title ?? "",
        );
        const itemId = orphan?.id ?? crypto.randomUUID();
        const payload = {
          ...patch.payload,
          googleCalendarEventId: googleEventId,
        };
        if (orphan) {
          await admin.from("items").update({
            title: patch.title ?? orphan.title,
            description: patch.description ?? orphan.description,
            start_at: patch.start_at ?? orphan.start_at,
            end_at: patch.end_at ?? orphan.end_at,
            all_day: patch.all_day ?? orphan.all_day,
            show_in_calendar: true,
            payload,
            updated_at: patch.updated_at ?? new Date().toISOString(),
          }).eq("id", itemId);
        } else {
          await admin.from("items").insert({
            id: itemId,
            user_id: userId,
            type: "event",
            title: patch.title ?? "",
            description: patch.description ?? "",
            start_at: patch.start_at!,
            end_at: patch.end_at!,
            all_day: patch.all_day ?? false,
            show_in_calendar: true,
            show_in_todo: false,
            done: false,
            payload,
          });
        }
        await upsertLink(admin, {
          user_id: userId,
          item_id: itemId,
          provider: "google_calendar",
          external_id: googleEventId,
          external_calendar_id: settings.calendar_id,
          etag: ev.etag,
          link_group_id: crypto.randomUUID(),
          last_pulled_at: new Date().toISOString(),
        });
      }
    }
  } while (pageToken);

  if (newSyncToken) {
    await admin.from("google_sync_state").upsert({
      user_id: userId,
      calendar_sync_token: newSyncToken,
      updated_at: new Date().toISOString(),
    });
  }
}

export async function pullTasks(
  admin: SupabaseClient,
  userId: string,
  settings: GoogleSyncSettingsRow,
) {
  const listId = encodeURIComponent(settings.task_list_id);
  const { data: stateRow } = await admin.from("google_sync_state").select("*").eq(
    "user_id",
    userId,
  ).maybeSingle();

  const updatedMin = stateRow?.tasks_updated_min as string | undefined;
  const params = new URLSearchParams({ showCompleted: String(settings.sync_completed_tasks) });
  if (updatedMin) params.set("updatedMin", updatedMin);

  let pageToken: string | undefined;
  let maxUpdated = updatedMin ? new Date(updatedMin).getTime() : 0;

  do {
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${TASKS_BASE}/lists/${listId}/tasks?${params}`;
    const res = await googleFetch(userId, url);
    if (!res.ok) throw new Error(`Tasks list: ${await res.text()}`);
    const data = await res.json();
    pageToken = data.nextPageToken;

    for (const task of data.items ?? []) {
      if (task.parent) continue;
      const updated = new Date(task.updated as string).getTime();
      if (updated > maxUpdated) maxUpdated = updated;

      if (task.deleted) {
        const { data: link } = await admin.from("item_external_links").select("item_id").eq(
          "user_id",
          userId,
        ).eq("provider", "google_tasks").eq("external_id", task.id).maybeSingle();
        if (link) {
          await admin.from("items").delete().eq("id", link.item_id);
          await admin.from("item_external_links").delete().eq("user_id", userId).eq(
            "external_id",
            task.id,
          );
        }
        continue;
      }

      const { data: link } = await admin.from("item_external_links").select("*").eq(
        "user_id",
        userId,
      ).eq("provider", "google_tasks").eq("external_id", task.id).maybeSingle();

      let existing: ItemRow | null = null;
      if (link) {
        const { data: item } = await admin.from("items").select("*").eq("id", link.item_id)
          .maybeSingle();
        existing = item as ItemRow | null;
      }

      const patch = googleTaskToItemPatch(task, existing);
      if (!patch) continue;

      if (link && existing) {
        await admin.from("items").update({
          title: patch.title ?? existing.title,
          description: patch.description ?? existing.description,
          start_at: patch.start_at ?? existing.start_at,
          end_at: patch.end_at ?? existing.end_at,
          done: patch.done ?? existing.done,
          show_in_todo: true,
          type: "task",
          payload: patch.payload,
          updated_at: patch.updated_at ?? new Date().toISOString(),
        }).eq("id", existing.id);
        await admin.from("item_external_links").update({
          etag: task.etag,
          last_pulled_at: new Date().toISOString(),
        }).eq("id", link.id);
      } else if (!link) {
        const googleTaskId = task.id as string;
        const orphan = await findOrphanGoogleTaskItem(
          admin,
          userId,
          googleTaskId,
          patch.title ?? "",
        );
        const itemId = orphan?.id ?? crypto.randomUUID();
        const payload = {
          ...patch.payload,
          googleTaskId,
        };
        if (orphan) {
          await admin.from("items").update({
            title: patch.title ?? orphan.title,
            description: patch.description ?? orphan.description,
            start_at: patch.start_at ?? orphan.start_at,
            end_at: patch.end_at ?? orphan.end_at,
            done: patch.done ?? orphan.done,
            show_in_todo: true,
            type: "task",
            payload,
            updated_at: patch.updated_at ?? new Date().toISOString(),
          }).eq("id", itemId);
        } else {
          await admin.from("items").insert({
            id: itemId,
            user_id: userId,
            type: "task",
            title: patch.title ?? "",
            description: patch.description ?? "",
            start_at: patch.start_at!,
            end_at: patch.end_at!,
            all_day: false,
            show_in_calendar: false,
            show_in_todo: true,
            done: patch.done ?? false,
            payload,
          });
        }
        await upsertLink(admin, {
          user_id: userId,
          item_id: itemId,
          provider: "google_tasks",
          external_id: googleTaskId,
          external_task_list_id: settings.task_list_id,
          etag: task.etag,
          link_group_id: crypto.randomUUID(),
          last_pulled_at: new Date().toISOString(),
        });
      }
    }
  } while (pageToken);

  await admin.from("google_sync_state").upsert({
    user_id: userId,
    tasks_updated_min: new Date(maxUpdated || Date.now()).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function setupCalendarWatch(
  admin: SupabaseClient,
  userId: string,
  settings: GoogleSyncSettingsRow,
) {
  const webhookUrl = Deno.env.get("GOOGLE_WEBHOOK_URL");
  if (!webhookUrl) return;

  const { data: state } = await admin.from("google_sync_state").select("*").eq("user_id", userId)
    .maybeSingle();
  if (state?.watch_expiration && new Date(state.watch_expiration).getTime() > Date.now() + 86_400_000) {
    return;
  }

  if (state?.watch_channel_id && state.watch_resource_id) {
    try {
      await googleFetch(userId, `${CAL_BASE}/channels/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: state.watch_channel_id,
          resourceId: state.watch_resource_id,
        }),
      });
    } catch { /* ignore */ }
  }

  const channelId = crypto.randomUUID();
  const calId = encodeURIComponent(settings.calendar_id);
  const res = await googleFetch(
    userId,
    `${CAL_BASE}/calendars/${calId}/events/watch`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
      }),
    },
  );
  if (!res.ok) {
    console.warn("[google-sync] watch failed", await res.text());
    return;
  }
  const body = await res.json();
  await admin.from("google_sync_state").upsert({
    user_id: userId,
    watch_channel_id: channelId,
    watch_resource_id: body.resourceId,
    watch_expiration: new Date(Number(body.expiration)).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function runSyncForUser(
  admin: SupabaseClient,
  userId: string,
  mode: "push" | "pull" | "full",
  itemIds?: string[],
) {
  const { data: acct } = await admin.from("google_accounts").select("user_id").eq(
    "user_id",
    userId,
  ).maybeSingle();
  if (!acct) return { ok: false, reason: "not_connected" };

  const { data: settingsRow } = await admin.from("google_sync_settings").select("*").eq(
    "user_id",
    userId,
  ).maybeSingle();
  const settings = (settingsRow ?? {
    calendar_enabled: true,
    tasks_enabled: true,
    calendar_id: "primary",
    task_list_id: "@default",
    dual_visibility_mode: "both_linked",
    sync_completed_tasks: false,
  }) as GoogleSyncSettingsRow;

  try {
    if (mode === "pull" || mode === "full") {
      if (settings.calendar_enabled) await pullCalendar(admin, userId, settings);
      if (settings.tasks_enabled) await pullTasks(admin, userId, settings);
      await dedupeGoogleImports(admin, userId);
      await setupCalendarWatch(admin, userId, settings);
    }

    if (mode === "push" || mode === "full") {
      let query = admin.from("items").select("*").eq("user_id", userId);
      if (itemIds?.length) query = query.in("id", itemIds);
      const { data: items } = await query;
      for (const item of (items ?? []) as ItemRow[]) {
        await pushItem(admin, userId, item, settings);
      }
    }

    await admin.from("google_sync_state").upsert({
      user_id: userId,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    });

    return { ok: true };
  } catch (e) {
    const msg = String(e);
    await admin.from("google_sync_state").upsert({
      user_id: userId,
      last_sync_error: msg,
      updated_at: new Date().toISOString(),
    });
    throw e;
  }
}

export async function processSyncQueue(admin: SupabaseClient, userId?: string) {
  let q = admin.from("google_sync_queue").select("*").is("processed_at", null).order(
    "created_at",
    { ascending: true },
  ).limit(50);
  if (userId) q = q.eq("user_id", userId);

  const { data: jobs } = await q;
  const byUser = new Map<
    string,
    { pushIds: Set<string>; pull: boolean; full: boolean; pushAll: boolean }
  >();

  for (const job of jobs ?? []) {
    const uid = job.user_id as string;
    if (!byUser.has(uid)) {
      byUser.set(uid, { pushIds: new Set(), pull: false, full: false, pushAll: false });
    }
    const bucket = byUser.get(uid)!;
    if (job.action === "full") bucket.full = true;
    else if (job.action === "pull") bucket.pull = true;
    else if (job.action === "push") {
      if (job.item_id) bucket.pushIds.add(job.item_id as string);
      else bucket.pushAll = true;
    }
  }

  for (const [uid, bucket] of byUser) {
    if (bucket.full) await runSyncForUser(admin, uid, "full");
    else {
      if (bucket.pull) await runSyncForUser(admin, uid, "pull");
      if (bucket.pushAll) await runSyncForUser(admin, uid, "push");
      else if (bucket.pushIds.size) await runSyncForUser(admin, uid, "push", [...bucket.pushIds]);
    }
  }

  const ids = (jobs ?? []).map((j) => j.id);
  if (ids.length) {
    await admin.from("google_sync_queue").update({
      processed_at: new Date().toISOString(),
    }).in("id", ids);
  }
}
