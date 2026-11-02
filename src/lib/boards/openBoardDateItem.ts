import { parseBoardDateItemId } from "@/lib/boards/calendarOverlay";
import { navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";

/** Otwiera temat tablicy z syntetycznego wpisu kalendarza `board-date:…`. */
export function openBoardDateItem(id: string): boolean {
  const parsed = parseBoardDateItemId(id);
  if (!parsed) return false;
  const topicsByBoard = useBoardsStore.getState().topicsByBoard;
  for (const [boardId, list] of Object.entries(topicsByBoard)) {
    if (list.some((t) => t.id === parsed.topicId)) {
      navigateToBoards({ boardId, topicId: parsed.topicId }, "push");
      return true;
    }
  }
  return false;
}
