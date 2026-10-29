import type { Item } from "@/types";
import { defaultEventDraftRange } from "@/lib/eventDraft";
import type { BoardTopic, LinkedItemType } from "@/lib/boards/types";

/**
 * Prefill zadania / wydarzenia z tematu Tablicy. Czysta funkcja — element powstaje
 * przez ISTNIEJĄCY edytor (`startDraft`), a Tablice trzymają tylko powiązanie po id.
 */
export function draftFromTopic(
  topic: Pick<BoardTopic, "title" | "description">,
  type: LinkedItemType,
  boardName: string,
  now: Date = new Date(),
): Partial<Item> {
  const title = topic.title.trim().slice(0, 120) || "Nowy element";
  const origin = `— z tematu tablicy „${boardName}”`;
  const description = topic.description.trim()
    ? `${topic.description.trim()}\n\n${origin}`
    : origin;

  if (type === "event") {
    const { start, end } = defaultEventDraftRange(now);
    return {
      type: "event",
      title,
      description,
      start,
      end,
      showInCalendar: true,
      showInTodo: false,
    };
  }
  return {
    type: "task",
    title,
    description,
    hasDueDate: false,
    showInTodo: true,
    showInCalendar: false,
  };
}
