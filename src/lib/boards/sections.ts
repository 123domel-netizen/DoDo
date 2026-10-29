import { addDays, addMonths, format, isSameDay, nextMonday, startOfDay } from "date-fns";
import { pl } from "date-fns/locale";
import {
  BOARD_NAME_MAX,
  TOPIC_CODE_MAX,
  TOPIC_TITLE_MAX,
  type Board,
  type BoardTopic,
  type GroupedTopics,
  type TopicComment,
  type TopicItemLink,
  type TopicSection,
} from "@/lib/boards/types";
import { isItemDeleted } from "@/lib/items";
import type { Item } from "@/types";

/**
 * Czysta logika modu?u Tablice (bez React/Supabase) ? sekcje listy temat�w,
 * sortowanie, odk?adanie, nazwy i podgl?d komentarza.
 */

const SNOOZE_WAKE_HOUR = 8;

function ms(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Temat jest od?o?ony, dop�ki `snoozedUntil` jest w przysz?o?ci (wtedy wraca sam). */
export function isSnoozed(topic: BoardTopic, now: Date): boolean {
  const until = ms(topic.snoozedUntil);
  return until > now.getTime();
}

/**
 * Sekcja tematu. Kolejno?? regu?: zamkni?ty > od?o?ony (aktywna data) > przypi?ty > aktywny.
 * Od?o?enie jest jawn? decyzj?, wi?c przypi?ty temat te? znika z g�ry, gdy go od?o?ono.
 */
export function topicSection(topic: BoardTopic, now: Date): TopicSection {
  if (topic.closedAt) return "closed";
  if (isSnoozed(topic, now)) return "snoozed";
  if (topic.pinnedAt) return "pinned";
  return "active";
}

function byActivityDesc(a: BoardTopic, b: BoardTopic): number {
  const d = ms(b.lastActivityAt) - ms(a.lastActivityAt);
  if (d !== 0) return d;
  const c = ms(b.createdAt) - ms(a.createdAt);
  if (c !== 0) return c;
  // Stabilna kolejno?? ? lista nie ?migocze? przy r�wnych znacznikach czasu.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** R?czna kolejno?? (position rosn?co), potem createdAt / id. */
export function byPositionAsc(a: BoardTopic, b: BoardTopic): number {
  if (a.position !== b.position) return a.position - b.position;
  const c = ms(a.createdAt) - ms(b.createdAt);
  if (c !== 0) return c;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Podzia? i sortowanie: przypi?te/aktywne wg position; od?o?one/zamkni?te jak wcze?niej. */
export function groupTopics(topics: BoardTopic[], now: Date): GroupedTopics {
  const out: GroupedTopics = { pinned: [], active: [], snoozed: [], closed: [] };
  for (const t of topics) out[topicSection(t, now)].push(t);
  out.pinned.sort(byPositionAsc);
  out.active.sort(byPositionAsc);
  out.snoozed.sort((a, b) => {
    const d = ms(a.snoozedUntil) - ms(b.snoozedUntil);
    return d !== 0 ? d : byActivityDesc(a, b);
  });
  out.closed.sort((a, b) => {
    const d = ms(b.closedAt) - ms(a.closedAt);
    return d !== 0 ? d : byActivityDesc(a, b);
  });
  return out;
}

/**
 * Pe?na kolejno?? tablicy po DnD w jednej sekcji: pinned + active (z now? kolejno?ci?
 * w tej sekcji) + snoozed/closed bez zmian wzgl?dnych. Przy niesp�jnej permutacji
 * zwraca obecn? kolejno?? (no-op dla RPC).
 */
export function fullOrderAfterSectionReorder(
  topics: BoardTopic[],
  now: Date,
  section: "pinned" | "active",
  reorderedSectionIds: string[],
): string[] {
  const grouped = groupTopics(topics, now);
  const currentOrder = () =>
    [...grouped.pinned, ...grouped.active, ...grouped.snoozed, ...grouped.closed].map((t) => t.id);

  const expected = grouped[section].map((t) => t.id);
  const sectionSet = new Set(reorderedSectionIds);
  if (
    reorderedSectionIds.length !== expected.length ||
    expected.some((id) => !sectionSet.has(id))
  ) {
    return currentOrder();
  }

  const byId = new Map(topics.map((t) => [t.id, t]));
  const reordered = reorderedSectionIds
    .map((id) => byId.get(id))
    .filter((t): t is BoardTopic => Boolean(t));

  if (section === "pinned") {
    return [...reordered, ...grouped.active, ...grouped.snoozed, ...grouped.closed].map((t) => t.id);
  }
  return [...grouped.pinned, ...reordered, ...grouped.snoozed, ...grouped.closed].map((t) => t.id);
}

/** Najbli?sza przysz?a data powrotu od?o?onego tematu (do zaplanowania od?wie?enia listy). */
export function nextSnoozeWake(topics: BoardTopic[], now: Date): Date | null {
  let best = Infinity;
  for (const t of topics) {
    if (t.closedAt) continue;
    const until = ms(t.snoozedUntil);
    if (until > now.getTime() && until < best) best = until;
  }
  return Number.isFinite(best) ? new Date(best) : null;
}

// ---------------------------------------------------------------------------
// Odk?adanie
// ---------------------------------------------------------------------------

export type SnoozePreset = "tomorrow" | "nextWeek" | "month";

export const SNOOZE_PRESET_LABELS: Record<SnoozePreset, string> = {
  tomorrow: "Jutro",
  nextWeek: "Przysz\u0142y tydzie\u0144",
  month: "Za miesi\u0105c",
};

function wakeAt(day: Date): Date {
  const d = startOfDay(day);
  d.setHours(SNOOZE_WAKE_HOUR, 0, 0, 0);
  return d;
}

/** Data powrotu tematu dla presetu (zawsze rano czasu lokalnego). */
export function snoozeUntilForPreset(preset: SnoozePreset, now: Date): Date {
  switch (preset) {
    case "tomorrow":
      return wakeAt(addDays(now, 1));
    case "nextWeek":
      return wakeAt(nextMonday(now));
    case "month":
      return wakeAt(addMonths(now, 1));
  }
}

/** Data `YYYY-MM-DD` z pola daty ? moment powrotu; null gdy niepoprawna lub nie w przysz?o?ci. */
export function snoozeUntilForDate(isoDate: string, now: Date): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(y, mo - 1, d);
  if (
    Number.isNaN(day.getTime()) ||
    day.getFullYear() !== y ||
    day.getMonth() !== mo - 1 ||
    day.getDate() !== d
  ) {
    return null;
  }
  const at = wakeAt(day);
  return at.getTime() > now.getTime() ? at : null;
}

// ---------------------------------------------------------------------------
// Tytu?y i nazwy
// ---------------------------------------------------------------------------

/** Tytu? tematu / tablicy: przyci?te, zwini?te bia?e znaki; null = pusty (nie wysy?amy). */
export function normalizeTopicTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, TOPIC_TITLE_MAX);
}

export function normalizeBoardName(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, BOARD_NAME_MAX);
}

/**
 * Kod tematu: trim, max 16; pusty ? null (clear). Nie waliduje unikalno?ci (to baza).
 */
export function normalizeTopicCode(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, TOPIC_CODE_MAX);
}

/** Linki do zada?/wydarze?, kt�re nadal istniej? i nie s? soft-delete. */
export function visibleTopicItems(
  links: TopicItemLink[],
  itemsById: Record<string, Item | undefined>,
): TopicItemLink[] {
  return links.filter((link) => {
    const item = itemsById[link.itemId];
    return Boolean(item) && !isItemDeleted(item!);
  });
}

/** Linki wskazuj?ce na usuni?te (tombstone) ? do auto-unlink. */
export function deletedTopicItemIds(
  links: TopicItemLink[],
  itemsById: Record<string, Item | undefined>,
): string[] {
  const out: string[] = [];
  for (const link of links) {
    const item = itemsById[link.itemId];
    if (item && isItemDeleted(item)) out.push(link.itemId);
  }
  return out;
}

function firstName(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "";
  if (t.includes("@")) return t.split("@")[0]!;
  return t.split(/\s+/)[0]!;
}

/** Propozycja nazwy z uczestnik�w: ?Jacek + Dominik?, przy wi?cej ni? 3 osobach ?A + B + C +2?. */
export function defaultBoardName(displayNames: string[]): string {
  const names = displayNames.map(firstName).filter(Boolean);
  if (names.length === 0) return "Nowa tablica";
  const head = names.slice(0, 3).join(" + ");
  const rest = names.length - 3;
  return normalizeBoardName(rest > 0 ? `${head} +${rest}` : head) ?? "Nowa tablica";
}

// ---------------------------------------------------------------------------
// Nieprzeczytane i podgl?d
// ---------------------------------------------------------------------------

/**
 * Unread tematu z uwzgl?dnieniem lokalnego ?przeczyta?em? (zanim RPC odczytu
 * wr\u00f3ci z serwera) ? brak b?ysku licznika po otwarciu tematu.
 */
export function effectiveUnread(topic: BoardTopic, locallyReadAtMs: number | undefined): number {
  if (topic.unreadCount <= 0) return 0;
  if (locallyReadAtMs !== undefined) {
    const last = topic.lastComment ? ms(topic.lastComment.createdAt) : 0;
    if (last <= locallyReadAtMs) return 0;
  }
  return topic.unreadCount;
}

export function totalUnread(boards: Board[]): number {
  let n = 0;
  for (const b of boards) n += b.unreadCount;
  return n;
}

const PREVIEW_MAX = 140;

function kindLabel(kind: string): string | null {
  switch (kind) {
    case "gif":
      return "GIF";
    case "voice":
      return "Wiadomo\u015b\u0107 g\u0142osowa";
    case "poll":
      return "Ankieta";
    case "gallery":
      return "Galeria";
    case "checklist":
      return "Checklista";
    default:
      return null;
  }
}

/** Jednowierszowy podgl?d komentarza na li?cie temat�w. */
export function commentPreviewText(comment: TopicComment): string {
  const body = comment.body.replace(/\s+/g, " ").trim();
  const label = kindLabel(comment.kind);
  const text = label ? (body ? `${label}: ${body}` : label) : body || "(za\u0142\u0105cznik)";
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}\u2026` : text;
}

/** Komentarz do zamkni?tego tematu otwiera go ponownie. */
export function shouldReopenOnComment(topic: BoardTopic): boolean {
  return Boolean(topic.closedAt);
}

/** Kr�tki znacznik aktywno?ci: godzina (dzi?), wczoraj, "12 pa?", "12 pa? 2025". */
export function formatTopicTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isSameDay(d, now)) return format(d, "HH:mm");
  if (isSameDay(d, addDays(now, -1))) return "wczoraj";
  return format(d, d.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy", {
    locale: pl,
  });
}
