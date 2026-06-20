import { getViewDays } from "@/lib/time";
import { fmt } from "@/lib/format";
import type { CalendarViewKind } from "@/types";

export { fmt };

export function getViewLabel(
  view: CalendarViewKind,
  anchor: Date,
  nineDayStartWeekday: number,
): string {
  const days = getViewDays(view, anchor, nineDayStartWeekday);
  if (view === "day") return fmt(days[0], "EEEE, d MMMM yyyy");
  if (view === "month") return fmt(anchor, "LLLL yyyy");
  const first = days[0];
  const last = days[days.length - 1];
  const sameMonth = first.getMonth() === last.getMonth();
  if (sameMonth) return `${fmt(first, "d")}–${fmt(last, "d MMMM yyyy")}`;
  return `${fmt(first, "d MMM")} – ${fmt(last, "d MMM yyyy")}`;
}
