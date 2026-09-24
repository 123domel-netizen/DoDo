import { describe, expect, it } from "vitest";
import {
  coerceIsoOrNull,
  coerceItemType,
  DATE_PLACEHOLDER_ISO,
  isValidIso,
  sanitizeItemDates,
  sanitizeItemsRecord,
} from "./dates";
import { createItem } from "./factory";
import { fmt, fmtRange } from "./format";

describe("walidacja dat", () => {
  it("odrzuca puste i śmieciowe stringi", () => {
    expect(isValidIso("")).toBe(false);
    expect(isValidIso("   ")).toBe(false);
    expect(isValidIso("not-a-date")).toBe(false);
    expect(isValidIso("NaN-NaN-NaNT12:00:00.000Z")).toBe(false);
    expect(coerceIsoOrNull("")).toBeNull();
    expect(coerceIsoOrNull("garbage")).toBeNull();
  });

  it("akceptuje poprawne ISO", () => {
    expect(isValidIso("2026-09-21T10:00:00.000Z")).toBe(true);
    expect(coerceIsoOrNull("2026-09-21T12:00:00+02:00")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("coerceItemType — NOT NULL type przy sync", () => {
  it("naprawia brakujący type z legacy IDB", () => {
    expect(
      coerceItemType({
        type: undefined as unknown as "event",
        showInTodo: false,
        showInCalendar: true,
      }),
    ).toBe("event");
    expect(
      coerceItemType({
        type: null as unknown as "event",
        showInTodo: true,
        showInCalendar: false,
      }),
    ).toBe("task");
  });

  it("sanitizeItemDates uzupełnia type przed upsertem", () => {
    const broken = {
      ...createItem({ type: "event", title: "x" }),
      type: undefined as unknown as "event",
    };
    const { item, repaired } = sanitizeItemDates(broken);
    expect(repaired).toBe(true);
    expect(item.type).toBe("event");
  });
});

describe("sanitizeItemDates — przyczyna Invalid time value", () => {
  it("demotuje wpis z zepsutym start/end zamiast zostawiać bombę w kalendarzu", () => {
    const bad = createItem({
      type: "event",
      title: "Zepsute",
      start: "not-a-date",
      end: "",
      hasDueDate: true,
      showInCalendar: true,
    });
    // createItem already may coerce via new Date — force bad fields
    const forced = { ...bad, start: "not-a-date", end: "also-bad" };
    const { item, demotedDueDate, repaired } = sanitizeItemDates(forced);
    expect(repaired).toBe(true);
    expect(demotedDueDate).toBe(true);
    expect(item.hasDueDate).toBe(false);
    expect(item.showInCalendar).toBe(false);
    expect(item.start).toBe(DATE_PLACEHOLDER_ISO);
    expect(item.end).toBe(DATE_PLACEHOLDER_ISO);
  });

  it("uzupełnia brakujący end z startu", () => {
    const base = createItem({
      type: "event",
      start: "2026-09-21T10:00:00.000Z",
      end: "2026-09-21T11:00:00.000Z",
    });
    const { item } = sanitizeItemDates({ ...base, end: "nope" });
    expect(item.start).toBe("2026-09-21T10:00:00.000Z");
    expect(item.end).toBe("2026-09-21T10:00:00.000Z");
  });

  it("czyści zły deadlineAt i remindAt", () => {
    const base = createItem({ type: "task", hasDueDate: true });
    const { item } = sanitizeItemDates({
      ...base,
      deadlineAt: "???",
      reminders: [{ id: "1", offsetMinutes: 10, remindAt: "bad" }],
    });
    expect(item.deadlineAt).toBeNull();
    expect(item.reminders[0]?.remindAt).toBeNull();
  });

  it("pomija zmodyfikowane wyjątki recurrence ze złą datą", () => {
    const base = createItem({ type: "event" });
    const { item } = sanitizeItemDates({
      ...base,
      googleRecurrenceExceptions: [
        {
          originalStart: "2026-01-01T10:00:00.000Z",
          status: "modified",
          start: "garbage",
          end: "2026-01-01T11:00:00.000Z",
        },
        {
          originalStart: "2026-01-02T10:00:00.000Z",
          status: "cancelled",
        },
      ],
    });
    expect(item.googleRecurrenceExceptions).toEqual([
      { originalStart: "2026-01-02T10:00:00.000Z", status: "cancelled" },
    ]);
  });
});

describe("fmt — ostatnia linia obrony UI", () => {
  it("nie rzuca Invalid time value dla śmieci", () => {
    expect(fmt("not-a-date", "HH:mm")).toBe("—");
    expect(fmtRange("", "also-bad")).toBe("—–—");
  });

  it("formatuje poprawne daty", () => {
    expect(fmt("2026-09-21T15:30:00.000Z", "yyyy")).toBe("2026");
  });
});

describe("sanitizeItemsRecord", () => {
  it("naprawia mapę wpisów", () => {
    const good = createItem({ type: "event", title: "ok" });
    const bad = {
      ...createItem({ type: "event", title: "bad" }),
      start: "x",
      end: "y",
    };
    const { items, demotedCount, repairedCount } = sanitizeItemsRecord({
      [good.id]: good,
      [bad.id]: bad,
    });
    expect(demotedCount).toBe(1);
    expect(repairedCount).toBeGreaterThanOrEqual(1);
    expect(items[bad.id]?.hasDueDate).toBe(false);
    expect(items[good.id]?.start).toBe(good.start);
  });
});
