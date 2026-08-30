import { getViewDays } from "@/lib/time";
import { fmt } from "@/lib/format";
import type { CalendarViewKind } from "@/types";

export { fmt };

export type MobileCalendarMode = CalendarViewKind | "today";

const MOBILE_CALENDAR_VIEW_KEY = "dodo-mobile-calendar-view-v1";

export const DEFAULT_MOBILE_CALENDAR_VIEW: MobileCalendarMode = "week";

export function loadMobileCalendarView(): MobileCalendarMode {
  try {
    const raw = localStorage.getItem(MOBILE_CALENDAR_VIEW_KEY);
    if (
      raw === "today" ||
      raw === "day" ||
      raw === "week" ||
      raw === "month"
    ) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_MOBILE_CALENDAR_VIEW;
}

export function saveMobileCalendarView(view: MobileCalendarMode): void {
  try {
    localStorage.setItem(MOBILE_CALENDAR_VIEW_KEY, view);
  } catch {
    /* ignore */
  }
}

export function getViewLabel(
  view: CalendarViewKind,
  anchor: Date,
  nineDayStartWeekday: number,
): string {
  const days = getViewDays(view, anchor, nineDayStartWeekday);
  if (view === "day") return fmt(days[0], "EEEE, d MMMM");
  if (view === "month") return fmt(anchor, "LLLL yyyy");
  const first = days[0];
  const last = days[days.length - 1];
  const sameMonth = first.getMonth() === last.getMonth();
  if (sameMonth) return `${fmt(first, "d")}–${fmt(last, "d MMMM yyyy")}`;
  return `${fmt(first, "d MMM")} – ${fmt(last, "d MMM yyyy")}`;
}

/** Etykieta środkowa paska nawigacji kalendarza (mobile). */
export function getMobileCalendarNavLabel(
  view: MobileCalendarMode,
  anchor: Date,
  nineDayStartWeekday: number,
): string {
  if (view === "today") return fmt(new Date(), "EEEE, d MMMM");
  if (view === "day") return fmt(anchor, "EEEE, d MMMM");
  if (view === "month") return fmt(anchor, "LLLL yyyy");
  return getViewLabel("week", anchor, nineDayStartWeekday);
}
