import { describe, expect, it } from "vitest";
import {
  plainTextFromMessage,
  plainTextFromSelectedMessages,
} from "@/lib/chat/selectionCopy";
import type { ChatAttachment, ChatMessage } from "@/lib/chat/types";

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "body" | "createdAt">,
): ChatMessage {
  return {
    conversationId: "c1",
    authorUserId: "u1",
    kind: "text",
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

const att = (fileName: string): ChatAttachment => ({
  id: "a1",
  messageId: "1",
  bucketPath: "x",
  thumbPath: null,
  fileName,
  mimeType: "application/pdf",
  sizeBytes: 10,
  width: null,
  height: null,
});

describe("selectionCopy", () => {
  it("kopiuje treść i wzmiankę o załączniku", () => {
    expect(
      plainTextFromMessage(
        msg({
          id: "1",
          body: "hej",
          createdAt: "2026-01-01T10:00:00.000Z",
          attachments: [att("plan.pdf")],
        }),
      ),
    ).toBe("hej\n[załącznik: plan.pdf]");
  });

  it("sortuje po createdAt, nie kolejności zaznaczenia", () => {
    const later = msg({
      id: "2",
      body: "druga",
      createdAt: "2026-01-02T10:00:00.000Z",
    });
    const earlier = msg({
      id: "1",
      body: "pierwsza",
      createdAt: "2026-01-01T10:00:00.000Z",
    });
    expect(plainTextFromSelectedMessages([later, earlier])).toBe(
      "pierwsza\n\ndruga",
    );
  });

  it("checklist: tytuł + punkty", () => {
    expect(
      plainTextFromMessage(
        msg({
          id: "1",
          body: "Lista",
          createdAt: "2026-01-01T10:00:00.000Z",
          kind: "checklist",
          payload: {
            checklist: {
              items: [
                { id: "a", text: "abc", done: false },
                { id: "b", text: "xyz", done: true },
              ],
            },
          },
        }),
      ),
    ).toBe("Lista\n[ ] abc\n[x] xyz");
  });
});
