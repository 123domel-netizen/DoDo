import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardTopic } from "@/lib/boards/types";
import type { ChatMessage } from "@/lib/chat/types";

const api = vi.hoisted(() => ({
  fetchBoards: vi.fn(),
  fetchTopics: vi.fn(),
  createBoard: vi.fn(),
  renameBoard: vi.fn(),
  setBoardArchived: vi.fn(),
  addBoardMembers: vi.fn(),
  removeBoardMember: vi.fn(),
  createTopic: vi.fn(),
  updateTopic: vi.fn(),
  deleteTopic: vi.fn(),
  linkTopicItem: vi.fn(),
  unlinkTopicItem: vi.fn(),
  reorderTopics: vi.fn(),
}));

vi.mock("@/lib/boards/api", () => api);

import {
  mergeTopics,
  resetBoardsRuntimeForTests,
  useBoardsStore,
} from "@/lib/boards/store";
import { getBoardConversationRef } from "@/lib/chat/boardBridge";

function board(id: string, over: Partial<Board> = {}): Board {
  return {
    id,
    orgId: "o1",
    name: `Tablica ${id}`,
    createdBy: "u1",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    myRole: "owner",
    unreadCount: 0,
    members: [],
    ...over,
  };
}

function topic(id: string, over: Partial<BoardTopic> = {}): BoardTopic {
  return {
    id,
    boardId: "b1",
    title: `Temat ${id}`,
    description: "",
    code: null,
    position: 1,
    createdBy: "u1",
    pinnedAt: null,
    snoozedUntil: null,
    closedAt: null,
    closedBy: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    conversationId: `c-${id}`,
    lastActivityAt: "2026-10-01T10:00:00.000Z",
    commentCount: 0,
    unreadCount: 0,
    lastComment: null,
    items: [],
    ...over,
  };
}

function message(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    conversationId: "c-t1",
    authorUserId: "u2",
    kind: "text",
    body: "Cześć",
    createdAt: "2026-10-29T10:00:00.000Z",
    mentions: [],
    deletedAt: null,
    ...over,
  } as ChatMessage;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const state = () => useBoardsStore.getState();
const topicsOf = (boardId = "b1") => state().topicsByBoard[boardId] ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  resetBoardsRuntimeForTests();
  useBoardsStore.getState().reset();
  useBoardsStore.getState().setScope("o1", "u1");
  api.fetchBoards.mockResolvedValue({ boards: [] });
  api.fetchTopics.mockResolvedValue({ topics: [] });
  api.updateTopic.mockResolvedValue({});
  api.linkTopicItem.mockResolvedValue({});
  api.unlinkTopicItem.mockResolvedValue({});
  api.reorderTopics.mockResolvedValue({});
});

describe("addTopic — szybkie dodawanie", () => {
  it("pokazuje temat od razu (pending), po zapisie ma rozmowę i jest zarejestrowany w moście Czatu", async () => {
    const d = deferred<{ conversationId: string }>();
    api.createTopic.mockReturnValue(d.promise);

    const id = state().addTopic("b1", "  Nowy   temat ");
    expect(id).toBeTruthy();
    expect(topicsOf()[0]).toMatchObject({ title: "Nowy temat", sendState: "pending" });

    d.resolve({ conversationId: "conv-1" });
    await flush();
    const saved = topicsOf()[0]!;
    expect(saved.sendState).toBeUndefined();
    expect(saved.conversationId).toBe("conv-1");
    expect(getBoardConversationRef("conv-1")).toEqual({ boardId: "b1", topicId: id });
  });

  it("odrzuca pusty tytuł bez wywołania serwera", () => {
    expect(state().addTopic("b1", "   ")).toBeNull();
    expect(api.createTopic).not.toHaveBeenCalled();
    expect(topicsOf()).toHaveLength(0);
  });

  it("kilka tematów pod rząd zapisuje po kolei, w kolejności wpisywania", async () => {
    const order: string[] = [];
    api.createTopic.mockImplementation(async (input: { title: string }) => {
      order.push(input.title);
      await flush();
      return { conversationId: `conv-${input.title}` };
    });
    state().addTopic("b1", "Pierwszy");
    state().addTopic("b1", "Drugi");
    state().addTopic("b1", "Trzeci");
    for (let i = 0; i < 20 && topicsOf().some((t) => t.sendState); i += 1) {
      await flush();
    }
    expect(order).toEqual(["Pierwszy", "Drugi", "Trzeci"]);
    expect(topicsOf().every((t) => !t.sendState)).toBe(true);
  });

  it("błąd zapisu oznacza temat jako failed; retry używa tego samego id (idempotentnie)", async () => {
    api.createTopic.mockResolvedValueOnce({ error: "Brak połączenia z internetem." });
    const id = state().addTopic("b1", "Wrócę");
    await flush();
    expect(topicsOf()[0]).toMatchObject({ sendState: "failed", sendError: "Brak połączenia z internetem." });

    api.createTopic.mockResolvedValueOnce({ conversationId: "conv-ok" });
    state().retryTopic(id!);
    await flush();
    expect(topicsOf()).toHaveLength(1);
    expect(topicsOf()[0]).toMatchObject({ id, conversationId: "conv-ok" });
    expect(api.createTopic.mock.calls[0]![0].id).toBe(api.createTopic.mock.calls[1]![0].id);
  });

  it("nieudany temat można odrzucić z listy", async () => {
    api.createTopic.mockResolvedValue({ error: "x" });
    const id = state().addTopic("b1", "Nie");
    await flush();
    state().discardLocalTopic(id!);
    expect(topicsOf()).toHaveLength(0);
  });

  it("odpowiedź serwera po zmianie organizacji nie wpada do nowego zakresu", async () => {
    const d = deferred<{ conversationId: string }>();
    api.createTopic.mockReturnValue(d.promise);
    state().addTopic("b1", "Stary zakres");
    state().setScope("o2", "u1");
    d.resolve({ conversationId: "conv-late" });
    await flush();
    expect(topicsOf()).toHaveLength(0);
    expect(getBoardConversationRef("conv-late")).toBeUndefined();
  });
});

describe("loadTopics / mergeTopics", () => {
  it("zachowuje lokalne tematy w trakcie zapisu przy odświeżeniu z serwera", async () => {
    api.createTopic.mockReturnValue(new Promise(() => undefined));
    state().addTopic("b1", "W drodze");
    api.fetchTopics.mockResolvedValue({ topics: [topic("t1")] });
    await state().loadTopics("b1");
    expect(topicsOf().map((t) => t.title).sort()).toEqual(["Temat t1", "W drodze"]);
  });

  it("odrzuca spóźnioną odpowiedź ze starej organizacji", async () => {
    const d = deferred<{ topics: BoardTopic[] }>();
    api.fetchTopics.mockReturnValue(d.promise);
    const p = state().loadTopics("b1");
    state().setScope("o2", "u1");
    d.resolve({ topics: [topic("t1")] });
    await p;
    expect(topicsOf()).toHaveLength(0);
  });

  it("błąd ładowania zapisuje komunikat i nie czyści istniejącej listy", async () => {
    api.fetchTopics.mockResolvedValueOnce({ topics: [topic("t1")] });
    await state().loadTopics("b1");
    api.fetchTopics.mockResolvedValueOnce({ topics: [], error: "Brak dostępu do tej tablicy." });
    await state().loadTopics("b1");
    expect(state().topicsStatus["b1"]).toBe("error");
    expect(state().topicsError["b1"]).toBe("Brak dostępu do tej tablicy.");
    expect(topicsOf()).toHaveLength(1);
  });

  it("mergeTopics: tematy bez sendState, których nie ma na serwerze, znikają", () => {
    const merged = mergeTopics([topic("gone")], [topic("t1")]);
    expect(merged.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("updateTopic — optymistyczne akcje", () => {
  beforeEach(async () => {
    api.fetchTopics.mockResolvedValue({ topics: [topic("t1")] });
    await state().loadTopics("b1");
  });

  it("przypięcie, odłożenie i zamknięcie zmieniają stan od razu i wysyłają patch", async () => {
    const d = deferred<Record<string, never>>();
    api.updateTopic.mockReturnValue(d.promise);
    const p = state().updateTopic("t1", { pinned_at: "2026-10-29T10:00:00.000Z" });
    expect(topicsOf()[0]!.pinnedAt).toBe("2026-10-29T10:00:00.000Z");
    d.resolve({});
    await p;
    expect(api.updateTopic).toHaveBeenCalledWith("t1", { pinned_at: "2026-10-29T10:00:00.000Z" });

    await state().updateTopic("t1", { snoozed_until: "2026-11-01T07:00:00.000Z" });
    expect(topicsOf()[0]!.snoozedUntil).toBe("2026-11-01T07:00:00.000Z");
    await state().updateTopic("t1", { closed_at: "2026-10-29T11:00:00.000Z" });
    expect(topicsOf()[0]!.closedAt).toBe("2026-10-29T11:00:00.000Z");
    await state().updateTopic("t1", { closed_at: null });
    expect(topicsOf()[0]!.closedAt).toBeNull();
  });

  it("błąd serwera cofa zmianę i zwraca komunikat", async () => {
    api.updateTopic.mockResolvedValue({ error: "Brak dostępu do tego tematu." });
    const res = await state().updateTopic("t1", { title: "Inny tytuł" });
    expect(res.error).toBe("Brak dostępu do tego tematu.");
    expect(topicsOf()[0]!.title).toBe("Temat t1");
  });

  it("odświeżenie z serwera w trakcie zmiany nie nadpisuje lokalnego stanu", async () => {
    const d = deferred<Record<string, never>>();
    api.updateTopic.mockReturnValue(d.promise);
    const p = state().updateTopic("t1", { pinned_at: "2026-10-29T10:00:00.000Z" });
    api.fetchTopics.mockResolvedValue({ topics: [topic("t1")] }); // serwer jeszcze bez zmiany
    await state().loadTopics("b1");
    expect(topicsOf()[0]!.pinnedAt).toBe("2026-10-29T10:00:00.000Z");
    d.resolve({});
    await p;
  });

  it("pusty tytuł jest odrzucany lokalnie", async () => {
    const res = await state().updateTopic("t1", { title: "   " });
    expect(res.error).toBeTruthy();
    expect(api.updateTopic).not.toHaveBeenCalled();
  });

  it("zapisuje kod tematu (trim) i czyści pusty", async () => {
    await state().updateTopic("t1", { code: "  N01  " });
    expect(api.updateTopic).toHaveBeenCalledWith("t1", { code: "N01" });
    expect(topicsOf()[0]!.code).toBe("N01");
    await state().updateTopic("t1", { code: "  " });
    expect(topicsOf()[0]!.code).toBeNull();
  });
});

describe("reorderTopics", () => {
  beforeEach(async () => {
    api.fetchTopics.mockResolvedValue({
      topics: [topic("t1", { position: 1 }), topic("t2", { position: 2 })],
    });
    await state().loadTopics("b1");
  });

  it("optymistycznie przestawia position i woła RPC", async () => {
    const res = await state().reorderTopics("b1", ["t2", "t1"]);
    expect(res.error).toBeUndefined();
    expect(api.reorderTopics).toHaveBeenCalledWith("b1", ["t2", "t1"]);
    expect(topicsOf().map((t) => ({ id: t.id, position: t.position }))).toEqual([
      { id: "t2", position: 1 },
      { id: "t1", position: 2 },
    ]);
  });

  it("błąd serwera cofa kolejność", async () => {
    api.reorderTopics.mockResolvedValue({ error: "Nie udało się zmienić kolejności tematów." });
    const res = await state().reorderTopics("b1", ["t2", "t1"]);
    expect(res.error).toBeTruthy();
    expect(topicsOf().map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});

describe("komentarze, unread i podgląd", () => {
  beforeEach(async () => {
    api.fetchBoards.mockResolvedValue({ boards: [board("b1")] });
    api.fetchTopics.mockResolvedValue({ topics: [topic("t1")] });
    await state().loadBoards();
    await state().loadTopics("b1");
  });

  it("cudzy komentarz podbija unread, ostatnią aktywność i podgląd", () => {
    state().noteIncomingComment(message("m1"), { boardId: "b1", topicId: "t1" });
    const t = topicsOf()[0]!;
    expect(t.unreadCount).toBe(1);
    expect(t.commentCount).toBe(1);
    expect(t.lastActivityAt).toBe("2026-10-29T10:00:00.000Z");
    expect(t.lastComment).toMatchObject({ id: "m1", body: "Cześć", authorUserId: "u2" });
    expect(state().boards[0]!.unreadCount).toBe(1);
  });

  it("własny komentarz nie zwiększa unread; ten sam komentarz dwa razy liczy się raz", () => {
    state().noteIncomingComment(message("m2", { authorUserId: "u1" }), { boardId: "b1", topicId: "t1" });
    expect(topicsOf()[0]!.unreadCount).toBe(0);
    expect(topicsOf()[0]!.commentCount).toBe(1);
    state().noteIncomingComment(message("m2", { authorUserId: "u1" }), { boardId: "b1", topicId: "t1" });
    expect(topicsOf()[0]!.commentCount).toBe(1);
  });

  it("wiadomości systemowe i usunięte nie zmieniają tematu", () => {
    state().noteIncomingComment(message("s1", { kind: "system" }), { boardId: "b1", topicId: "t1" });
    state().noteIncomingComment(message("d1", { deletedAt: "2026-10-29T10:01:00Z" }), {
      boardId: "b1",
      topicId: "t1",
    });
    expect(topicsOf()[0]!.commentCount).toBe(0);
  });

  it("markTopicRead zeruje unread tematu i odejmuje go od licznika tablicy (per użytkownik)", () => {
    state().noteIncomingComment(message("m1"), { boardId: "b1", topicId: "t1" });
    state().noteIncomingComment(message("m3"), { boardId: "b1", topicId: "t1" });
    expect(state().boards[0]!.unreadCount).toBe(2);
    state().markTopicRead("t1");
    expect(topicsOf()[0]!.unreadCount).toBe(0);
    expect(state().boards[0]!.unreadCount).toBe(0);
    expect(state().locallyReadAt["t1"]).toBeGreaterThan(0);
  });

  it("komentarz do nieznanego tematu planuje przeładowanie zamiast gubić zdarzenie", async () => {
    vi.useFakeTimers();
    try {
      api.fetchBoards.mockClear();
      state().noteIncomingComment(message("m9", { conversationId: "c-x" }), {
        boardId: "b1",
        topicId: "nieznany",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(api.fetchBoards).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("powiązania z zadaniami / wydarzeniami", () => {
  beforeEach(async () => {
    api.fetchTopics.mockResolvedValue({ topics: [topic("t1")] });
    await state().loadTopics("b1");
  });

  it("linkItem dodaje powiązanie raz — kolejne wywołanie nie tworzy duplikatu", async () => {
    await state().linkItem({ topicId: "t1", itemId: "i1", itemType: "task" });
    await state().linkItem({ topicId: "t1", itemId: "i1", itemType: "task" });
    expect(api.linkTopicItem).toHaveBeenCalledTimes(1);
    expect(topicsOf()[0]!.items).toEqual([{ itemId: "i1", itemType: "task" }]);
  });

  it("błąd zapisu powiązania nie zmienia listy", async () => {
    api.linkTopicItem.mockResolvedValue({ error: "Brak dostępu do tej tablicy." });
    const res = await state().linkItem({ topicId: "t1", itemId: "i2", itemType: "event" });
    expect(res.error).toBeTruthy();
    expect(topicsOf()[0]!.items).toHaveLength(0);
  });

  it("unlinkItem usuwa tylko powiązanie", async () => {
    await state().linkItem({ topicId: "t1", itemId: "i1", itemType: "task" });
    await state().unlinkItem("t1", "i1");
    expect(topicsOf()[0]!.items).toHaveLength(0);
  });
});

describe("deleteTopic", () => {
  it("usuwa temat z listy po sukcesie; temat z komentarzami zostaje po błędzie serwera", async () => {
    api.fetchTopics.mockResolvedValue({ topics: [topic("t1"), topic("t2")] });
    await state().loadTopics("b1");
    api.deleteTopic.mockResolvedValueOnce({ error: "Temat ma komentarze — zamknij go zamiast usuwać." });
    expect((await state().deleteTopic("t1")).error).toBeTruthy();
    expect(topicsOf()).toHaveLength(2);
    api.deleteTopic.mockResolvedValueOnce({});
    await state().deleteTopic("t2");
    expect(topicsOf().map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("zakres organizacji i wybór", () => {
  it("setScope z inną organizacją czyści dane, ale pierwszy zakres zachowuje wybór z deep-linku", () => {
    useBoardsStore.getState().reset();
    useBoardsStore.setState({ activeBoardId: "b1", activeTopicId: "t1" });
    state().setScope("o1", "u1");
    expect(state().activeBoardId).toBe("b1");
    expect(state().activeTopicId).toBe("t1");

    useBoardsStore.setState({ boards: [board("b1")] });
    state().setScope("o2", "u1");
    expect(state().boards).toHaveLength(0);
    expect(state().activeBoardId).toBeNull();
  });

  it("loadBoards czyści wybór, gdy tablica zniknęła (usunięty uczestnik / archiwum)", async () => {
    useBoardsStore.setState({ activeBoardId: "b-old", activeTopicId: "t-old" });
    api.fetchBoards.mockResolvedValue({ boards: [board("b1")] });
    await state().loadBoards();
    expect(state().activeBoardId).toBeNull();
    expect(state().activeTopicId).toBeNull();
  });

  it("createBoard: pusta nazwa odrzucona, sukces wybiera nową tablicę", async () => {
    expect((await state().createBoard({ name: "  ", memberIds: [] })).error).toBeTruthy();
    api.createBoard.mockResolvedValue({});
    api.fetchBoards.mockImplementation(async () => ({
      boards: [board(api.createBoard.mock.calls[0]![0].id as string)],
    }));
    const res = await state().createBoard({ name: "Jacek + Dominik", memberIds: ["u1", "u2"] });
    expect(res.id).toBeTruthy();
    expect(api.createBoard.mock.calls[0]![0].memberIds).toEqual(["u2"]);
    expect(state().activeBoardId).toBe(res.id);
  });
});
