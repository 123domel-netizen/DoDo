import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addBoardConversationRef,
  clearBoardConversationRefs,
  emitBoardChatEvent,
  filterChatListEntries,
  getBoardConversationRef,
  isChatListConversationKind,
  setBoardChatListener,
  setBoardConversationRefs,
  type BoardChatEvent,
} from "@/lib/chat/boardBridge";
import { mapOverviewRows } from "@/lib/chat/api";
import type { ChatMessage } from "@/lib/chat/types";

function overviewRow(id: string, kind: string) {
  return {
    id,
    kind,
    name: id,
    created_by: "u1",
    created_at: "2026-10-01T10:00:00Z",
    members: [],
  };
}

afterEach(() => {
  clearBoardConversationRefs();
  setBoardChatListener(null);
});

describe("rozdzielenie Tablic od Czatu (selektor u źródła)", () => {
  it("lista Czatu przyjmuje tylko channel / dm / item", () => {
    expect(isChatListConversationKind("channel")).toBe(true);
    expect(isChatListConversationKind("dm")).toBe(true);
    expect(isChatListConversationKind("item")).toBe(true);
    expect(isChatListConversationKind("board_topic")).toBe(false);
    expect(isChatListConversationKind("cokolwiek")).toBe(false);
  });

  it("filterChatListEntries usuwa rozmowy tematów Tablic", () => {
    const out = filterChatListEntries([
      { kind: "dm" as const },
      { kind: "board_topic" as const },
      { kind: "channel" as const },
    ]);
    expect(out.map((e) => e.kind)).toEqual(["dm", "channel"]);
  });

  it("mapOverviewRows nie zwraca board_topic nawet gdy serwer go pośle", () => {
    const entries = mapOverviewRows([
      overviewRow("c1", "channel"),
      overviewRow("c2", "board_topic"),
      overviewRow("c3", "dm"),
      overviewRow("c4", "item"),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["c1", "c3", "c4"]);
  });
});

describe("rejestr rozmów Tablic i szyna zdarzeń", () => {
  it("rozpoznaje rozmowy zarejestrowane jako tematy", () => {
    addBoardConversationRef("c1", { boardId: "b1", topicId: "t1" });
    expect(getBoardConversationRef("c1")).toEqual({ boardId: "b1", topicId: "t1" });
    expect(getBoardConversationRef("c2")).toBeUndefined();
    setBoardConversationRefs([["c9", { boardId: "b9", topicId: "t9" }]]);
    expect(getBoardConversationRef("c1")).toBeUndefined();
    expect(getBoardConversationRef("c9")?.topicId).toBe("t9");
  });

  it("dostarcza zdarzenia do słuchacza i milczy bez słuchacza", () => {
    const seen: BoardChatEvent[] = [];
    const event: BoardChatEvent = {
      type: "message",
      message: { id: "m1" } as ChatMessage,
      ref: { boardId: "b1", topicId: "t1" },
    };
    expect(() => emitBoardChatEvent(event)).not.toThrow();
    const listener = vi.fn((e: BoardChatEvent) => seen.push(e));
    setBoardChatListener(listener);
    emitBoardChatEvent(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBe(event);
  });
});
