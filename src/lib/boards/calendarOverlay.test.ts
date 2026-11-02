import { describe, expect, it } from "vitest";
import {
  boardDateItemId,
  boardDateItemsFromTopics,
  formatBoardFieldYmd,
  parseBoardDateItemId,
  parseBoardFieldYmd,
  plDisplayToYmd,
  ymdToPlDisplay,
} from "@/lib/boards/calendarOverlay";
import type { Board, BoardField, BoardTopic } from "@/lib/boards/types";

function board(over: Partial<Board> = {}): Board {
  return {
    id: "b1",
    orgId: "o1",
    name: "IB",
    createdBy: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    myRole: "member",
    unreadCount: 0,
    localityEnabled: false,
    defaultTopicView: null,
    defaultTopicViewRev: 0,
    members: [],
    ...over,
  };
}

function field(over: Partial<BoardField> & Pick<BoardField, "id" | "kind">): BoardField {
  return {
    boardId: "b1",
    name: over.name ?? over.id,
    visibility: "all",
    position: 0,
    options: [],
    viewerIds: [],
    ...over,
  };
}

function topic(id: string, over: Partial<BoardTopic> = {}): BoardTopic {
  return {
    id,
    boardId: "b1",
    title: id,
    description: "",
    code: null,
    locality: null,
    parentId: null,
    position: 1,
    createdBy: "u1",
    pinnedAt: null,
    snoozedUntil: null,
    closedAt: null,
    closedBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    conversationId: `c-${id}`,
    lastActivityAt: "2026-01-01T00:00:00Z",
    commentCount: 0,
    unreadCount: 0,
    lastComment: null,
    items: [],
    fieldValues: {},
    ...over,
  };
}

describe("board date overlay helpers", () => {
  it("parsuje id i YMD", () => {
    expect(boardDateItemId("t1", "f1")).toBe("board-date:t1:f1");
    expect(parseBoardDateItemId("board-date:t1:f1")).toEqual({ topicId: "t1", fieldId: "f1" });
    expect(parseBoardFieldYmd("2026-11-02")?.getDate()).toBe(2);
    expect(parseBoardFieldYmd("2026-02-31")).toBeNull();
    expect(formatBoardFieldYmd("2026-11-02")).not.toBe("—");
    expect(ymdToPlDisplay("2026-11-02")).toBe("02.11.2026");
    expect(plDisplayToYmd("2.11.2026")).toBe("2026-11-02");
    expect(plDisplayToYmd("31.02.2026")).toBeNull();
  });

  it("buduje wpisy tylko z otwartych tematów z datą", () => {
    const dateField = field({ id: "due", kind: "date", name: "Termin" });
    const items = boardDateItemsFromTopics({
      boards: [board()],
      fieldsByBoard: { b1: [dateField, field({ id: "note", kind: "text" })] },
      topicsByBoard: {
        b1: [
          topic("open", {
            fieldValues: { due: { text: "2026-11-02", optionIds: [] } },
          }),
          topic("empty"),
          topic("closed", {
            closedAt: "2026-10-01T00:00:00Z",
            fieldValues: { due: { text: "2026-11-03", optionIds: [] } },
          }),
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("board-date:open:due");
    expect(items[0]?.allDay).toBe(true);
    expect(items[0]?.title).toBe("open");
    expect(items[0]?.description).toContain("Termin");
  });
});
