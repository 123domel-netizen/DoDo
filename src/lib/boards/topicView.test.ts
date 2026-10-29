import { describe, expect, it } from "vitest";
import type { BoardField, BoardTopic } from "@/lib/boards/types";
import {
  compareByField,
  filterTopicsByFields,
  formatFieldCell,
  sanitizeViewPrefs,
} from "@/lib/boards/topicView";

function topic(id: string, over: Partial<BoardTopic> = {}): BoardTopic {
  return {
    id,
    boardId: "b1",
    title: id,
    description: "",
    code: null,
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
    { id: "s1", label: "Nowe", position: 1 },
    { id: "s2", label: "W toku", position: 2 },
  ],
});

const tags = field({
  id: "tags",
  kind: "multi",
  name: "Tagi",
  options: [
    { id: "t1", label: "A", position: 1 },
    { id: "t2", label: "B", position: 2 },
  ],
});

const note = field({ id: "note", kind: "text", name: "Notatka" });

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
        sort: { mode: "field", fieldId: "gone" },
      },
      [status],
    );
    expect(prefs.columnIds).toEqual(["status"]);
    expect(prefs.filters).toEqual({ status: ["s1"] });
    expect(prefs.sort).toEqual({ mode: "manual" });
  });
});
