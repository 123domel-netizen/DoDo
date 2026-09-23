import { coerceItemType, isValidIso } from "@/lib/dates";
import { uid } from "@/lib/factory";
import type { Item, ItemType } from "@/types";
import type { CanonicalItem } from "@/lib/syncv3/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function ensureUuid(id: string | undefined | null): string {
  if (id && isUuid(id)) return id;
  return uid();
}

/**
 * Jeden kanoniczny normalizator — create, migracja, outbox, push, pull.
 * Legacy bez type: deterministycznie event|task; nie kasuje rekordu.
 */
export function normalizeToCanonical(
  raw: Partial<Item> & { id?: string },
  opts?: { localRevision?: number; ownerUserId?: string | null },
): CanonicalItem {
  const type: ItemType = coerceItemType({
    type: raw.type as ItemType,
    showInTodo: Boolean(raw.showInTodo),
    showInCalendar: Boolean(raw.showInCalendar),
  });
  const now = new Date().toISOString();
  const start =
    typeof raw.start === "string" && isValidIso(raw.start) ? raw.start : now;
  const end =
    typeof raw.end === "string" && isValidIso(raw.end) ? raw.end : start;

  return {
    id: ensureUuid(raw.id),
    type,
    title: typeof raw.title === "string" ? raw.title : raw.title == null ? "" : String(raw.title),
    description:
      typeof raw.description === "string"
        ? raw.description
        : raw.description == null
          ? ""
          : String(raw.description),
    start,
    end,
    allDay: Boolean(raw.allDay),
    groupId: raw.groupId ?? null,
    showInCalendar: raw.showInCalendar ?? type === "event",
    showInTodo: raw.showInTodo ?? type === "task",
    done: Boolean(raw.done),
    hasDueDate: raw.hasDueDate ?? type === "event",
    checklist: Array.isArray(raw.checklist) ? raw.checklist : [],
    participants: Array.isArray(raw.participants) ? raw.participants : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
    deadlineAt: raw.deadlineAt ?? null,
    recurrence: raw.recurrence ?? null,
    tagIds: Array.isArray(raw.tagIds) ? raw.tagIds : [],
    pinnedAt: raw.pinnedAt ?? null,
    preArchiveGroupId: raw.preArchiveGroupId ?? null,
    groupPromptDismissed: Boolean(raw.groupPromptDismissed),
    shareRole: raw.shareRole === "participant" ? "participant" : "owner",
    ownerUserId: opts?.ownerUserId ?? raw.ownerUserId ?? null,
    deletedAt: raw.deletedAt ?? null,
    deletedBy: raw.deletedBy ?? null,
    personalReminders: raw.personalReminders,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    localRevision: opts?.localRevision ?? 1,
  };
}

export function canonicalToItem(c: CanonicalItem): Item {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    description: c.description,
    start: c.start,
    end: c.end,
    allDay: c.allDay,
    groupId: c.groupId,
    showInCalendar: c.showInCalendar,
    showInTodo: c.showInTodo,
    done: c.done,
    hasDueDate: c.hasDueDate,
    checklist: c.checklist,
    participants: c.participants,
    attachments: c.attachments,
    reminders: c.reminders,
    deadlineAt: c.deadlineAt,
    recurrence: c.recurrence,
    tagIds: c.tagIds,
    pinnedAt: c.pinnedAt,
    preArchiveGroupId: c.preArchiveGroupId,
    groupPromptDismissed: c.groupPromptDismissed,
    shareRole: c.shareRole,
    ownerUserId: c.ownerUserId ?? undefined,
    deletedAt: c.deletedAt,
    deletedBy: c.deletedBy,
    personalReminders: c.personalReminders,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export type CanonicalValidation =
  | { ok: true; item: CanonicalItem }
  | { ok: false; code: string; message: string };

/** Walidacja przed push — nowy item bez type nie przechodzi (po normalize type zawsze jest). */
export function validateCanonicalForPush(item: CanonicalItem): CanonicalValidation {
  if (!isUuid(item.id)) {
    return { ok: false, code: "invalid_id", message: "item.id must be UUID" };
  }
  if (item.type !== "event" && item.type !== "task") {
    return { ok: false, code: "invalid_type", message: "type must be event|task" };
  }
  if (typeof item.title !== "string") {
    return { ok: false, code: "invalid_title", message: "title must be string" };
  }
  if (!isValidIso(item.start) || !isValidIso(item.end)) {
    return { ok: false, code: "invalid_dates", message: "start/end must be ISO" };
  }
  if (!isValidIso(item.updatedAt)) {
    return { ok: false, code: "invalid_updated_at", message: "updated_at must be ISO" };
  }
  return { ok: true, item };
}

/** Payload wiersza Supabase — bez undefined. */
export function canonicalToSupabaseRow(
  item: CanonicalItem,
  authUserId: string,
): Record<string, unknown> {
  return {
    id: item.id,
    user_id: authUserId,
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
      deadlineAt: item.deadlineAt,
      hasDueDate: item.hasDueDate,
      preArchiveGroupId: item.preArchiveGroupId,
      tagIds: item.tagIds,
      recurrence: item.recurrence,
      pinnedAt: item.pinnedAt,
      groupPromptDismissed: item.groupPromptDismissed,
    },
    deleted_at: item.deletedAt,
    deleted_by: item.deletedBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

/** Czy lokalny snapshot jest nowszy niż remote — chroni przed stale retry. */
export function isStaleAgainstRemote(
  localUpdatedAt: string,
  remoteUpdatedAt: string | null | undefined,
): boolean {
  if (!remoteUpdatedAt || !isValidIso(remoteUpdatedAt)) return false;
  return new Date(localUpdatedAt).getTime() < new Date(remoteUpdatedAt).getTime();
}
