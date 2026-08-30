import { describe, expect, it } from "vitest";
import type { Item } from "@/types";
import { addDays, startOfDay } from "date-fns";
import {
  bandSpanInRange,
  isBandItem,
  layoutBandItems,
  stackBandBars,
} from "@/lib/allDayBars";

function makeItem(partial: Partial<Item>): Item {
  return {
    id: "it1",
    type: "event",
    title: "Wydarzenie",
    description: "",
    start: "2026-08-19T12:00:00.000Z",
    end: "2026-08-24T12:00:00.000Z",
    allDay: true,
    groupId: null,
    showInCalendar: true,
    showInTodo: false,
    done: false,
    hasDueDate: true,
    checklist: [],
    participants: [],
    attachments: [],
    reminders: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

function weekOf(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startOfDay(monday), i));
}

describe("isBandItem", () => {
  it("traktuje całodniowe jako pasek", () => {
    expect(isBandItem(makeItem({ allDay: true }))).toBe(true);
  });

  it("traktuje wydarzenie z godziną w jednym dniu jako punktowe", () => {
    expect(
      isBandItem(
        makeItem({
          allDay: false,
          start: "2026-08-19T09:00:00",
          end: "2026-08-19T10:30:00",
        }),
      ),
    ).toBe(false);
  });

  it("traktuje wydarzenie przechodzące przez północ jako pasek", () => {
    expect(
      isBandItem(
        makeItem({
          allDay: false,
          start: "2026-08-19T22:00:00",
          end: "2026-08-20T01:00:00",
        }),
      ),
    ).toBe(true);
  });
});

describe("bandSpanInRange", () => {
  const monday = startOfDay(new Date(2026, 7, 17)); // 17 sierpnia 2026, poniedziałek
  const week = weekOf(monday);

  it("obcina pasek wielodniowy do tygodnia i oznacza kontynuację", () => {
    // 19–23 sie (śr–niedz), all-day end exclusive 24
    const span = bandSpanInRange(
      makeItem({
        start: "2026-08-19T12:00:00.000Z",
        end: "2026-08-24T12:00:00.000Z",
      }),
      week[0],
      7,
    );
    expect(span).toEqual({
      startIdx: 2,
      endIdx: 6,
      continuesLeft: false,
      continuesRight: false,
    });
  });

  it("oznacza continuesLeft/Right gdy wydarzenie wychodzi poza tydzień", () => {
    const span = bandSpanInRange(
      makeItem({
        start: "2026-08-14T12:00:00.000Z",
        end: "2026-08-26T12:00:00.000Z",
      }),
      week[0],
      7,
    );
    expect(span?.startIdx).toBe(0);
    expect(span?.endIdx).toBe(6);
    expect(span?.continuesLeft).toBe(true);
    expect(span?.continuesRight).toBe(true);
  });

  it("zwraca null poza zakresem", () => {
    expect(
      bandSpanInRange(
        makeItem({
          start: "2026-08-01T12:00:00.000Z",
          end: "2026-08-03T12:00:00.000Z",
        }),
        week[0],
        7,
      ),
    ).toBeNull();
  });
});

describe("stackBandBars", () => {
  it("układa nachodzące paski w osobnych wierszach", () => {
    const placed = stackBandBars([
      { id: "a", startIdx: 0, endIdx: 4 },
      { id: "b", startIdx: 2, endIdx: 6 },
      { id: "c", startIdx: 5, endIdx: 6 },
    ]);
    expect(placed.find((p) => p.id === "a")?.row).toBe(0);
    expect(placed.find((p) => p.id === "b")?.row).toBe(1);
    expect(placed.find((p) => p.id === "c")?.row).toBe(0);
  });
});

describe("layoutBandItems", () => {
  it("ignoruje wydarzenia godzinowe z jednego dnia", () => {
    const monday = startOfDay(new Date(2026, 7, 17));
    const bars = layoutBandItems(weekOf(monday), [
      makeItem({
        id: "timed",
        allDay: false,
        start: "2026-08-19T09:00:00",
        end: "2026-08-19T10:00:00",
      }),
      makeItem({
        id: "stay",
        title: "Stay",
        start: "2026-08-19T12:00:00.000Z",
        end: "2026-08-24T12:00:00.000Z",
      }),
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0].item.id).toBe("stay");
    expect(bars[0].startIdx).toBe(2);
    expect(bars[0].endIdx).toBe(6);
    expect(bars[0].row).toBe(0);
  });
});
