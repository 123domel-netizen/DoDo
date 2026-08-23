import { describe, expect, it } from "vitest";
import {
  pointsFromSelectedMessage,
  pointsFromSelection,
  wholePointFromMessage,
} from "@/lib/chat/selectionChecklist";
import type { ChatMessage } from "@/lib/chat/types";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "body" | "id">,
): ChatMessage {
  return {
    conversationId: "c1",
    authorUserId: "u1",
    kind: "text",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyToMessageId: null,
    mentions: [],
    payload: {},
    pinnedAt: null,
    pinnedBy: null,
    threadTitle: null,
    threadArchivedAt: null,
    ...partial,
  };
}

describe("selectionChecklist", () => {
  it("whole = jeden punkt z treści", () => {
    expect(
      pointsFromSelectedMessage(msg({ id: "1", body: "mleko, mąka" }), "whole"),
    ).toEqual(["mleko, mąka"]);
  });

  it("split rozbija przecinki przez parseChecklistPaste", () => {
    expect(
      pointsFromSelectedMessage(
        msg({ id: "1", body: "mleko, mąka, jajka" }),
        "split",
      ),
    ).toEqual(["mleko", "mąka", "jajka"]);
  });

  it("split mini-checklist bierze pozycje z payloadu", () => {
    const m = msg({
      id: "1",
      body: "Testchecklisty :D",
      kind: "checklist",
      payload: {
        checklist: {
          items: [
            { id: "a", text: "abc", done: false },
            { id: "b", text: "123", done: false },
            { id: "c", text: "dasdas", done: true },
          ],
        },
      },
    });
    expect(pointsFromSelectedMessage(m, "whole")).toEqual(["Testchecklisty :D"]);
    expect(pointsFromSelectedMessage(m, "split")).toEqual(["abc", "123", "dasdas"]);
  });

  it("pointsFromSelection zachowuje kolejność i tryby", () => {
    const a = msg({ id: "1", body: "jeden" });
    const b = msg({ id: "2", body: "x, y" });
    expect(
      pointsFromSelection([
        { msg: a, mode: "whole" },
        { msg: b, mode: "split" },
      ]),
    ).toEqual(["jeden", "x", "y"]);
  });

  it("wholePointFromMessage dla głosu", () => {
    expect(
      wholePointFromMessage(msg({ id: "1", body: "", kind: "voice" })),
    ).toBe("🎤 Wiadomość głosowa");
  });
});
