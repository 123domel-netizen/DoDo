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

export interface GoogleRecurrenceException {
  originalStart: string;
  status: "cancelled" | "modified";
  start?: string;
  end?: string;
  title?: string;
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
    /** Id w Google — do ponownego łączenia po reconnect */
    googleCalendarEventId?: string;
    googleTaskId?: string;
    /** RRULE/EXDATE z Google Calendar (wydarzenie cykliczne — jeden wpis na serię). */
    googleRecurrence?: string[];
    googleRecurringSeriesId?: string;
    googleRecurrenceExceptions?: GoogleRecurrenceException[];
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

const DEFAULT_TIME_ZONE = "Europe/Warsaw";

/** YYYY-MM-DD w podanej strefie (en-CA daje format ISO). */
export function ymdInTimeZone(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Google Calendar: pola `date` to północ w strefie kalendarza, `end.date` jest wyłączne.
 * Aplikacja: `end_at` też jest wyłączne (północ dnia po ostatnim dniu wydarzenia).
 */
export function googleAllDayRangeToApp(
  startDate: string,
  endDateExclusive: string | undefined,
  timeZone = DEFAULT_TIME_ZONE,
): { start_at: string; end_at: string } {
  const endExclusive = endDateExclusive ?? addDaysToYmd(startDate, 1);
  return {
    start_at: localMidnightIsoFromYmd(startDate, timeZone),
    end_at: localMidnightIsoFromYmd(endExclusive, timeZone),
  };
}

/** Zwraca ISO dla północy danego dnia kalendarzowego w `timeZone`. */
function localMidnightIsoFromYmd(ymd: string, timeZone: string): string {
  const noonUtc = Date.parse(`${ymd}T12:00:00.000Z`);
  const partsAtNoon = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(noonUtc));
  const part = (type: string) => partsAtNoon.find((p) => p.type === type)?.value ?? "0";
  const hourAtNoon = Number(part("hour")) % 24;
  const midnightUtc = noonUtc - hourAtNoon * 3_600_000;
  const check = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(midnightUtc));
  if (check === ymd) return new Date(midnightUtc).toISOString();
  return new Date(midnightUtc + 3_600_000).toISOString();
}

export function toCalendarEvent(item: ItemRow, timeZone = DEFAULT_TIME_ZONE) {
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
    event.start = { date: ymdInTimeZone(item.start_at, timeZone), timeZone };
    event.end = { date: ymdInTimeZone(item.end_at, timeZone), timeZone };
    if (item.payload.googleRecurrence?.length) {
      event.recurrence = item.payload.googleRecurrence;
    }
  } else {
    event.start = { dateTime: item.start_at, timeZone };
    event.end = { dateTime: item.end_at, timeZone };
    if (item.payload.googleRecurrence?.length) {
      event.recurrence = item.payload.googleRecurrence;
    }
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

/** Identyfikator wystąpienia cyklu (do wyjątków EXDATE / modyfikacji). */
export function googleEventOriginalStartIso(
  ev: Record<string, unknown>,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const orig = ev.originalStartTime as { dateTime?: string; date?: string; timeZone?: string } | undefined;
  const startObj = orig ?? (ev.start as { dateTime?: string; date?: string; timeZone?: string });
  const tz = startObj?.timeZone ?? timeZone;
  if (startObj?.date && !startObj?.dateTime) {
    return googleAllDayRangeToApp(startObj.date, undefined, tz).start_at;
  }
  return startObj?.dateTime ?? new Date().toISOString();
}

export function googleEventToItemPatch(
  ev: Record<string, unknown>,
  existing: ItemRow | null,
): Partial<ItemRow> & { payload: ItemRow["payload"] } {
  const startObj = ev.start as { dateTime?: string; date?: string; timeZone?: string };
  const endObj = ev.end as { dateTime?: string; date?: string; timeZone?: string };
  const allDay = Boolean(startObj?.date && !startObj?.dateTime);
  const timeZone = startObj?.timeZone ?? endObj?.timeZone ?? DEFAULT_TIME_ZONE;
  const timedRange = allDay && startObj?.date
    ? googleAllDayRangeToApp(startObj.date, endObj?.date, timeZone)
    : null;
  const start = timedRange?.start_at ??
    (startObj?.dateTime ?? new Date().toISOString());
  const end = timedRange?.end_at ??
    (endObj?.dateTime ?? start);

  const googleUpdated = (ev.updated as string) ?? new Date().toISOString();
  const existingUpdated = existing?.updated_at ?? "1970-01-01T00:00:00.000Z";

  if (existing && new Date(existingUpdated).getTime() > new Date(googleUpdated).getTime() + 2000) {
    return { payload: { ...existing.payload, syncSource: "google" } };
  }

  const recurrence = ev.recurrence as string[] | undefined;
  const recurringEventId = ev.recurringEventId as string | undefined;
  const googleEventId = ev.id as string;
  const seriesId = recurringEventId ?? (recurrence?.length ? googleEventId : undefined);

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
      googleCalendarEventId: googleEventId ?? existing?.payload.googleCalendarEventId,
      googleRecurringSeriesId: seriesId ?? existing?.payload.googleRecurringSeriesId,
      googleRecurrence: recurrence ?? existing?.payload.googleRecurrence,
      googleRecurrenceExceptions: existing?.payload.googleRecurrenceExceptions,
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
      googleTaskId: (task.id as string) ?? existing?.payload.googleTaskId,
      checklist: existing?.payload.checklist ?? [],
      reminders: existing?.payload.reminders ?? [],
    },
    updated_at: googleUpdated,
  };
}
