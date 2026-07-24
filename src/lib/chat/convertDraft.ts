import type { ChecklistItem, Item } from "@/types";
import type { ChatChecklistItem, MessageKind, MessagePayload } from "@/lib/chat/types";
import { uid } from "@/lib/factory";

/**
 * Prefill draftu itemu z treści wiadomości (CHAT2-LINK / CHAT5).
 * Czysta funkcja — bez zależności od store'ów (testowalna w node).
 */

export type ConvertTarget = "task" | "event" | "checklist";

export interface DraftMessageSource {
  body: string;
  kind?: MessageKind;
  payload?: MessagePayload;
}

/** Linie wiadomości jako pozycje checklisty (zdjęte wypunktowania). */
export function checklistLinesFromBody(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim().replace(/^([-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function checklistFromMiniPayload(
  items: ChatChecklistItem[] | undefined,
): ChecklistItem[] | null {
  if (!items?.length) return null;
  return items.map((it) => ({
    id: uid(),
    text: it.text.trim().slice(0, 200) || "…",
    done: Boolean(it.done),
  }));
}

export function draftFromMessage(
  msg: DraftMessageSource,
  target: ConvertTarget,
  authorName: string,
  now: Date = new Date(),
): Partial<Item> {
  const firstLine = msg.body.split("\n")[0]?.trim().slice(0, 120) || "Nowe zadanie";
  const description = `${msg.body.trim()}\n\n— z wiadomości od ${authorName}`;
  const miniChecklist = checklistFromMiniPayload(msg.payload?.checklist?.items);
  const isMini = msg.kind === "checklist" && Boolean(miniChecklist?.length);

  if (target === "task") {
    return {
      type: "task",
      title: isMini ? firstLine || "Checklista" : firstLine,
      description: isMini
        ? `— z mini-checklisty od ${authorName}`
        : description,
      hasDueDate: false,
      showInTodo: true,
      showInCalendar: false,
      ...(miniChecklist ? { checklist: miniChecklist } : {}),
    };
  }

  if (target === "checklist") {
    if (miniChecklist?.length) {
      return {
        type: "task",
        title: firstLine || "Checklista",
        description: `— z mini-checklisty od ${authorName}`,
        hasDueDate: false,
        showInTodo: true,
        showInCalendar: false,
        checklist: miniChecklist,
      };
    }
    const lines = checklistLinesFromBody(msg.body);
    // Pierwsza linia jako tytuł, gdy wygląda na nagłówek listy (a nie punkt).
    const rawFirst = msg.body.split("\n")[0]?.trim() ?? "";
    const firstIsHeader =
      lines.length > 1 && /^[^-*•\d]/.test(rawFirst) && rawFirst.endsWith(":");
    const items = firstIsHeader ? lines.slice(1) : lines;
    const checklist: ChecklistItem[] = (items.length ? items : lines).map((text) => ({
      id: uid(),
      text: text.slice(0, 200),
      done: false,
    }));
    return {
      type: "task",
      title: firstIsHeader
        ? rawFirst.replace(/:$/, "").slice(0, 120)
        : firstLine.slice(0, 120) || "Checklista",
      description: `— z wiadomości od ${authorName}`,
      hasDueDate: false,
      showInTodo: true,
      showInCalendar: false,
      checklist,
    };
  }

  // Wydarzenie: najbliższa pełna godzina, blok 1 h.
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3600_000);
  return {
    type: "event",
    title: isMini ? firstLine || "Checklista" : firstLine,
    description: isMini
      ? `— z mini-checklisty od ${authorName}`
      : description,
    start: start.toISOString(),
    end: end.toISOString(),
    showInCalendar: true,
    showInTodo: false,
    ...(miniChecklist ? { checklist: miniChecklist } : {}),
  };
}
