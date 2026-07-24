/**
 * Syntetyczne przypomnienie T-5 dla wydarzeń z godziną.
 * Działa w silniku (send-reminders + lokalny scheduler) nawet gdy
 * `reminders: []` — bez zapisu w edytorze.
 */

export const DEFAULT_EVENT_REMINDER_ID = "default-5m";
export const DEFAULT_EVENT_REMINDER_OFFSET_MINUTES = 5;

export function defaultEventReminderBody(title: string): string {
  const name = title.trim() || "Wydarzenie";
  return `Za 5 minut zaczyna się wydarzenie: ${name}`;
}

/** Czy item kwalifikuje się do automatycznego T-5. */
export function shouldApplyDefaultEventReminder(item: {
  type: string;
  allDay?: boolean;
  all_day?: boolean;
  hasDueDate?: boolean;
  payload?: { hasDueDate?: boolean };
}): boolean {
  if (item.type !== "event") return false;
  const allDay = item.allDay ?? item.all_day ?? false;
  if (allDay) return false;
  const hasDue =
    item.hasDueDate ?? item.payload?.hasDueDate ?? true;
  return hasDue !== false;
}

/**
 * True, gdy wśród względnych reminderów jest już offset 5 min
 * (jawne przypomnienie wygrywa — bez dublowania z default-5m).
 */
export function hasExplicitFiveMinuteReminder(
  reminders: Array<{ offsetMinutes?: number; remindAt?: string | null }>,
): boolean {
  return reminders.some(
    (r) => !r.remindAt && (r.offsetMinutes ?? 0) === DEFAULT_EVENT_REMINDER_OFFSET_MINUTES,
  );
}
