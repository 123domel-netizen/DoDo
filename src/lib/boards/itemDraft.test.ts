import { describe, expect, it } from "vitest";
import { draftFromTopic } from "@/lib/boards/itemDraft";
import { topicConversationEntry } from "@/lib/boards/entry";
import type { Board, BoardTopic } from "@/lib/boards/types";

const NOW = new Date(2026, 9, 29, 12, 10, 0);

describe("draftFromTopic", () => {
  it("zadanie: tytuł tematu, opis z pochodzeniem, bez terminu, tylko na liście zadań", () => {
    const d = draftFromTopic({ title: "Zamówić części", description: "Tylko od Kowalskiego" }, "task", "Jacek + Dominik", NOW);
    expect(d.type).toBe("task");
    expect(d.title).toBe("Zamówić części");
    expect(d.description).toContain("Tylko od Kowalskiego");
    expect(d.description).toContain("Jacek + Dominik");
    expect(d.hasDueDate).toBe(false);
    expect(d.showInTodo).toBe(true);
    expect(d.showInCalendar).toBe(false);
  });

  it("wydarzenie: godzinny zakres w kalendarzu, opis tylko z pochodzeniem gdy brak opisu", () => {
    const d = draftFromTopic({ title: "Spotkanie", description: "" }, "event", "Zespół", NOW);
    expect(d.type).toBe("event");
    expect(d.showInCalendar).toBe(true);
    expect(d.showInTodo).toBe(false);
    expect(d.description).toBe("— z tematu tablicy „Zespół”");
    const start = Date.parse(d.start as string);
    const end = Date.parse(d.end as string);
    expect(end - start).toBe(3_600_000);
  });

  it("przycina tytuł do 120 znaków", () => {
    const d = draftFromTopic({ title: "x".repeat(200), description: "" }, "task", "T", NOW);
    expect(d.title?.length).toBe(120);
  });
});

describe("topicConversationEntry", () => {
  it("buduje wpis rozmowy z uczestników tablicy (bez trafiania do overview)", () => {
    const board = {
      members: [
        { userId: "u1", role: "owner", displayName: "Jacek", avatarUrl: null },
        { userId: "u2", role: "member", displayName: "Dominik", avatarUrl: null },
      ],
    } as Board;
    const topic = {
      title: "Temat",
      conversationId: "c1",
      createdBy: "u1",
      createdAt: "2026-10-01T10:00:00Z",
      lastActivityAt: "2026-10-02T10:00:00Z",
    } as BoardTopic;
    const entry = topicConversationEntry(topic, board);
    expect(entry.kind).toBe("board_topic");
    expect(entry.id).toBe("c1");
    expect(entry.members.map((m) => m.userId)).toEqual(["u1", "u2"]);
    expect(entry.members[0]?.role).toBe("owner");
  });
});
