export type DualVisibilityMode =
  | "calendar_only"
  | "tasks_only"
  | "both_linked"
  | "ask_per_item";

export interface GoogleSyncSettingsRow {
  user_id: string;
  calendar_enabled: boolean;
  tasks_enabled: boolean;
  calendar_id: string;
  task_list_id: string;
  dual_visibility_mode: DualVisibilityMode;
  sync_completed_tasks: boolean;
  import_existing_on_connect: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Reminder {
  id: string;
  offsetMinutes: number;
}

export interface ItemRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  show_in_calendar: boolean;
  show_in_todo: boolean;
  done: boolean;
  payload: {
    checklist?: ChecklistItem[];
    reminders?: Reminder[];
    hasDueDate?: boolean;
    googleSyncOverride?: DualVisibilityMode | null;
    googleLinkGroupId?: string | null;
    syncSource?: "local" | "google";
    /** reminderId → Google Calendar event id (zarządzane przez sync) */
    googleReminderEventIds?: Record<string, string>;
  };
  updated_at: string;
}

export interface ExternalLinkRow {
  id: string;
  user_id: string;
  item_id: string;
  provider: "google_calendar" | "google_tasks";
  external_id: string;
  external_calendar_id: string | null;
  external_task_list_id: string | null;
  etag: string | null;
  link_group_id: string | null;
  checklist_subtask_ids: Record<string, string>;
}

export function effectiveDualMode(
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
): DualVisibilityMode {
  if (settings.dual_visibility_mode === "ask_per_item" && item.payload.googleSyncOverride) {
    return item.payload.googleSyncOverride;
  }
  if (item.show_in_calendar && item.show_in_todo && item.type === "task") {
    return settings.dual_visibility_mode === "ask_per_item"
      ? "both_linked"
      : settings.dual_visibility_mode;
  }
  if (item.show_in_calendar && item.payload.hasDueDate) return "calendar_only";
  if (item.show_in_todo && item.type === "task") return "tasks_only";
  return settings.dual_visibility_mode;
}

export function shouldSkipItem(item: ItemRow, settings: GoogleSyncSettingsRow): boolean {
  if (item.done && !settings.sync_completed_tasks) return true;
  if (!wantsCalendar(item, settings) && !wantsTasks(item, settings)) return true;
  return false;
}

export function wantsCalendar(item: ItemRow, settings: GoogleSyncSettingsRow): boolean {
  if (!settings.calendar_enabled) return false;
  if (!item.show_in_calendar || !item.payload.hasDueDate) return false;
  const mode = effectiveDualMode(item, settings);
  return mode === "calendar_only" || mode === "both_linked";
}

export function wantsTasks(item: ItemRow, settings: GoogleSyncSettingsRow): boolean {
  if (!settings.tasks_enabled) return false;
  if (item.type !== "task" || !item.show_in_todo) return false;
  const mode = effectiveDualMode(item, settings);
  return mode === "tasks_only" || mode === "both_linked";
}

export function toCalendarEvent(item: ItemRow, timeZone = "Europe/Warsaw") {
  const start = new Date(item.start_at);
  const end = new Date(item.end_at);
  const reminders = item.payload.reminders ?? [];

  const event: Record<string, unknown> = {
    summary: item.title || "(bez tytułu)",
    description: item.description || undefined,
    reminders: {
      useDefault: false,
      overrides: reminders.map((r) => ({
        method: "popup",
        minutes: r.offsetMinutes,
      })),
    },
  };

  if (item.all_day) {
    event.start = { date: start.toISOString().slice(0, 10), timeZone };
    event.end = { date: end.toISOString().slice(0, 10), timeZone };
  } else {
    event.start = { dateTime: item.start_at, timeZone };
    event.end = { dateTime: item.end_at, timeZone };
  }
  return event;
}

export function toGoogleTask(item: ItemRow) {
  const task: Record<string, unknown> = {
    title: item.title || "(bez tytułu)",
    notes: item.description || undefined,
    status: item.done ? "completed" : "needsAction",
  };
  if (item.payload.hasDueDate) {
    task.due = item.start_at;
  }
  return task;
}

export const DODO_REMINDER_SHADOW_KIND = "dodo_reminder_shadow";

export function reminderFireAtIso(item: ItemRow, offsetMinutes: number): string {
  return new Date(new Date(item.start_at).getTime() - offsetMinutes * 60_000).toISOString();
}

/** Zadanie w Google Tasks (bez bloku w kalendarzu) — przypomnienia jako osobne wpisy w GC. */
export function wantsReminderShadowEvents(
  item: ItemRow,
  settings: GoogleSyncSettingsRow,
): boolean {
  if (!settings.calendar_enabled) return false;
  if (!item.payload.hasDueDate || item.done || item.all_day) return false;
  if (!(item.payload.reminders?.length ?? 0)) return false;
  if (!wantsTasks(item, settings)) return false;
  if (wantsCalendar(item, settings)) return false;
  return true;
}

export function toReminderShadowCalendarEvent(
  item: ItemRow,
  reminder: Reminder,
  timeZone = "Europe/Warsaw",
) {
  const fireAt = reminderFireAtIso(item, reminder.offsetMinutes);
  const endAt = new Date(new Date(fireAt).getTime() + 15 * 60_000).toISOString();
  const title = item.title || "(bez tytułu)";
  return {
    summary: `🔔 Przypomnienie: ${title}`,
    description: item.description ||
      `Termin zadania: ${new Date(item.start_at).toLocaleString("pl-PL")}`,
    start: { dateTime: fireAt, timeZone },
    end: { dateTime: endAt, timeZone },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 0 }],
    },
    extendedProperties: {
      private: {
        dodoKind: DODO_REMINDER_SHADOW_KIND,
        dodoItemId: item.id,
        dodoReminderId: reminder.id,
      },
    },
  };
}

export function isDodoReminderShadowEvent(ev: Record<string, unknown>): boolean {
  const priv = (ev.extendedProperties as { private?: Record<string, string> } | undefined)
    ?.private;
  return priv?.dodoKind === DODO_REMINDER_SHADOW_KIND;
}

export function googleEventToItemPatch(
  ev: Record<string, unknown>,
  existing: ItemRow | null,
): Partial<ItemRow> & { payload: ItemRow["payload"] } {
  const startObj = ev.start as { dateTime?: string; date?: string };
  const endObj = ev.end as { dateTime?: string; date?: string };
  const allDay = Boolean(startObj?.date && !startObj?.dateTime);
  const start = startObj?.dateTime ?? (startObj?.date ? `${startObj.date}T00:00:00.000Z` : new Date().toISOString());
  const end = endObj?.dateTime ??
    (endObj?.date ? `${endObj.date}T23:59:59.000Z` : start);

  const googleUpdated = (ev.updated as string) ?? new Date().toISOString();
  const existingUpdated = existing?.updated_at ?? "1970-01-01T00:00:00.000Z";

  if (existing && new Date(existingUpdated).getTime() > new Date(googleUpdated).getTime() + 2000) {
    return { payload: { ...existing.payload, syncSource: "google" } };
  }

  return {
    title: (ev.summary as string) ?? "",
    description: (ev.description as string) ?? "",
    start_at: start,
    end_at: end,
    all_day: allDay,
    show_in_calendar: true,
    type: existing?.type ?? "event",
    payload: {
      ...(existing?.payload ?? {}),
      hasDueDate: true,
      syncSource: "google",
      checklist: existing?.payload.checklist ?? [],
      reminders: existing?.payload.reminders ?? [],
    },
    updated_at: googleUpdated,
  };
}

export function googleTaskToItemPatch(
  task: Record<string, unknown>,
  existing: ItemRow | null,
): Partial<ItemRow> & { payload: ItemRow["payload"] } | null {
  if (task.parent) return null; // subtask handled separately

  const googleUpdated = (task.updated as string) ?? new Date().toISOString();
  const existingUpdated = existing?.updated_at ?? "1970-01-01T00:00:00.000Z";
  if (existing && new Date(existingUpdated).getTime() > new Date(googleUpdated).getTime() + 2000) {
    return { payload: { ...existing.payload, syncSource: "google" } };
  }

  const due = task.due as string | undefined;
  return {
    title: (task.title as string) ?? "",
    description: (task.notes as string) ?? "",
    type: "task",
    show_in_todo: true,
    show_in_calendar: existing?.show_in_calendar ?? false,
    done: task.status === "completed",
    start_at: due ?? existing?.start_at ?? new Date().toISOString(),
    end_at: due ?? existing?.end_at ?? new Date().toISOString(),
    payload: {
      ...(existing?.payload ?? {}),
      hasDueDate: Boolean(due),
      syncSource: "google",
      checklist: existing?.payload.checklist ?? [],
      reminders: existing?.payload.reminders ?? [],
    },
    updated_at: googleUpdated,
  };
}
