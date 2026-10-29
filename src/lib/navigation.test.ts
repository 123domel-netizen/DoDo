import { describe, expect, it } from "vitest";
import { buildAppHash, parseAppHash, type AppRoute } from "@/lib/navigation";

describe("parseAppHash", () => {
  it("parsuje trasy czatu", () => {
    expect(parseAppHash("#/czat")).toEqual({ view: "chat" });
    expect(parseAppHash("#/czat/abc-123")).toEqual({
      view: "conversation",
      conversationId: "abc-123",
    });
    expect(parseAppHash("#/czat/abc/watek/m9")).toEqual({
      view: "conversation",
      conversationId: "abc",
      threadRootId: "m9",
    });
    expect(parseAppHash("#/wpis/i7")).toEqual({ view: "item", itemId: "i7" });
  });

  it("parsuje trasy Tablic", () => {
    expect(parseAppHash("#/tablice")).toEqual({ view: "board" });
    expect(parseAppHash("#/tablice/b1")).toEqual({ view: "board", boardId: "b1" });
    expect(parseAppHash("#/tablice/b1/t9")).toEqual({
      view: "board",
      boardId: "b1",
      topicId: "t9",
    });
  });

  it("ignoruje hashe nie-trasowe (np. OAuth error)", () => {
    expect(parseAppHash("")).toBeNull();
    expect(parseAppHash("#error=access_denied&error_description=x")).toBeNull();
    expect(parseAppHash("#access_token=abc")).toBeNull();
    expect(parseAppHash("#/nieznane")).toBeNull();
    expect(parseAppHash("#/wpis")).toBeNull();
  });

  it("roundtrip build → parse", () => {
    const routes: AppRoute[] = [
      { view: "chat" },
      { view: "conversation", conversationId: "c1" },
      { view: "conversation", conversationId: "c1", threadRootId: "m1" },
      { view: "item", itemId: "i1" },
      { view: "board" },
      { view: "board", boardId: "b1" },
      { view: "board", boardId: "b1", topicId: "t1" },
    ];
    for (const r of routes) {
      expect(parseAppHash(buildAppHash(r))).toEqual(r);
    }
  });
});
