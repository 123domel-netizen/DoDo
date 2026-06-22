import { AlarmClock } from "lucide-react";
import { isSameDay } from "date-fns";
import type { Item } from "@/types";
import { deadlineIconDimmed, deadlineTooltipTitle } from "@/lib/deadlines";

export function DeadlineClock({
  item,
  day,
  size = 10,
}: {
  item: Item;
  day?: Date;
  size?: number;
}) {
  if (!item.deadlineAt) return null;
  const deadline = new Date(item.deadlineAt);
  if (day && !isSameDay(deadline, day)) return null;
  const dim = deadlineIconDimmed(item);
  const title = deadlineTooltipTitle(item);
  return (
    <span title={title} aria-label={title} className="inline-flex shrink-0">
      <AlarmClock
        size={size}
        className={`text-red-500 ${dim ? "opacity-50" : ""}`}
        aria-hidden
      />
    </span>
  );
}
