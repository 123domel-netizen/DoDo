import { describe, expect, it } from "vitest";
import type { BoardField, BoardTopic } from "@/lib/boards/types";
import {
  collectTopicLocalities,
  compareByField,
  compareSmart,
  filterTopicsByFields,
  filterTopicsByLocality,
  formatFieldCell,
  prefsForBoardDefault,
  resolveColumnFields,
  resolvePriorityField,
  sanitizeViewPrefs,
} from "@/lib/boards/topicView";

function topic(id: string, over: Partial<BoardTopic> = {}): BoardTopic {
  return {
    id,
    boardId: "b1",
    title: id,
    description: "",
    code: null,
    locality: null,
    parentId: null,
    position: Number(id.replace(/\D/g, "") || 0),
    createdBy: "u1",
    pinnedAt: null,
    snoozedUntil: null,
    closedAt: null,
    closedBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    conversationId: `c-${id}`,
    lastActivityAt: "2026-10-01T00:00:00Z",
    commentCount: 0,
    unreadCount: 0,
    lastComment: null,
    items: [],
    fieldValues: {},
    ...over,
  };
}

function field(over: Partial<BoardField> & Pick<BoardField, "id" | "kind">): BoardField {
  return {
    boardId: "b1",
    name: over.id,
    visibility: "all",
    position: 0,
    options: [],
    viewerIds: [],
    ...over,
  };
}

const status = field({
  id: "status",
  kind: "single",
  name: "Status",
  options: [
    { id: "s1", label: "Nowe", position: 1, color: "#7A6CB8" },
    { id: "s2", label: "W toku", position: 2, color: "#4A8FC4" },
  ],
});

const tags = field({
  id: "tags",
  kind: "multi",
  name: "Tagi",
  options: [
    { id: "t1", label: "A", position: 1, color: "#4F9E7A" },
    { id: "t2", label: "B", position: 2, color: null },
  ],
});

const note = field({ id: "note", kind: "text", name: "Notatka" });

const priority = field({
  id: "prio",
  kind: "single",
  name: "Priorytet",
  position: 1,
  options: [
    { id: "p1", label: "Pilne", position: 1, color: "#C08F52" },
    { id: "p2", label: "Ważne", position: 2, color: "#4A8FC4" },
    { id: "p3", label: "Standard", position: 3, color: "#6A7280" },
  ],
});

describe("resolvePriorityField", () => {
  it("bierze pole o nazwie Priorytet, inaczej pierwsze single", () => {
    expect(resolvePriorityField([status, priority])?.id).toBe("prio");
    expect(resolvePriorityField([status, tags])?.id).toBe("status");
    expect(resolvePriorityField([note, tags])).toBeNull();
  });
});

describe("compareByField (kolejność opcji)", () => {
  it("sortuje single wg position opcji, nie alfabetycznie", () => {
    const a = topic("a", { fieldValues: { prio: { text: null, optionIds: ["p3"] } } }); // Standard
    const b = topic("b", { fieldValues: { prio: { text: null, optionIds: ["p1"] } } }); // Pilne
    const c = topic("c"); // puste
    expect([a, b, c].sort((x, y) => compareByField(x, y, priority)).map((t) => t.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("compareSmart", () => {
  it("priorytet → aktywność → kod", () => {
    const urgentOld = topic("u-old", {
      code: "Z",
      lastActivityAt: "2026-10-01T00:00:00Z",
      fieldValues: { prio: { text: null, optionIds: ["p1"] } },
    });
    const urgentNew = topic("u-new", {
      code: "A",
      lastActivityAt: "2026-10-10T00:00:00Z",
      fieldValues: { prio: { text: null, optionIds: ["p1"] } },
    });
    const standard = topic("std", {
      code: "B",
      lastActivityAt: "2026-10-20T00:00:00Z",
      fieldValues: { prio: { text: null, optionIds: ["p3"] } },
    });
    const empty = topic("empty", {
      code: "C",
      lastActivityAt: "2026-10-30T00:00:00Z",
    });
    expect(
      [standard, empty, urgentOld, urgentNew]
        .sort((a, b) => compareSmart(a, b, [priority, status]))
        .map((t) => t.id),
    ).toEqual(["u-new", "u-old", "std", "empty"]);
  });
});

describe("formatFieldCell", () => {
  it("tekst i opcje", () => {
    expect(formatFieldCell(topic("a", { fieldValues: { note: { text: "x", optionIds: [] } } }), note)).toBe(
      "x",
    );
    expect(
      formatFieldCell(topic("a", { fieldValues: { status: { text: null, optionIds: ["s2"] } } }), status),
    ).toBe("W toku");
    expect(formatFieldCell(topic("a"), status)).toBe("—");
  });
});

describe("filterTopicsByFields", () => {
  const list = [
    topic("a", { fieldValues: { status: { text: null, optionIds: ["s1"] }, tags: { text: null, optionIds: ["t1"] } } }),
    topic("b", { fieldValues: { status: { text: null, optionIds: ["s2"] }, tags: { text: null, optionIds: ["t2"] } } }),
    topic("c", { fieldValues: { status: { text: null, optionIds: ["s1"] }, tags: { text: null, optionIds: ["t1", "t2"] } } }),
    topic("d"),
  ];

  it("OR w polu, AND między polami", () => {
    expect(
      filterTopicsByFields(list, [status, tags], { status: ["s1"] }).map((t) => t.id),
    ).toEqual(["a", "c"]);
    expect(
      filterTopicsByFields(list, [status, tags], { status: ["s1"], tags: ["t2"] }).map((t) => t.id),
    ).toEqual(["c"]);
  });

  it("ignoruje filtr ukrytego / nieznanego pola", () => {
    expect(
      filterTopicsByFields(list, [status], { hidden: ["x"], status: ["s2"] }).map((t) => t.id),
    ).toEqual(["b"]);
  });

  it("pusty filtr = bez zmian", () => {
    expect(filterTopicsByFields(list, [status], {})).toHaveLength(4);
  });
});

describe("filterTopicsByLocality", () => {
  const list = [
    topic("a", { locality: "Sępólno" }),
    topic("b", { locality: "Więcbork" }),
    topic("c", { locality: "Sępólno" }),
    topic("d"),
  ];

  it("OR wybranych; puste = bez zmian", () => {
    expect(filterTopicsByLocality(list, []).map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterTopicsByLocality(list, ["Sępólno"]).map((t) => t.id)).toEqual(["a", "c"]);
    expect(filterTopicsByLocality(list, ["Sępólno", "Więcbork"]).map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("collectTopicLocalities", () => {
  it("unikalne, posortowane po pl", () => {
    expect(
      collectTopicLocalities([
        topic("a", { locality: "Więcbork" }),
        topic("b", { locality: "Sępólno" }),
        topic("c", { locality: "Sępólno" }),
        topic("d"),
      ]),
    ).toEqual(["Sępólno", "Więcbork"]);
  });
});

describe("compareByField", () => {
  it("puste na końcu, naturalnie", () => {
    const a = topic("a", { position: 2, fieldValues: { note: { text: "10", optionIds: [] } } });
    const b = topic("b", { position: 1, fieldValues: { note: { text: "2", optionIds: [] } } });
    const empty = topic("c", { position: 0 });
    expect(compareByField(b, a, note)).toBeLessThan(0);
    expect(compareByField(a, empty, note)).toBeLessThan(0);
  });
});

describe("sanitizeViewPrefs", () => {
  it("usuwa kolumny/filtry/sort poza widocznymi polami", () => {
    const prefs = sanitizeViewPrefs(
      {
        columnIds: ["status", "gone"],
        filters: { status: ["s1", "gone"], gone: ["x"] },
        localities: ["Sępólno", ""],
        sort: { mode: "field", fieldId: "gone" },
      },
      [status],
    );
    expect(prefs.columnIds).toEqual(["status"]);
    expect(prefs.filters).toEqual({ status: ["s1"] });
    expect(prefs.localities).toEqual(["Sępólno"]);
    expect(prefs.sort).toEqual({ mode: "manual" });
  });

  it("zachowuje null = wszystkie kolumny", () => {
    expect(
      sanitizeViewPrefs(
        { columnIds: null, filters: {}, localities: [], sort: { mode: "manual" } },
        [status],
      ).columnIds,
    ).toBe(null);
  });
});

describe("prefsForBoardDefault", () => {
  it("wyrzuca pola ukryte z kolumn i filtrów", () => {
    const hidden = field({
      id: "secret",
      kind: "single",
      name: "Ukryte",
      visibility: "restricted",
      options: [{ id: "x", label: "X", position: 1, color: null }],
    });
    const prefs = prefsForBoardDefault(
      {
        columnIds: ["status", "secret"],
        filters: { status: ["s1"], secret: ["x"] },
        localities: ["Chojnice"],
        sort: { mode: "field", fieldId: "secret" },
      },
      [status, hidden],
    );
    expect(prefs.columnIds).toEqual(["status"]);
    expect(prefs.filters).toEqual({ status: ["s1"] });
    expect(prefs.sort).toEqual({ mode: "manual" });
    expect(prefs.localities).toEqual(["Chojnice"]);
  });
});

describe("resolveColumnFields", () => {
  it("null/[] = wszystkie pola; lista = podzbiór", () => {
    expect(
      resolveColumnFields(
        { columnIds: null, filters: {}, localities: [], sort: { mode: "manual" } },
        [status, tags],
      ),
    ).toEqual([status, tags]);
    expect(
      resolveColumnFields(
        { columnIds: [], filters: {}, localities: [], sort: { mode: "manual" } },
        [status, tags],
      ),
    ).toEqual([status, tags]);
    expect(
      resolveColumnFields(
        { columnIds: ["tags"], filters: {}, localities: [], sort: { mode: "manual" } },
        [status, tags],
      ),
    ).toEqual([tags]);
  });
});
