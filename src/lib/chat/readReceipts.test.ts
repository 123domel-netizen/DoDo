import { describe, expect, it } from "vitest";
import { outboundReadLabel, outboundReadStatus } from "@/lib/chat/readReceipts";
import type { ChatOverviewEntry } from "@/lib/chat/types";

function entry(partial: Partial<ChatOverviewEntry> = {}): ChatOverviewEntry {
  return {
    id: "c1",
    kind: "dm",
    name: null,
    description: null,
    isPublic: false,
    itemId: null,
    createdBy: "me",
    lastMessageAt: "2026-07-17T10:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    iconUrl: null,
    myLastReadAt: "2026-07-17T10:00:00.000Z",
    myNotify: "all",
    myRole: "member",
    myPinnedAt: null,
    myMutedUntil: null,
    myArchivedAt: null,
    myMarkedUnread: false,
    unreadCount: 0,
    lastMessage: {
      id: "m1",
      kind: "text",
      body: "hej",
      authorUserId: "me",
      createdAt: "2026-07-17T10:00:00.000Z",
      deletedAt: null,
    },
    members: [
      { userId: "me", role: "member", displayName: "Ja", avatarUrl: null, lastReadAt: "2026-07-17T10:00:00.000Z" },
      { userId: "u2", role: "member", displayName: "Ola", avatarUrl: null, lastReadAt: null },
    ],
    ...partial,
  };
}

describe("outboundReadStatus", () => {
  it("null gdy ostatnia wiadomość nie jest moja", () => {
    expect(
      outboundReadStatus(
        entry({
          lastMessage: {
            id: "m1",
            kind: "text",
            body: "hej",
            authorUserId: "u2",
            createdAt: "2026-07-17T10:00:00.000Z",
            deletedAt: null,
          },
        }),
        "me",
      ),
    ).toBeNull();
  });

  it("none gdy nikt nie przeczytał", () => {
    expect(outboundReadStatus(entry(), "me")).toBe("none");
  });

  it("all gdy peer przeczytał (DM)", () => {
    expect(
      outboundReadStatus(
        entry({
          members: [
            { userId: "me", role: "member", displayName: "Ja", avatarUrl: null, lastReadAt: null },
            {
              userId: "u2",
              role: "member",
              displayName: "Ola",
              avatarUrl: null,
              lastReadAt: "2026-07-17T10:01:00.000Z",
            },
          ],
        }),
        "me",
      ),
    ).toBe("all");
  });

  it("some gdy część kanału przeczytała", () => {
    expect(
      outboundReadStatus(
        entry({
          kind: "channel",
          members: [
            { userId: "me", role: "member", displayName: "Ja", avatarUrl: null, lastReadAt: null },
            {
              userId: "u2",
              role: "member",
              displayName: "Ola",
              avatarUrl: null,
              lastReadAt: "2026-07-17T10:01:00.000Z",
            },
            { userId: "u3", role: "member", displayName: "Ada", avatarUrl: null, lastReadAt: null },
          ],
        }),
        "me",
      ),
    ).toBe("some");
  });

  it("etykiety", () => {
    expect(outboundReadLabel("all", 1)).toBe("Odczytane");
    expect(outboundReadLabel("all", 3)).toBe("Odczytane przez wszystkich");
    expect(outboundReadLabel("some", 3)).toBe("Odczytane przez część osób");
    expect(outboundReadLabel("none", 1)).toBe("Wysłane");
  });
});
