import { describe, expect, it } from "vitest";
import type { Item } from "@/types";
import {
  collectDueNotifications,
  loadFiredLog,
  saveFiredLog,
  LATE_WINDOW_MS,
} from "@/lib/reminderScheduler";

const NOW = new Date("2026-07-12T09:50:00.000Z").getTime();

function makeItem(partial: Partial<Item>): Item {
  const iso = "2026-07-01T00:00:00.000Z";
  return {
    id: "it1",
    type: "event",
    title: "Test",
    description: "",
    start: "2026-07-12T10:00:00.000Z",
    end: "2026-07-12T11:00:00.000Z",
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
    createdAt: iso,
    updatedAt: iso,
    ...partial,
  };
}

const never = () => false;

describe("collectDueNotifications — przypomnienia względne", () => {
  it("odpala przypomnienie 10 min przed startem", () => {
    const item = makeItem({
      reminders: [{ id: "r1", offsetMinutes: 10 }],
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe("reminder");
    expect(due[0].markFiredReminderId).toBe("r1");
    expect(due[0].fireAt).toBe(new Date("2026-07-12T09:50:00.000Z").getTime());
  });

  it("nie odpala przypomnienia przed czasem", () => {
    const item = makeItem({
      start: "2026-07-12T11:00:00.000Z",
      end: "2026-07-12T12:00:00.000Z",
      reminders: [{ id: "r1", offsetMinutes: 10 }],
    });
    expect(collectDueNotifications([item], NOW, never)).toHaveLength(0);
  });

  it("doręcza spóźnione przypomnienie w oknie 60 min (np. po wybudzeniu)", () => {
    const item = makeItem({
      start: "2026-07-12T09:30:00.000Z",
      end: "2026-07-12T10:30:00.000Z",
      reminders: [{ id: "r1", offsetMinutes: 10 }], // fireAt 09:20, NOW 09:50
    });
    const due = collectDueNotifications([item], NOW, never);
    // Jawne 10 min + syntetyczne T-5 (09:25) — oba w LATE_WINDOW.
    expect(due.map((n) => n.key)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("r1"),
        expect.stringContaining("default-5m"),
      ]),
    );
  });

  it("pomija przypomnienie starsze niż okno", () => {
    const item = makeItem({
      start: new Date(NOW - LATE_WINDOW_MS - 5 * 60_000).toISOString(),
      end: new Date(NOW - LATE_WINDOW_MS).toISOString(),
      reminders: [{ id: "r1", offsetMinutes: 0 }],
    });
    expect(collectDueNotifications([item], NOW, never)).toHaveLength(0);
  });

  it("respektuje legacy firedAt dla nie-cyklicznych", () => {
    const item = makeItem({
      reminders: [{ id: "r1", offsetMinutes: 10, firedAt: "2026-07-12T09:50:05.000Z" }],
    });
    expect(collectDueNotifications([item], NOW, never)).toHaveLength(0);
  });

  it("pomija itemy done i usunięte", () => {
    const done = makeItem({ done: true, reminders: [{ id: "r1", offsetMinutes: 10 }] });
    const deleted = makeItem({
      id: "it2",
      deletedAt: "2026-07-10T00:00:00.000Z",
      reminders: [{ id: "r2", offsetMinutes: 10 }],
    });
    expect(collectDueNotifications([done, deleted], NOW, never)).toHaveLength(0);
  });

  it("bez terminu (hasDueDate=false) nie odpala względnych", () => {
    const item = makeItem({
      hasDueDate: false,
      reminders: [{ id: "r1", offsetMinutes: 10 }],
    });
    expect(collectDueNotifications([item], NOW, never)).toHaveLength(0);
  });
});

describe("collectDueNotifications — przypomnienia absolutne", () => {
  it("odpala remindAt niezależnie od terminu itemu", () => {
    const item = makeItem({
      hasDueDate: false,
      reminders: [{ id: "r1", offsetMinutes: 0, remindAt: "2026-07-12T09:49:00.000Z" }],
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].markFiredReminderId).toBe("r1");
  });
});

describe("collectDueNotifications — wydarzenia cykliczne", () => {
  const recurringDaily = makeItem({
    start: "2026-07-01T10:00:00.000Z",
    end: "2026-07-01T11:00:00.000Z",
    recurrence: { frequency: "daily", interval: 1 },
    reminders: [{ id: "r1", offsetMinutes: 10 }],
  });

  it("odpala przypomnienie dla DZISIEJSZEGO wystąpienia, nie tylko pierwszego", () => {
    // Bazowy start 1 lipca; NOW = 12 lipca 09:50 → wystąpienie dziś 10:00.
    const due = collectDueNotifications([recurringDaily], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].fireAt).toBe(new Date("2026-07-12T09:50:00.000Z").getTime());
    // Cykliczne nie patchują firedAt (dedupe po kluczu wystąpienia).
    expect(due[0].markFiredReminderId).toBeUndefined();
  });

  it("firedAt NIE blokuje kolejnych wystąpień cyklu", () => {
    const item = {
      ...recurringDaily,
      reminders: [{ id: "r1", offsetMinutes: 10, firedAt: "2026-07-01T09:50:00.000Z" }],
    };
    expect(collectDueNotifications([item], NOW, never)).toHaveLength(1);
  });

  it("dedupe po kluczu wystąpienia", () => {
    const first = collectDueNotifications([recurringDaily], NOW, never);
    const fired = new Set(first.map((n) => n.key));
    const second = collectDueNotifications([recurringDaily], NOW, (k) => fired.has(k));
    expect(second).toHaveLength(0);
  });

  it("cykl co tydzień odpala tylko we właściwy dzień", () => {
    const weekly = makeItem({
      start: "2026-07-06T10:00:00.000Z", // poniedziałek
      end: "2026-07-06T11:00:00.000Z",
      recurrence: { frequency: "weekly", interval: 1, byWeekday: [1] },
      reminders: [{ id: "r1", offsetMinutes: 10 }],
    });
    // NOW to niedziela 12 lipca — brak wystąpienia.
    expect(collectDueNotifications([weekly], NOW, never)).toHaveLength(0);
    // Poniedziałek 13 lipca 09:50 — jest.
    const mondayNow = new Date("2026-07-13T09:50:00.000Z").getTime();
    expect(collectDueNotifications([weekly], mondayNow, never)).toHaveLength(1);
  });
});

describe("collectDueNotifications — default T-5 wydarzenia", () => {
  it("odpala default-5m bez żadnego reminders[]", () => {
    const item = makeItem({
      title: "Standup",
      reminders: [],
      start: "2026-07-12T09:55:00.000Z",
      end: "2026-07-12T10:25:00.000Z",
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].key).toContain("default-5m");
    expect(due[0].body).toBe("Za 5 minut zaczyna się wydarzenie: Standup");
    expect(due[0].markFiredReminderId).toBeUndefined();
  });

  it("nie dubluje gdy jest jawne przypomnienie 5 min", () => {
    const item = makeItem({
      title: "Standup",
      reminders: [{ id: "r5", offsetMinutes: 5 }],
      start: "2026-07-12T09:55:00.000Z",
      end: "2026-07-12T10:25:00.000Z",
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].markFiredReminderId).toBe("r5");
    expect(due.every((n) => !n.key.includes("default-5m"))).toBe(true);
  });

  it("łączy jawne 1h z default T-5", () => {
    const item = makeItem({
      title: "Demo",
      reminders: [{ id: "r60", offsetMinutes: 60 }],
      start: "2026-07-12T09:55:00.000Z",
      end: "2026-07-12T10:55:00.000Z",
    });
    // NOW 09:50 → T-5 due (fire 09:50); 1h fire był 08:55 — poza LATE_WINDOW jeśli...
    // LATE_WINDOW = 60 min, 08:55 is 55 min ago → still in window!
    const due = collectDueNotifications([item], NOW, never);
    expect(due.map((n) => n.key).some((k) => k.includes("default-5m"))).toBe(true);
    expect(due.map((n) => n.key).some((k) => k.includes("r60"))).toBe(true);
  });

  it("pomija zadania i all-day", () => {
    const task = makeItem({
      type: "task",
      reminders: [],
      start: "2026-07-12T09:55:00.000Z",
    });
    const allDay = makeItem({
      allDay: true,
      reminders: [],
      start: "2026-07-12T09:55:00.000Z",
    });
    expect(collectDueNotifications([task, allDay], NOW, never)).toHaveLength(0);
  });
});

describe("collectDueNotifications — deadline", () => {
  it("odpala w chwili deadline'u", () => {
    const item = makeItem({
      type: "task",
      reminders: [],
      deadlineAt: "2026-07-12T09:50:00.000Z",
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe("deadline");
    expect(due[0].title).toContain("Deadline");
  });

  it("odpala 24 h przed deadlinem", () => {
    const item = makeItem({
      type: "task",
      deadlineAt: "2026-07-13T09:50:00.000Z",
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].key).toContain("deadline-24h");
  });

  it("nie odpala deadline'u dla itemów SHARE (uczestnik)", () => {
    const item = makeItem({
      shareRole: "participant",
      deadlineAt: "2026-07-12T09:50:00.000Z",
    });
    expect(collectDueNotifications([item], NOW, never)).toHaveLength(0);
  });

  it("zmiana deadline'u generuje nowy klucz (odpali się ponownie)", () => {
    const a = makeItem({ deadlineAt: "2026-07-12T09:50:00.000Z" });
    const keyA = collectDueNotifications([a], NOW, never)[0].key;
    const b = makeItem({ deadlineAt: "2026-07-12T09:45:00.000Z" });
    const keyB = collectDueNotifications([b], NOW, never)[0].key;
    expect(keyA).not.toBe(keyB);
  });
});

describe("collectDueNotifications — SHARE personalReminders", () => {
  it("uczestnik dostaje własne przypomnienia, nie właściciela", () => {
    const item = makeItem({
      shareRole: "participant",
      reminders: [{ id: "owner-r", offsetMinutes: 10 }],
      personalReminders: [{ id: "my-r", offsetMinutes: 10 }],
    });
    const due = collectDueNotifications([item], NOW, never);
    expect(due).toHaveLength(1);
    expect(due[0].markFiredReminderId).toBe("my-r");
    expect(due[0].shared).toBe(true);
  });
});

describe("fired log (localStorage)", () => {
  it("zapisuje i wczytuje log, przycinając stare wpisy", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const log = new Map<string, number>([
      ["fresh", NOW - 1000],
      ["stale", NOW - 8 * 24 * 60 * 60_000],
    ]);
    saveFiredLog(storage, log, NOW);
    const loaded = loadFiredLog(storage);
    expect(loaded.has("fresh")).toBe(true);
    expect(loaded.has("stale")).toBe(false);
  });

  it("brak storage → pusty log, bez wyjątku", () => {
    expect(loadFiredLog(null).size).toBe(0);
    expect(() => saveFiredLog(null, new Map(), NOW)).not.toThrow();
  });
});
