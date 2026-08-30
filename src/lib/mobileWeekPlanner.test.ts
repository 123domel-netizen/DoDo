import { describe, expect, it } from "vitest";
import { addDays, startOfDay } from "date-fns";
import type { Item } from "@/types";
import {
  busyBarHeight,
  dayActivityCount,
  timedEventsForDay,
  weekTimedSections,
} from "@/lib/mobileWeekPlanner";

const mon = startOfDay(new Date("2026-09-01T12:00:00"));

function event(overrides: Partial<Item> & Pick<Item, "id" | "start" | "end">): Item {
  return {
    type: "event",
    title: "Test",
    allDay: false,
    hasDueDate: true,
    showInCalendar: true,
    showInTodo: false,
    done: false,
    groupId: null,
    checklist: [],
    reminders: [],
    ...overrides,
  } as Item;
}

describe("mobileWeekPlanner", () => {
  it("timedEventsForDay excludes all-day band items and tasks", () => {
    const items = [
      event({
        id: "1",
        start: new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 10, 0).toISOString(),
        end: new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 11, 0).toISOString(),
      }),
      event({
        id: "2",
        allDay: true,
        start: mon.toISOString(),
        end: addDays(mon, 1).toISOString(),
      }),
      event({ id: "3", type: "task", start: mon.toISOString(), end: mon.toISOString() }),
    ];
    const timed = timedEventsForDay(mon, items);
    expect(timed.map((i) => i.id)).toEqual(["1"]);
  });

  it("dayActivityCount includes all-day items", () => {
    const items = [
      event({
        id: "a",
        allDay: true,
        start: mon.toISOString(),
        end: addDays(mon, 1).toISOString(),
      }),
      event({
        id: "b",
        start: new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0).toISOString(),
        end: new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 15, 0).toISOString(),
      }),
    ];
    expect(dayActivityCount(mon, items)).toBe(2);
  });

  it("busyBarHeight scales with count", () => {
    expect(busyBarHeight(0)).toBe(0);
    expect(busyBarHeight(1)).toBeGreaterThan(0);
    expect(busyBarHeight(20)).toBeLessThanOrEqual(14);
  });

  it("weekTimedSections omits empty days", () => {
    const wed = addDays(mon, 2);
    const items = [
      event({
        id: "1",
        start: new Date(wed.getFullYear(), wed.getMonth(), wed.getDate(), 10, 0).toISOString(),
        end: new Date(wed.getFullYear(), wed.getMonth(), wed.getDate(), 11, 0).toISOString(),
      }),
    ];
    const sections = weekTimedSections([mon, addDays(mon, 1), wed], items);
    expect(sections).toHaveLength(1);
    expect(sections[0].events).toHaveLength(1);
  });
});
