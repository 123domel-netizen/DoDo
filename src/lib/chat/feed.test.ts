import { describe, expect, it } from "vitest";
import {
  applyFocusIncoming,
  applyMessageToOverview,
  defaultThreadTitle,
  isMuted,
  markOverviewRead,
  mergeMessages,
  overviewTitle,
  reconcilePinnedList,
  sortOverview,
  threadDisplayTitle,
  totalUnread,
  trimList,
  upsertMessageInList,
} from "@/lib/chat/feed";
import type { ChatMessage, ChatOverviewEntry, FocusFeed } from "@/lib/chat/types";

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    conversationId: "c1",
    authorUserId: "u1",
    kind: "text",
    body: "test",
    payload: {},
    mentions: [],
    threadRootId: null,
    replyToMessageId: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    pinnedBy: null,
    threadTitle: null,
    ...partial,
  };
}

function entry(partial: Partial<ChatOverviewEntry>): ChatOverviewEntry {
  return {
    id: "c1",
    kind: "channel",
    name: "Dom",
    description: null,
    isPublic: false,
    itemId: null,
    createdBy: "u1",
    lastMessageAt: "2026-07-17T09:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    myLastReadAt: "2026-07-17T09:00:00.000Z",
    myNotify: "all",
    myRole: "member",
    myPinnedAt: null,
    myMutedUntil: null,
    myMarkedUnread: false,
    unreadCount: 0,
    lastMessage: null,
    members: [],
    ...partial,
  };
}

describe("upsertMessageInList", () => {
  it("wstawia w porządku createdAt", () => {
    const a = msg({ id: "a", createdAt: "2026-07-17T10:00:00.000Z" });
    const c = msg({ id: "c", createdAt: "2026-07-17T12:00:00.000Z" });
    const b = msg({ id: "b", createdAt: "2026-07-17T11:00:00.000Z" });
    const list = upsertMessageInList(upsertMessageInList([a], c), b);
    expect(list.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("podmienia po id zachowując znane links/attachments", () => {
    const original = msg({
      id: "a",
      links: [{ itemId: "i1", kind: "created_from" }],
      attachments: [],
      sendState: "pending",
    });
    // event realtime bez zagnieżdżeń
    const fromServer = msg({ id: "a", body: "po edycji" });
    const list = upsertMessageInList([original], fromServer);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("po edycji");
    expect(list[0].links).toEqual([{ itemId: "i1", kind: "created_from" }]);
    expect(list[0].sendState).toBeUndefined();
  });

  it("mergeMessages jest idempotentne", () => {
    const a = msg({ id: "a" });
    const b = msg({ id: "b", createdAt: "2026-07-17T11:00:00.000Z" });
    const once = mergeMessages([], [a, b]);
    const twice = mergeMessages(once, [a, b]);
    expect(twice.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("trimList zostawia ogon", () => {
    const list = [msg({ id: "a" }), msg({ id: "b" }), msg({ id: "c" })];
    expect(trimList(list, 2).map((m) => m.id)).toEqual(["b", "c"]);
  });
});

describe("applyMessageToOverview", () => {
  const base = { myUserId: "me", activeConversationId: null, documentVisible: true };

  it("bije unread dla cudzej wiadomości w nieaktywnej rozmowie", () => {
    const incoming = msg({ authorUserId: "other", createdAt: "2026-07-17T10:00:00.000Z" });
    const { overview, known } = applyMessageToOverview([entry({})], incoming, base);
    expect(known).toBe(true);
    expect(overview[0].unreadCount).toBe(1);
    expect(overview[0].lastMessage?.id).toBe("m1");
    expect(overview[0].lastMessageAt).toBe(incoming.createdAt);
  });

  it("nie bije unread dla własnych wiadomości", () => {
    const incoming = msg({ authorUserId: "me" });
    const { overview } = applyMessageToOverview([entry({})], incoming, base);
    expect(overview[0].unreadCount).toBe(0);
    expect(overview[0].lastMessage?.id).toBe("m1");
  });

  it("nie bije unread w aktywnej, widocznej rozmowie", () => {
    const incoming = msg({ authorUserId: "other" });
    const { overview } = applyMessageToOverview([entry({})], incoming, {
      ...base,
      activeConversationId: "c1",
    });
    expect(overview[0].unreadCount).toBe(0);
  });

  it("bije unread w aktywnej rozmowie gdy karta niewidoczna", () => {
    const incoming = msg({ authorUserId: "other" });
    const { overview } = applyMessageToOverview([entry({})], incoming, {
      ...base,
      activeConversationId: "c1",
      documentVisible: false,
    });
    expect(overview[0].unreadCount).toBe(1);
  });

  it("odpowiedź w wątku nie zmienia lastMessage ani unread", () => {
    const incoming = msg({ authorUserId: "other", threadRootId: "root" });
    const prev = entry({ lastMessage: null });
    const { overview } = applyMessageToOverview([prev], incoming, base);
    expect(overview[0].unreadCount).toBe(0);
    expect(overview[0].lastMessage).toBeNull();
  });

  it("nieznana rozmowa → known=false", () => {
    const incoming = msg({ conversationId: "nieznana" });
    const { known } = applyMessageToOverview([entry({})], incoming, base);
    expect(known).toBe(false);
  });

  it("sortuje rozmowy po ostatniej wiadomości", () => {
    const older = entry({ id: "c1", lastMessageAt: "2026-07-17T08:00:00.000Z" });
    const newer = entry({ id: "c2", lastMessageAt: "2026-07-17T09:30:00.000Z" });
    const incoming = msg({
      conversationId: "c1",
      authorUserId: "other",
      createdAt: "2026-07-17T10:00:00.000Z",
    });
    const { overview } = applyMessageToOverview([newer, older], incoming, base);
    expect(overview.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("markOverviewRead / totalUnread", () => {
  it("zeruje unread i podbija lastRead tylko w przód", () => {
    const list = [
      entry({ id: "c1", unreadCount: 3, myLastReadAt: "2026-07-17T09:00:00.000Z" }),
      entry({ id: "c2", unreadCount: 2 }),
    ];
    const next = markOverviewRead(list, "c1", "2026-07-17T10:00:00.000Z");
    expect(next[0].unreadCount).toBe(0);
    expect(next[0].myLastReadAt).toBe("2026-07-17T10:00:00.000Z");
    expect(next[1].unreadCount).toBe(2);
    expect(totalUnread(next)).toBe(2);
  });

  it("markOverviewRead czyści też ręczne oznaczenie nieprzeczytanej", () => {
    const list = [entry({ id: "c1", unreadCount: 0, myMarkedUnread: true })];
    const next = markOverviewRead(list, "c1", "2026-07-17T10:00:00.000Z");
    expect(next[0].myMarkedUnread).toBe(false);
  });

  it("totalUnread liczy ręcznie oznaczone jako 1 przy zerowym liczniku", () => {
    const list = [
      entry({ id: "c1", unreadCount: 0, myMarkedUnread: true }),
      entry({ id: "c2", unreadCount: 4, myMarkedUnread: true }),
    ];
    // c1: brak licznika, ale marked → +1; c2: 4 (marked nie dublował)
    expect(totalUnread(list)).toBe(5);
  });
});

describe("isMuted / sortOverview", () => {
  it("isMuted: infinity zawsze, przyszła data tak, przeszła nie", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    expect(isMuted(entry({ myMutedUntil: "infinity" }), now)).toBe(true);
    expect(isMuted(entry({ myMutedUntil: "2026-07-17T13:00:00.000Z" }), now)).toBe(true);
    expect(isMuted(entry({ myMutedUntil: "2026-07-17T11:00:00.000Z" }), now)).toBe(false);
    expect(isMuted(entry({ myMutedUntil: null }), now)).toBe(false);
  });

  it("sortOverview: przypięte na górze, wewnątrz po aktywności", () => {
    const list = [
      entry({ id: "a", lastMessageAt: "2026-07-17T08:00:00.000Z" }),
      entry({
        id: "b",
        lastMessageAt: "2026-07-17T07:00:00.000Z",
        myPinnedAt: "2026-07-17T00:00:00.000Z",
      }),
      entry({ id: "c", lastMessageAt: "2026-07-17T09:00:00.000Z" }),
    ];
    expect(sortOverview(list).map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
});

describe("overviewTitle", () => {
  it("kanał → nazwa; item → tytuł itemu; dm → pozostali członkowie", () => {
    expect(overviewTitle(entry({ kind: "channel", name: "Budowa" }), "me", () => undefined)).toBe(
      "Budowa",
    );
    expect(
      overviewTitle(
        entry({ kind: "item", name: null, itemId: "i1" }),
        "me",
        () => "Kupić pellet",
      ),
    ).toBe("Kupić pellet");
    expect(
      overviewTitle(
        entry({
          kind: "dm",
          name: null,
          members: [
            { userId: "me", role: "member", displayName: "Ja", avatarUrl: null },
            { userId: "u2", role: "member", displayName: "Ola", avatarUrl: null },
          ],
        }),
        "me",
        () => undefined,
      ),
    ).toBe("Ola");
  });
});

describe("reconcilePinnedList (CHAT6: przypinanie wątków)", () => {
  it("dodaje przypiętą wiadomość i sortuje: najnowsze przypięcie pierwsze", () => {
    const a = msg({ id: "a", pinnedAt: "2026-07-18T10:00:00.000Z" });
    const b = msg({ id: "b", pinnedAt: "2026-07-18T11:00:00.000Z" });
    const withA = reconcilePinnedList(undefined, a);
    expect(withA?.map((m) => m.id)).toEqual(["a"]);
    const withBoth = reconcilePinnedList(withA!, b);
    expect(withBoth?.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("usuwa z listy po odpięciu i po skasowaniu wiadomości", () => {
    const a = msg({ id: "a", pinnedAt: "2026-07-18T10:00:00.000Z" });
    const list = reconcilePinnedList(undefined, a)!;
    expect(reconcilePinnedList(list, msg({ id: "a", pinnedAt: null }))).toEqual([]);
    expect(
      reconcilePinnedList(
        list,
        msg({
          id: "a",
          pinnedAt: "2026-07-18T10:00:00.000Z",
          deletedAt: "2026-07-18T12:00:00.000Z",
        }),
      ),
    ).toEqual([]);
  });

  it("zwraca null, gdy nic się nie zmienia (nieprzypięta spoza listy)", () => {
    expect(reconcilePinnedList(undefined, msg({ id: "x" }))).toBeNull();
    const list = [msg({ id: "a", pinnedAt: "2026-07-18T10:00:00.000Z" })];
    expect(reconcilePinnedList(list, msg({ id: "x" }))).toBeNull();
  });

  it("odpowiedzi w wątkach nie trafiają na listę przypiętych", () => {
    expect(
      reconcilePinnedList(
        undefined,
        msg({ id: "r", threadRootId: "root", pinnedAt: "2026-07-18T10:00:00.000Z" }),
      ),
    ).toBeNull();
  });

  it("aktualizacja przypiętej zachowuje znane zagnieżdżenia", () => {
    const withAtt = {
      ...msg({ id: "a", pinnedAt: "2026-07-18T10:00:00.000Z" }),
      attachments: [
        {
          id: "att1",
          messageId: "a",
          bucketPath: "p",
          thumbPath: null,
          fileName: "f.png",
          mimeType: "image/png",
          sizeBytes: 1,
          width: null,
          height: null,
        },
      ],
    };
    const list = reconcilePinnedList(undefined, withAtt)!;
    const updated = reconcilePinnedList(
      list,
      msg({ id: "a", body: "edytowana", pinnedAt: "2026-07-18T10:00:00.000Z" }),
    )!;
    expect(updated[0].body).toBe("edytowana");
    expect(updated[0].attachments?.[0].id).toBe("att1");
  });
});

describe("applyFocusIncoming (CHAT6: okno kontekstowe)", () => {
  const focusBase: FocusFeed = {
    conversationId: "c1",
    anchorId: "anchor",
    messages: [msg({ id: "anchor" })],
    hasOlder: true,
    hasNewer: false,
  };

  it("dopisuje nową wiadomość, gdy okno doładowane do końca", () => {
    const incoming = msg({ id: "new", createdAt: "2026-07-18T12:00:00.000Z" });
    const next = applyFocusIncoming(focusBase, incoming);
    expect(next?.messages.map((m) => m.id)).toEqual(["anchor", "new"]);
  });

  it("ignoruje, gdy okno ma jeszcze nowsze strony (hasNewer)", () => {
    expect(
      applyFocusIncoming({ ...focusBase, hasNewer: true }, msg({ id: "new" })),
    ).toBeNull();
  });

  it("ignoruje inne rozmowy, wątki i duplikaty", () => {
    expect(
      applyFocusIncoming(focusBase, msg({ id: "n", conversationId: "c2" })),
    ).toBeNull();
    expect(
      applyFocusIncoming(focusBase, msg({ id: "n", threadRootId: "anchor" })),
    ).toBeNull();
    expect(applyFocusIncoming(focusBase, msg({ id: "anchor" }))).toBeNull();
    expect(applyFocusIncoming(null, msg({ id: "n" }))).toBeNull();
  });
});

describe("threadDisplayTitle", () => {
  it("używa zapisanej nazwy, inaczej treści wiadomości", () => {
    expect(defaultThreadTitle(msg({ body: "  hej   świecie  " }))).toBe("hej świecie");
    expect(threadDisplayTitle(msg({ body: "root", threadTitle: "Nazwa" }))).toBe("Nazwa");
    expect(threadDisplayTitle(msg({ body: "root", threadTitle: null }))).toBe("root");
    expect(threadDisplayTitle(msg({ kind: "gif", body: "" }))).toBe("GIF");
  });
});
