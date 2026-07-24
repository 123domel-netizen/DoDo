import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_REMINDER_ID,
  defaultEventReminderBody,
  hasExplicitFiveMinuteReminder,
  shouldApplyDefaultEventReminder,
} from "@/lib/defaultEventReminder";

describe("defaultEventReminder", () => {
  it("buduje treść powiadomienia", () => {
    expect(defaultEventReminderBody("Testy")).toBe(
      "Za 5 minut zaczyna się wydarzenie: Testy",
    );
    expect(defaultEventReminderBody("  ")).toBe(
      "Za 5 minut zaczyna się wydarzenie: Wydarzenie",
    );
  });

  it("kwalifikuje tylko wydarzenia z godziną", () => {
    expect(shouldApplyDefaultEventReminder({ type: "event", allDay: false })).toBe(true);
    expect(shouldApplyDefaultEventReminder({ type: "event", all_day: true })).toBe(false);
    expect(shouldApplyDefaultEventReminder({ type: "task" })).toBe(false);
    expect(
      shouldApplyDefaultEventReminder({ type: "event", hasDueDate: false }),
    ).toBe(false);
  });

  it("wykrywa jawne 5 min", () => {
    expect(hasExplicitFiveMinuteReminder([])).toBe(false);
    expect(hasExplicitFiveMinuteReminder([{ offsetMinutes: 5 }])).toBe(true);
    expect(
      hasExplicitFiveMinuteReminder([{ offsetMinutes: 5, remindAt: "2026-01-01T00:00:00Z" }]),
    ).toBe(false);
    expect(DEFAULT_EVENT_REMINDER_ID).toBe("default-5m");
  });
});
