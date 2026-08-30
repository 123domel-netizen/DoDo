import type { Group, Item } from "@/types";
import type { ReminderMarker } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";
import { MobileWeekOverview } from "@/components/calendar/MobileWeekOverview";

interface MobileWeekViewProps {
  weekDays: Date[];
  items: Item[];
  reminderMarkers: ReminderMarker[];
  deadlineMarkers: DeadlineMarker[];
  groups: Record<string, Group>;
  onViewDay: (day: Date) => void;
}

/** Tydzień = przegląd tygodnia (7 kolumn, paski wielodniowe, bez siatki godzin). */
export function MobileWeekView({
  weekDays,
  items,
  groups,
  onViewDay,
}: MobileWeekViewProps) {
  return (
    <MobileWeekOverview
      weekDays={weekDays}
      items={items}
      groups={groups}
      onViewDay={onViewDay}
    />
  );
}
