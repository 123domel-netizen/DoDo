import { useMemo, useState, useCallback } from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import { useStore } from "@/state/store";
import { getViewDays } from "@/lib/time";
import { itemMatchesGroupFilter, groupIdForNewItem } from "@/lib/groups";
import { collectReminderMarkers } from "@/lib/reminders";
import { collectDeadlineMarkers } from "@/lib/deadlines";
import { expandItemsForRange } from "@/lib/recurrence";
import { withNormalizedAllDay } from "@/lib/allDay";
import { defaultEventDraftRange } from "@/lib/eventDraft";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useHorizontalSwipe } from "@/hooks/useHorizontalSwipe";
import { CalendarDaySheet } from "@/components/mobile/CalendarDaySheet";
import { CalendarNav } from "./CalendarNav";
import { TimeGrid } from "./TimeGrid";
import { MonthView } from "./MonthView";
import type { CalendarViewKind, Group } from "@/types";

export function CalendarView({
  view: viewOverride,
  onViewDay,
}: {
  view?: CalendarViewKind;
  onViewDay?: (day: Date) => void;
} = {}) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const startDraft = useStore((s) => s.startDraft);
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const isMobile = useIsMobile();
  const [daySheetDate, setDaySheetDate] = useState<Date | null>(null);

  const view = viewOverride ?? settings.view;

  const days = useMemo(
    () => getViewDays(view, new Date(settings.anchorDate), settings.nineDayStartWeekday),
    [view, settings.anchorDate, settings.nineDayStartWeekday],
  );

  const groups = useMemo(() => {
    const map: Record<string, Group> = {};
    for (const g of groupsArr) map[g.id] = g;
    return map;
  }, [groupsArr]);

  const filteredItems = useMemo(
    () =>
      Object.values(itemsMap).filter((it) =>
        itemMatchesGroupFilter(it, activeGroupFilter, "events"),
      ),
    [itemsMap, activeGroupFilter],
  );

  const items = useMemo(() => {
    const base = filteredItems
      .filter((it) => it.hasDueDate && it.showInCalendar)
      .map(withNormalizedAllDay);
    if (!days.length) return base;
    const rangeEnd = addDays(days[days.length - 1], 1);
    return expandItemsForRange(base, days[0], rangeEnd);
  }, [filteredItems, days]);

  const reminderMarkers = useMemo(
    () => collectReminderMarkers(filteredItems),
    [filteredItems],
  );

  const deadlineMarkers = useMemo(
    () => collectDeadlineMarkers(filteredItems),
    [filteredItems],
  );

  const shiftCalendar = useCallback(
    (dir: number) => {
      const anchor = new Date(settings.anchorDate);
      if (view === "month") {
        setSettings({ anchorDate: startOfDay(addMonths(anchor, dir)).toISOString() });
      } else if (view === "week" || view === "eleven") {
        setSettings({ anchorDate: startOfDay(addDays(anchor, dir * 7)).toISOString() });
      } else {
        setSettings({ anchorDate: startOfDay(addDays(anchor, dir)).toISOString() });
      }
    },
    [view, settings.anchorDate, setSettings],
  );

  const swipeHandlers = useHorizontalSwipe({
    enabled: isMobile && viewOverride !== undefined,
    onSwipeLeft: () => shiftCalendar(1),
    onSwipeRight: () => shiftCalendar(-1),
  });

  const openDaySheet = useCallback((day: Date) => {
    setDaySheetDate(startOfDay(day));
  }, []);

  const closeDaySheet = useCallback(() => setDaySheetDate(null), []);

  const handleViewDay = useCallback(
    (day: Date) => {
      const d = startOfDay(day);
      if (onViewDay) onViewDay(d);
      else setSettings({ view: "day", anchorDate: d.toISOString() });
      setDaySheetDate(null);
    },
    [onViewDay, setSettings],
  );

  const handleAddEventFromDay = useCallback(
    (day: Date) => {
      const { start, end } = defaultEventDraftRange(day);
      startDraft({
        type: "event",
        start,
        end,
        groupId: groupIdForNewItem(),
      });
      setDaySheetDate(null);
    },
    [startDraft],
  );

  const handleSlotTap = useCallback(
    (day: Date, minutes: number) => {
      const { start, end } = defaultEventDraftRange(day, minutes);
      startDraft({
        type: "event",
        start,
        end,
        groupId: groupIdForNewItem(),
      });
    },
    [startDraft],
  );

  const mobileCalendar = isMobile && viewOverride !== undefined;

  return (
    <div
      className="flex h-full flex-col bg-surface touch-pan-y"
      {...(mobileCalendar ? swipeHandlers : {})}
    >
      {!isMobile && <CalendarNav />}
      {view === "month" ? (
        <MonthView
          days={days}
          items={items}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          isMobile={mobileCalendar}
          onDayTap={mobileCalendar ? openDaySheet : undefined}
        />
      ) : (
        <TimeGrid
          days={days}
          items={items}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          isMobile={mobileCalendar}
          onDayHeaderTap={mobileCalendar ? openDaySheet : undefined}
          onSlotTap={mobileCalendar ? handleSlotTap : undefined}
        />
      )}
      {daySheetDate && (
        <CalendarDaySheet
          day={daySheetDate}
          onClose={closeDaySheet}
          onViewDay={() => handleViewDay(daySheetDate)}
          onAddEvent={() => handleAddEventFromDay(daySheetDate)}
        />
      )}
    </div>
  );
}
