import type { Item } from "@/types";

/**
 * Prefill draftu itemu z treści wiadomości (CHAT2-LINK).
 * Czysta funkcja — bez zależności od store'ów (testowalna w node).
 */

export type ConvertTarget = "task" | "event";

export function draftFromMessage(
  msg: { body: string },
  target: ConvertTarget,
  authorName: string,
  now: Date = new Date(),
): Partial<Item> {
  const firstLine = msg.body.split("\n")[0]?.trim().slice(0, 120) || "Nowe zadanie";
  const description = `${msg.body.trim()}\n\n— z wiadomości od ${authorName}`;

  if (target === "task") {
    return {
      type: "task",
      title: firstLine,
      description,
      hasDueDate: false,
      showInTodo: true,
      showInCalendar: false,
    };
  }

  // Wydarzenie: najbliższa pełna godzina, blok 1 h.
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3600_000);
  return {
    type: "event",
    title: firstLine,
    description,
    start: start.toISOString(),
    end: end.toISOString(),
    showInCalendar: true,
    showInTodo: false,
  };
}
