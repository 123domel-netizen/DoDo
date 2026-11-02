import { addDays } from "date-fns";
import { noonAnchorFromCalendarDate } from "@/lib/allDay";
import type { Board, BoardField, BoardTopic } from "@/lib/boards/types";
import type { Item } from "@/types";

export const BOARD_DATE_ITEM_PREFIX = "board-date:";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isBoardDateItemId(id: string): boolean {
  return id.startsWith(BOARD_DATE_ITEM_PREFIX);
}

export function boardDateItemId(topicId: string, fieldId: string): string {
  return `${BOARD_DATE_ITEM_PREFIX}${topicId}:${fieldId}`;
}

export function parseBoardDateItemId(
  id: string,
): { topicId: string; fieldId: string } | null {
  if (!isBoardDateItemId(id)) return null;
  const rest = id.slice(BOARD_DATE_ITEM_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { topicId: rest.slice(0, sep), fieldId: rest.slice(sep + 1) };
}

/** Lokalna data z ISO kalendarzowego `YYYY-MM-DD` (bez przesunięć strefy). */
export function parseBoardFieldYmd(raw: string | null | undefined): Date | null {
  const t = raw?.trim() ?? "";
  if (!YMD_RE.test(t)) return null;
  const [ys, ms, ds] = t.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function formatBoardFieldYmd(raw: string | null | undefined): string {
  const d = parseBoardFieldYmd(raw);
  if (!d) return "—";
  return d.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `YYYY-MM-DD` → `dd.mm.rrrr` (pusty string gdy niepoprawne). */
export function ymdToPlDisplay(raw: string | null | undefined): string {
  const d = parseBoardFieldYmd(raw);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** `dd.mm.rrrr` / `d.m.rrrr` (też `-` i `/`) → `YYYY-MM-DD` albo null. */
export function plDisplayToYmd(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return parseBoardFieldYmd(ymd) ? ymd : null;
}

/**
 * Syntetyczne całodniowe wpisy kalendarza z pól `date` na tematach.
 * Zamknięte tematy pomijamy; snoozed zostają (data nadal obowiązuje).
 */
export function boardDateItemsFromTopics(input: {
  boards: Board[];
  topicsByBoard: Record<string, BoardTopic[]>;
  fieldsByBoard: Record<string, BoardField[]>;
}): Item[] {
  const out: Item[] = [];
  const now = new Date().toISOString();

  for (const board of input.boards) {
    const fields = (input.fieldsByBoard[board.id] ?? []).filter((f) => f.kind === "date");
    if (fields.length === 0) continue;
    const topics = input.topicsByBoard[board.id] ?? [];
    for (const topic of topics) {
      if (topic.closedAt) continue;
      for (const field of fields) {
        const day = parseBoardFieldYmd(topic.fieldValues[field.id]?.text);
        if (!day) continue;
        const start = noonAnchorFromCalendarDate(day);
        const end = noonAnchorFromCalendarDate(addDays(day, 1));
        const id = boardDateItemId(topic.id, field.id);
        out.push({
          id,
          type: "event",
          title: topic.title,
          description: `${board.name} · ${field.name}`,
          start,
          end,
          allDay: true,
          groupId: null,
          showInCalendar: true,
          showInTodo: false,
          done: false,
          hasDueDate: true,
          checklist: [],
          participants: [],
          attachments: [],
          reminders: [],
          createdAt: topic.createdAt || now,
          updatedAt: topic.updatedAt || now,
        });
      }
    }
  }
  return out;
}
