import { addDays, addMonths, format, isSameDay, nextMonday, startOfDay } from "date-fns";
import { pl } from "date-fns/locale";
import {
  BOARD_NAME_MAX,
  TOPIC_TITLE_MAX,
  type Board,
  type BoardTopic,
  type GroupedTopics,
  type TopicComment,
  type TopicSection,
} from "@/lib/boards/types";

/**
 * Czysta logika modułu Tablice (bez React/Supabase) — sekcje listy tematów,
 * sortowanie, odkładanie, nazwy i podgląd komentarza.
 */

const SNOOZE_WAKE_HOUR = 8;

function ms(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Temat jest odłożony, dopóki `snoozedUntil` jest w przyszłości (wtedy wraca sam). */
export function isSnoozed(topic: BoardTopic, now: Date): boolean {
  const until = ms(topic.snoozedUntil);
  return until > now.getTime();
}

/**
 * Sekcja tematu. Kolejność reguł: zamknięty > odłożony (aktywna data) > przypięty > aktywny.
 * Odłożenie jest jawną decyzją, więc przypięty temat też znika z góry, gdy go odłożono.
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
  // Stabilna kolejność — lista nie „migocze” przy równych znacznikach czasu.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Podział i sortowanie tematów: przypięte, aktywne (wg aktywności), odłożone, zamknięte. */
export function groupTopics(topics: BoardTopic[], now: Date): GroupedTopics {
  const out: GroupedTopics = { pinned: [], active: [], snoozed: [], closed: [] };
  for (const t of topics) out[topicSection(t, now)].push(t);
  out.pinned.sort(byActivityDesc);
  out.active.sort(byActivityDesc);
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

/** Najbliższa przyszła data powrotu odłożonego tematu (do zaplanowania odświeżenia listy). */
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
// Odkładanie
// ---------------------------------------------------------------------------

export type SnoozePreset = "tomorrow" | "nextWeek" | "month";

export const SNOOZE_PRESET_LABELS: Record<SnoozePreset, string> = {
  tomorrow: "Jutro",
  nextWeek: "Przyszły tydzień",
  month: "Za miesiąc",
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

/** Data `YYYY-MM-DD` z pola daty → moment powrotu; null gdy niepoprawna lub nie w przyszłości. */
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
// Tytuły i nazwy
// ---------------------------------------------------------------------------

/** Tytuł tematu / tablicy: przycięte, zwinięte białe znaki; null = pusty (nie wysyłamy). */
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

function firstName(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "";
  if (t.includes("@")) return t.split("@")[0]!;
  return t.split(/\s+/)[0]!;
}

/** Propozycja nazwy z uczestników: „Jacek + Dominik”, przy więcej niż 3 osobach „A + B + C +2”. */
export function defaultBoardName(displayNames: string[]): string {
  const names = displayNames.map(firstName).filter(Boolean);
  if (names.length === 0) return "Nowa tablica";
  const head = names.slice(0, 3).join(" + ");
  const rest = names.length - 3;
  return normalizeBoardName(rest > 0 ? `${head} +${rest}` : head) ?? "Nowa tablica";
}

// ---------------------------------------------------------------------------
// Nieprzeczytane i podgląd
// ---------------------------------------------------------------------------

/**
 * Unread tematu z uwzględnieniem lokalnego „przeczytałem” (zanim RPC odczytu
 * wróci z serwera) — brak błysku licznika po otwarciu tematu.
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
      return "Wiadomość głosowa";
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

/** Jednowierszowy podgląd komentarza na liście tematów. */
export function commentPreviewText(comment: TopicComment): string {
  const body = comment.body.replace(/\s+/g, " ").trim();
  const label = kindLabel(comment.kind);
  const text = label ? (body ? `${label}: ${body}` : label) : body || "(załącznik)";
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

/** Komentarz do zamkniętego tematu otwiera go ponownie. */
export function shouldReopenOnComment(topic: BoardTopic): boolean {
  return Boolean(topic.closedAt);
}

/** Krótki znacznik aktywności: godzina (dziś), wczoraj, "12 paź", "12 paź 2025". */
export function formatTopicTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isSameDay(d, now)) return format(d, "HH:mm");
  if (isSameDay(d, addDays(now, -1))) return "wczoraj";
  return format(d, d.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy", {
    locale: pl,
  });
}
