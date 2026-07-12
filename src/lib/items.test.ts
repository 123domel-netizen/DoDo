import { describe, expect, it } from "vitest";
import type { Item } from "@/types";
import { mergeItemOnSync, tombstoneItem, isItemDeleted } from "@/lib/items";

function makeItem(partial: Partial<Item>): Item {
  return {
    id: "it1",
    type: "task",
    title: "A",
    description: "",
    start: "2026-07-12T10:00:00.000Z",
    end: "2026-07-12T11:00:00.000Z",
    allDay: false,
    groupId: null,
    showInCalendar: true,
    showInTodo: true,
    done: false,
    hasDueDate: true,
    checklist: [],
    participants: [],
    attachments: [],
    reminders: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

describe("mergeItemOnSync", () => {
  it("bez lokalnego — bierze zdalny", () => {
    const remote = makeItem({ title: "R" });
    expect(mergeItemOnSync(undefined, remote).title).toBe("R");
  });

  it("nowszy zdalny wygrywa", () => {
    const local = makeItem({ title: "L", updatedAt: "2026-07-02T00:00:00.000Z" });
    const remote = makeItem({ title: "R", updatedAt: "2026-07-03T00:00:00.000Z" });
    expect(mergeItemOnSync(local, remote).title).toBe("R");
  });

  it("nowszy lokalny wygrywa", () => {
    const local = makeItem({ title: "L", updatedAt: "2026-07-04T00:00:00.000Z" });
    const remote = makeItem({ title: "R", updatedAt: "2026-07-03T00:00:00.000Z" });
    expect(mergeItemOnSync(local, remote).title).toBe("L");
  });

  it("zdalny tombstone kasuje aktywny lokalny", () => {
    const local = makeItem({ updatedAt: "2026-07-05T00:00:00.000Z" });
    const remote = makeItem({
      deletedAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
    });
    expect(isItemDeleted(mergeItemOnSync(local, remote))).toBe(true);
  });

  it("edycja zdalna NOWSZA niż lokalny tombstone przywraca item", () => {
    const local = makeItem({
      deletedAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    });
    const remote = makeItem({ title: "R", updatedAt: "2026-07-04T00:00:00.000Z" });
    const merged = mergeItemOnSync(local, remote);
    expect(isItemDeleted(merged)).toBe(false);
    expect(merged.title).toBe("R");
  });

  it("lokalny tombstone wygrywa ze STARSZYM zdalnym", () => {
    const local = makeItem({
      deletedAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    });
    const remote = makeItem({ title: "R", updatedAt: "2026-07-04T00:00:00.000Z" });
    expect(isItemDeleted(mergeItemOnSync(local, remote))).toBe(true);
  });
});

describe("tombstoneItem", () => {
  it("ustawia deletedAt/deletedBy/updatedAt", () => {
    const t = tombstoneItem(makeItem({}), "user-1");
    expect(isItemDeleted(t)).toBe(true);
    expect(t.deletedBy).toBe("user-1");
    expect(t.updatedAt).toBe(t.deletedAt);
  });
});
