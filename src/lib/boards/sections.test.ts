import { describe, expect, it } from "vitest";
import {
  commentPreviewText,
  defaultBoardName,
  deletedTopicItemIds,
  effectiveUnread,
  formatTopicTime,
  fullOrderAfterSectionReorder,
  byCodeAsc,
  groupTopics,
  isSnoozed,
  nextSnoozeWake,
  normalizeBoardName,
  normalizeTopicCode,
  normalizeTopicTitle,
  shouldReopenOnComment,
  snoozeUntilForDate,
  snoozeUntilForPreset,
  topicSection,
  totalUnread,
  visibleTopicItems,
} from "@/lib/boards/sections";
import type { Board, BoardTopic } from "@/lib/boards/types";
import type { Item } from "@/types";

const NOW = new Date(2026, 9, 29, 12, 0, 0); // czwartek 29.10.2026, 12:00 lokalnie

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
    fieldValues: {},
    ...over,
  };
}

describe("topicSection", () => {
  it("klasyfikuje temat aktywny, przypięty, odłożony i zamknięty", () => {
    expect(topicSection(topic("a"), NOW)).toBe("active");
    expect(topicSection(topic("a", { pinnedAt: "2026-10-02T00:00:00Z" }), NOW)).toBe("pinned");
    expect(topicSection(topic("a", { snoozedUntil: "2026-11-02T07:00:00Z" }), NOW)).toBe("snoozed");
    expect(topicSection(topic("a", { closedAt: "2026-10-03T00:00:00Z" }), NOW)).toBe("closed");
  });

  it("odłożony temat wraca do aktywnych po minięciu daty", () => {
    const t = topic("a", { snoozedUntil: "2026-10-29T10:00:00.000Z" });
    expect(isSnoozed(t, new Date("2026-10-29T09:59:00.000Z"))).toBe(true);
    expect(isSnoozed(t, new Date("2026-10-29T10:00:00.000Z"))).toBe(false);
    expect(topicSection(t, new Date("2026-10-30T00:00:00.000Z"))).toBe("active");
  });

  it("zamknięcie wygrywa z przypięciem i odłożeniem; odłożenie wygrywa z przypięciem", () => {
    const base = { pinnedAt: "2026-10-02T00:00:00Z", snoozedUntil: "2027-01-01T00:00:00Z" };
    expect(topicSection(topic("a", base), NOW)).toBe("snoozed");
    expect(topicSection(topic("a", { ...base, closedAt: "2026-10-03T00:00:00Z" }), NOW)).toBe(
      "closed",
    );
  });

  it("przypięty temat z minionym odłożeniem wraca na górę jako przypięty", () => {
    const t = topic("a", { pinnedAt: "2026-10-02T00:00:00Z", snoozedUntil: "2026-10-01T00:00:00Z" });
    expect(topicSection(t, NOW)).toBe("pinned");
  });
});

describe("groupTopics", () => {
  it("sortuje aktywne i przypięte wg position rosnąco", () => {
    const grouped = groupTopics(
      [
        topic("a", { position: 3 }),
        topic("c", { position: 1 }),
        topic("b", { position: 2 }),
        topic("p2", { position: 20, pinnedAt: "2026-10-02T00:00:00Z" }),
        topic("p1", { position: 10, pinnedAt: "2026-10-02T00:00:00Z" }),
      ],
      NOW,
    );
    expect(grouped.active.map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(grouped.pinned.map((t) => t.id)).toEqual(["p1", "p2"]);
  });

  it("fullOrderAfterSectionReorder składa pełną permutację tablicy", () => {
    const topics = [
      topic("p1", { position: 1, pinnedAt: "2026-10-02T00:00:00Z" }),
      topic("p2", { position: 2, pinnedAt: "2026-10-02T00:00:00Z" }),
      topic("a1", { position: 3 }),
      topic("a2", { position: 4 }),
      topic("s1", { position: 5, snoozedUntil: "2026-12-01T07:00:00Z" }),
    ];
    expect(fullOrderAfterSectionReorder(topics, NOW, "active", ["a2", "a1"])).toEqual([
      "p1",
      "p2",
      "a2",
      "a1",
      "s1",
    ]);
    expect(fullOrderAfterSectionReorder(topics, NOW, "pinned", ["p2", "p1"])).toEqual([
      "p2",
      "p1",
      "a1",
      "a2",
      "s1",
    ]);
  });

  it("odłożone wg daty powrotu rosnąco, zamknięte wg daty zamknięcia malejąco", () => {
    const grouped = groupTopics(
      [
        topic("s2", { snoozedUntil: "2026-12-01T07:00:00Z" }),
        topic("s1", { snoozedUntil: "2026-11-01T07:00:00Z" }),
        topic("x1", { closedAt: "2026-10-10T00:00:00Z" }),
        topic("x2", { closedAt: "2026-10-20T00:00:00Z" }),
      ],
      NOW,
    );
    expect(grouped.snoozed.map((t) => t.id)).toEqual(["s1", "s2"]);
    expect(grouped.closed.map((t) => t.id)).toEqual(["x2", "x1"]);
  });

  it("nie gubi tematów — suma sekcji = liczba tematów", () => {
    const all = [
      topic("a"),
      topic("b", { pinnedAt: "2026-10-02T00:00:00Z" }),
      topic("c", { snoozedUntil: "2027-01-01T00:00:00Z" }),
      topic("d", { closedAt: "2026-10-03T00:00:00Z" }),
    ];
    const g = groupTopics(all, NOW);
    expect(g.pinned.length + g.active.length + g.snoozed.length + g.closed.length).toBe(4);
  });

  it("sort=code: litery przed cyframi, naturalnie, bez kodu na końcu", () => {
    const grouped = groupTopics(
      [
        topic("n01", { code: "N01", position: 9 }),
        topic("two", { code: "2", position: 1 }),
        topic("a", { code: "A", position: 8 }),
        topic("z299", { code: "299", position: 2 }),
        topic("z03", { code: "03", position: 3 }),
        topic("z001", { code: "001", position: 4 }),
        topic("b", { code: "B", position: 7 }),
        topic("none", { code: null, position: 0 }),
      ],
      NOW,
      "code",
    );
    expect(grouped.active.map((t) => t.code ?? "(brak)")).toEqual([
      "A",
      "B",
      "N01",
      "001",
      "2",
      "03",
      "299",
      "(brak)",
    ]);
  });
});

describe("byCodeAsc", () => {
  it("traktuje puste kody jak brak", () => {
    const a = topic("a", { code: "  ", position: 2 });
    const b = topic("b", { code: "A", position: 1 });
    expect(byCodeAsc(a, b)).toBeGreaterThan(0);
  });
});

describe("nextSnoozeWake", () => {
  it("zwraca najbliższą przyszłą datę, pomija zamknięte i przeszłe", () => {
    const wake = nextSnoozeWake(
      [
        topic("a", { snoozedUntil: "2026-12-01T07:00:00Z" }),
        topic("b", { snoozedUntil: "2026-11-01T07:00:00Z" }),
        topic("c", { snoozedUntil: "2026-10-01T07:00:00Z" }),
        topic("d", { snoozedUntil: "2026-10-30T07:00:00Z", closedAt: "2026-10-03T00:00:00Z" }),
      ],
      NOW,
    );
    expect(wake?.toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("null gdy nic nie jest odłożone", () => {
    expect(nextSnoozeWake([topic("a")], NOW)).toBeNull();
  });
});

describe("odkładanie — presety i data", () => {
  it("jutro = następny dzień 08:00 lokalnie", () => {
    const d = snoozeUntilForPreset("tomorrow", NOW);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 9, 30, 8, 0,
    ]);
  });

  it("przyszły tydzień = najbliższy poniedziałek 08:00", () => {
    const d = snoozeUntilForPreset("nextWeek", NOW);
    expect(d.getDay()).toBe(1);
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([10, 2, 8]);
  });

  it("za miesiąc = ten sam dzień miesiąca następnego, 08:00", () => {
    const d = snoozeUntilForPreset("month", NOW);
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([10, 29, 8]);
  });

  it("wybrana data: poprawna przyszła → 08:00; przeszła, dzisiejsza po 08:00 i błędna → null", () => {
    expect(snoozeUntilForDate("2026-11-15", NOW)?.getHours()).toBe(8);
    expect(snoozeUntilForDate("2026-10-28", NOW)).toBeNull();
    expect(snoozeUntilForDate("2026-10-29", NOW)).toBeNull();
    expect(snoozeUntilForDate("2026-02-31", NOW)).toBeNull();
    expect(snoozeUntilForDate("", NOW)).toBeNull();
    expect(snoozeUntilForDate("jutro", NOW)).toBeNull();
  });
});

describe("tytuły i nazwy", () => {
  it("normalizuje białe znaki i odrzuca puste", () => {
    expect(normalizeTopicTitle("  Kup   mleko \n")).toBe("Kup mleko");
    expect(normalizeTopicTitle("   ")).toBeNull();
    expect(normalizeBoardName("")).toBeNull();
  });

  it("przycina do limitu", () => {
    expect(normalizeTopicTitle("a".repeat(500))?.length).toBe(200);
    expect(normalizeBoardName("b".repeat(500))?.length).toBe(120);
  });

  it("proponuje nazwę tablicy z imion", () => {
    expect(defaultBoardName([])).toBe("Nowa tablica");
    expect(defaultBoardName(["Jacek Kowalski"])).toBe("Jacek");
    expect(defaultBoardName(["Jacek K", "Dominik N"])).toBe("Jacek + Dominik");
    expect(defaultBoardName(["A", "B", "C", "D", "E"])).toBe("A + B + C +2");
    expect(defaultBoardName(["ala@example.com"])).toBe("ala");
  });
});

describe("nieprzeczytane", () => {
  const withComment = topic("a", {
    unreadCount: 3,
    lastComment: {
      id: "m1",
      kind: "text",
      body: "x",
      authorUserId: "u2",
      createdAt: "2026-10-29T10:00:00.000Z",
    },
  });

  it("bez lokalnego odczytu zwraca licznik serwera", () => {
    expect(effectiveUnread(withComment, undefined)).toBe(3);
  });

  it("lokalny odczyt po ostatnim komentarzu zeruje licznik; wcześniejszy nie", () => {
    expect(effectiveUnread(withComment, Date.parse("2026-10-29T10:00:01.000Z"))).toBe(0);
    expect(effectiveUnread(withComment, Date.parse("2026-10-29T09:00:00.000Z"))).toBe(3);
  });

  it("sumuje nieprzeczytane z tablic", () => {
    const boards = [{ unreadCount: 2 }, { unreadCount: 5 }] as Board[];
    expect(totalUnread(boards)).toBe(7);
  });
});

describe("podgląd i ponowne otwarcie", () => {
  it("skraca i składa białe znaki; etykietuje załączniki", () => {
    const c = { id: "1", kind: "text", body: "  linia 1\nlinia 2  ", authorUserId: "u", createdAt: "" };
    expect(commentPreviewText(c)).toBe("linia 1 linia 2");
    expect(commentPreviewText({ ...c, kind: "gif", body: "" })).toBe("GIF");
    expect(commentPreviewText({ ...c, kind: "text", body: "" })).toBe("(załącznik)");
    expect(commentPreviewText({ ...c, body: "x".repeat(400) }).length).toBe(140);
  });

  it("komentarz otwiera ponownie tylko zamknięty temat", () => {
    expect(shouldReopenOnComment(topic("a"))).toBe(false);
    expect(shouldReopenOnComment(topic("a", { closedAt: "2026-10-03T00:00:00Z" }))).toBe(true);
  });
});

describe("formatTopicTime", () => {
  it("dziś godzina, wczoraj słownie, starsze datą", () => {
    expect(formatTopicTime(new Date(2026, 9, 29, 9, 5).toISOString(), NOW)).toBe("09:05");
    expect(formatTopicTime(new Date(2026, 9, 28, 9, 5).toISOString(), NOW)).toBe("wczoraj");
    expect(formatTopicTime(new Date(2026, 8, 3, 9, 5).toISOString(), NOW)).toMatch(/^3 wrz/);
    expect(formatTopicTime(new Date(2025, 8, 3, 9, 5).toISOString(), NOW)).toMatch(/2025$/);
    expect(formatTopicTime("nie-data", NOW)).toBe("");
  });
});

describe("kod tematu i widoczne powiązania", () => {
  it("normalizeTopicCode: trim, max 16, pusty → null", () => {
    expect(normalizeTopicCode("  N01  ")).toBe("N01");
    expect(normalizeTopicCode("   ")).toBeNull();
    expect(normalizeTopicCode("x".repeat(20))?.length).toBe(16);
  });

  it("visibleTopicItems pomija brakujące i soft-delete; deletedTopicItemIds tylko tombstone", () => {
    const links = [
      { itemId: "alive", itemType: "task" as const },
      { itemId: "gone", itemType: "event" as const },
      { itemId: "tomb", itemType: "task" as const },
    ];
    const items = {
      alive: { id: "alive", deletedAt: null } as Item,
      tomb: { id: "tomb", deletedAt: "2026-10-29T12:00:00Z" } as Item,
    };
    expect(visibleTopicItems(links, items).map((l) => l.itemId)).toEqual(["alive"]);
    expect(deletedTopicItemIds(links, items)).toEqual(["tomb"]);
  });
});
