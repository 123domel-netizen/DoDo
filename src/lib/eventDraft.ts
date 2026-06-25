import { isSameDay, startOfDay } from "date-fns";
import { setMinutesOfDay } from "@/lib/time";

/** Domyślny zakres draftu wydarzenia dla wybranego dnia (mobile / kalendarz). */
export function defaultEventDraftRange(
  day: Date,
  explicitMinutes?: number,
): { start: string; end: string } {
  const base = startOfDay(day);
  const now = new Date();
  let start: Date;

  if (explicitMinutes !== undefined) {
    start = setMinutesOfDay(base, explicitMinutes);
  } else if (isSameDay(day, now)) {
    start = new Date(now);
    start.setSeconds(0, 0);
    start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
  } else {
    start = new Date(base);
    start.setHours(9, 0, 0, 0);
  }

  const end = new Date(start.getTime() + 3600000);
  return { start: start.toISOString(), end: end.toISOString() };
}
