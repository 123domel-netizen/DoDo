import { useMemo } from "react";
import { useStore } from "@/state/store";
import { getViewDays } from "@/lib/time";
import { itemMatchesGroupFilter } from "@/lib/groups";
import { collectReminderMarkers } from "@/lib/reminders";
import { TimeGrid } from "./TimeGrid";
import { MonthView } from "./MonthView";
import type { Group } from "@/types";

export function CalendarView() {
  const settings = useStore((s) => s.settings);
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);

  const days = useMemo(
    () => getViewDays(settings.view, new Date(settings.anchorDate), settings.nineDayStartWeekday),
    [settings.view, settings.anchorDate, settings.nineDayStartWeekday],
  );

  const groups = useMemo(() => {
    const map: Record<string, Group> = {};
    for (const g of groupsArr) map[g.id] = g;
    return map;
  }, [groupsArr]);

  const filteredItems = useMemo(
    () =>
      Object.values(itemsMap).filter((it) =>
        itemMatchesGroupFilter(it, activeGroupFilter),
      ),
    [itemsMap, activeGroupFilter],
  );

  const items = useMemo(
    () => filteredItems.filter((it) => it.hasDueDate && it.showInCalendar),
    [filteredItems],
  );

  const reminderMarkers = useMemo(
    () => collectReminderMarkers(filteredItems),
    [filteredItems],
  );

  return (
    <div className="flex h-full flex-col bg-surface">
      {settings.view === "month" ? (
        <MonthView days={days} items={items} reminderMarkers={reminderMarkers} groups={groups} />
      ) : (
        <TimeGrid days={days} items={items} reminderMarkers={reminderMarkers} groups={groups} />
      )}
    </div>
  );
}
