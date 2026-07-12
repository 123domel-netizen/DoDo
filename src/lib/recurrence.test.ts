import { describe, expect, it } from "vitest";
import type { Item } from "@/types";
import { expandItemOccurrences } from "@/lib/recurrence";

function makeItem(partial: Partial<Item>): Item {
  return {
    id: "it1",
    type: "event",
    title: "Cykl",
    description: "",
    start: "2026-07-01T10:00:00.000Z",
    end: "2026-07-01T11:00:00.000Z",
    allDay: false,
    groupId: null,
    showInCalendar: true,
    showInTodo: false,
    done: false,
    hasDueDate: true,
    checklist: [],
    participants: [],
    attachments: [],
    reminders: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...partial,
  };
}

const from = new Date("2026-07-10T00:00:00.000Z");
const to = new Date("2026-07-13T00:00:00.000Z");

describe("expandItemOccurrences", () => {
  it("rozwija dzienny cykl w zakresie", () => {
    const item = makeItem({ recurrence: { frequency: "daily", interval: 1 } });
    const occ = expandItemOccurrences(item, from, to, "calendar");
    expect(occ).toHaveLength(3); // 10, 11, 12 lipca
    expect(occ[0].id).toContain("__");
    expect(occ.every((o) => o.end > o.start)).toBe(true);
  });

  it('scope "calendar" filtruje wg showInCalendar', () => {
    const hidden = makeItem({
      showInCalendar: false,
      recurrence: { frequency: "daily", interval: 1 },
    });
    expect(expandItemOccurrences(hidden, from, to, "calendar")).toHaveLength(0);
  });

  it('scope "any" ignoruje widoczność (przypomnienia działają zawsze)', () => {
    const hidden = makeItem({
      showInCalendar: false,
      showInTodo: false,
      recurrence: { frequency: "daily", interval: 1 },
    });
    expect(expandItemOccurrences(hidden, from, to, "any")).toHaveLength(3);
  });

  it("wyjątek cancelled usuwa wystąpienie", () => {
    const item = makeItem({
      recurrence: { frequency: "daily", interval: 1 },
      googleRecurrenceExceptions: [
        { originalStart: "2026-07-11T10:00:00.000Z", status: "cancelled" },
      ],
    });
    const occ = expandItemOccurrences(item, from, to, "calendar");
    expect(occ).toHaveLength(2);
  });

  it("bez recurrence zwraca sam item", () => {
    const item = makeItem({});
    const occ = expandItemOccurrences(item, from, to, "calendar");
    expect(occ).toHaveLength(1);
    expect(occ[0].id).toBe("it1");
  });
});
