import { describe, expect, it } from "vitest";
import { nativeRecurrenceToRruleLines, detectPreset, presetRecurrence } from "@/lib/recurrenceRules";

const item = { start: "2026-07-06T10:00:00.000Z" }; // poniedziałek

describe("nativeRecurrenceToRruleLines", () => {
  it("codziennie", () => {
    expect(nativeRecurrenceToRruleLines({ frequency: "daily", interval: 1 }, item)).toEqual([
      "RRULE:FREQ=DAILY;INTERVAL=1",
    ]);
  });

  it("co tydzień z dniami", () => {
    expect(
      nativeRecurrenceToRruleLines({ frequency: "weekly", interval: 2, byWeekday: [1, 3] }, item),
    ).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"]);
  });

  it("dni robocze", () => {
    expect(
      nativeRecurrenceToRruleLines({ frequency: "daily", interval: 1, weekdaysOnly: true }, item),
    ).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR"]);
  });

  it("COUNT ma pierwszeństwo przed UNTIL", () => {
    const lines = nativeRecurrenceToRruleLines(
      { frequency: "daily", interval: 1, count: 5, until: "2026-08-01T00:00:00.000Z" },
      item,
    );
    expect(lines[0]).toContain("COUNT=5");
    expect(lines[0]).not.toContain("UNTIL");
  });

  it("UNTIL na końcu dnia UTC", () => {
    const lines = nativeRecurrenceToRruleLines(
      { frequency: "daily", interval: 1, until: "2026-08-01T10:00:00.000Z" },
      item,
    );
    expect(lines[0]).toContain("UNTIL=20260801T235959Z");
  });
});

describe("presety", () => {
  it("preset weekly ustawia dzień tygodnia ze startu i jest wykrywany z powrotem", () => {
    const rec = presetRecurrence("weekly", item)!;
    expect(detectPreset(rec, item)).toBe("weekly");
  });

  it("reguła z until wykrywana jako custom", () => {
    expect(
      detectPreset({ frequency: "daily", interval: 1, until: "2026-08-01T00:00:00.000Z" }, item),
    ).toBe("custom");
  });
});
