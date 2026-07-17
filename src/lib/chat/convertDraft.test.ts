import { describe, expect, it } from "vitest";
import { draftFromMessage } from "@/lib/chat/convertDraft";

describe("draftFromMessage", () => {
  it("zadanie: pierwsza linia jako tytuł, pełna treść + autor w opisie", () => {
    const draft = draftFromMessage(
      { body: "Kup pellet do kotłowni.\nNajlepiej 6mm, dwie palety." },
      "task",
      "Ola",
    );
    expect(draft.type).toBe("task");
    expect(draft.title).toBe("Kup pellet do kotłowni.");
    expect(draft.description).toContain("Najlepiej 6mm");
    expect(draft.description).toContain("— z wiadomości od Ola");
    expect(draft.hasDueDate).toBe(false);
    expect(draft.showInTodo).toBe(true);
    expect(draft.showInCalendar).toBe(false);
  });

  it("wydarzenie: najbliższa pełna godzina + 1h", () => {
    const now = new Date("2026-07-17T10:22:33.000Z");
    const draft = draftFromMessage({ body: "Odbiór okien" }, "event", "Jan", now);
    expect(draft.type).toBe("event");
    expect(draft.start).toBe("2026-07-17T11:00:00.000Z");
    expect(draft.end).toBe("2026-07-17T12:00:00.000Z");
    expect(draft.showInCalendar).toBe(true);
  });

  it("bardzo długa pierwsza linia jest przycinana do 120 znaków", () => {
    const draft = draftFromMessage({ body: "x".repeat(300) }, "task", "Jan");
    expect(draft.title).toHaveLength(120);
  });

  it("pusta treść → tytuł zastępczy", () => {
    const draft = draftFromMessage({ body: "" }, "task", "Jan");
    expect(draft.title).toBe("Nowe zadanie");
  });
});
