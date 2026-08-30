import { useMemo, useCallback, lazy, Suspense, type ComponentType } from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import { useStore } from "@/state/store";
import { useSchedulesAvailable } from "@/hooks/useScheduleRepo";
import { getViewDays } from "@/lib/time";
import { itemMatchesGroupFilter, groupIdForNewItem } from "@/lib/groups";
import { collectReminderMarkers } from "@/lib/reminders";
import { collectDeadlineMarkers } from "@/lib/deadlines";
import { expandItemsForRange } from "@/lib/recurrence";
import { withNormalizedAllDay, itemCoversCalendarDay } from "@/lib/allDay";
import { defaultEventDraftRange } from "@/lib/eventDraft";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useHorizontalSwipe } from "@/hooks/useHorizontalSwipe";
import { CalendarNav } from "./CalendarNav";
import { TimeGrid } from "./TimeGrid";
import { MonthView } from "./MonthView";
import { MobileMonthView } from "./MobileMonthView";
import { MobileWeekView } from "./MobileWeekView";
import { MobileDayView } from "./MobileDayView";
import { MainDashboardView } from "@/components/dashboard/MainDashboardView";
import type { CalendarViewKind, Group } from "@/types";

const SchedulesCanvas: ComponentType<{
  onClose: () => void;
  embedded?: boolean;
  initialSection?: "board" | "attendance";
}> = lazy(() =>
  import("@/components/projectsPreview/ProjectsPreviewApp").then((m) => ({
    default: m.ProjectsPreviewApp,
  })),
);

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
  const view = viewOverride ?? settings.view;
  const selectedDay = useMemo(
    () => startOfDay(new Date(settings.anchorDate)),
    [settings.anchorDate],
  );

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

  /** Zadania na wybrany dzień (sekcja ZADANIA w widoku dnia). */
  const tasksForSelectedDay = useMemo(() => {
    const byId = new Map<string, (typeof items)[number]>();

    for (const it of items) {
      if (it.type === "task" && itemCoversCalendarDay(it, selectedDay)) {
        byId.set(it.id, it);
      }
    }

    const todoBase = Object.values(itemsMap)
      .filter(
        (it) =>
          it.type === "task" &&
          it.showInTodo &&
          itemMatchesGroupFilter(it, activeGroupFilter, "todo"),
      )
      .map(withNormalizedAllDay);
    const dayEnd = addDays(selectedDay, 1);
    for (const it of expandItemsForRange(todoBase, selectedDay, dayEnd)) {
      if (it.hasDueDate && itemCoversCalendarDay(it, selectedDay)) {
        byId.set(it.id, it);
      }
    }

    return [...byId.values()];
  }, [items, itemsMap, activeGroupFilter, selectedDay]);

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

  const mobileHybrid =
    isMobile && viewOverride !== undefined && (view === "week" || view === "day");

  const swipeHandlers = useHorizontalSwipe({
    // Week/day mają własny swipe po dniach.
    enabled: isMobile && viewOverride !== undefined && !mobileHybrid,
    onSwipeLeft: () => shiftCalendar(1),
    onSwipeRight: () => shiftCalendar(-1),
  });

  const selectDay = useCallback(
    (day: Date) => {
      setSettings({ anchorDate: startOfDay(day).toISOString() });
    },
    [setSettings],
  );

  const handleViewDay = useCallback(
    (day: Date) => {
      const d = startOfDay(day);
      if (onViewDay) onViewDay(d);
      else setSettings({ view: "day", anchorDate: d.toISOString() });
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
  const schedulesAvailable = useSchedulesAvailable();
  const showMainDashboard = !isMobile && settings.mainAreaMode === "dashboard";
  const showProjects =
    !isMobile &&
    (settings.mainAreaMode === "projects" ||
      settings.mainAreaMode === "attendance") &&
    schedulesAvailable;

  return (
    <div
      className="flex h-full flex-col bg-surface touch-pan-y"
      {...(mobileCalendar ? swipeHandlers : {})}
    >
      {!isMobile && <CalendarNav />}
      {showProjects ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
              Ładowanie harmonogramów…
            </div>
          }
        >
          <SchedulesCanvas
            embedded
            initialSection={
              settings.mainAreaMode === "attendance" ? "attendance" : "board"
            }
            onClose={() => setSettings({ mainAreaMode: "calendar" })}
          />
        </Suspense>
      ) : showMainDashboard ? (
        <MainDashboardView />
      ) : view === "month" ? (
        mobileCalendar ? (
          <MobileMonthView
            days={days}
            items={items}
            reminderMarkers={reminderMarkers}
            deadlineMarkers={deadlineMarkers}
            groups={groups}
            selectedDay={selectedDay}
            onSelectDay={selectDay}
            onViewDay={handleViewDay}
            onAddEvent={handleAddEventFromDay}
          />
        ) : (
          <MonthView
            days={days}
            items={items}
            reminderMarkers={reminderMarkers}
            deadlineMarkers={deadlineMarkers}
            groups={groups}
          />
        )
      ) : mobileCalendar && view === "week" ? (
        <MobileWeekView
          weekDays={days}
          items={items}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          onViewDay={handleViewDay}
        />
      ) : mobileCalendar && view === "day" ? (
        <MobileDayView
          day={selectedDay}
          items={items}
          tasksForDay={tasksForSelectedDay}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          onSelectDay={selectDay}
        />
      ) : (
        <TimeGrid
          days={days}
          items={items}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          isMobile={mobileCalendar}
          selectedDay={selectedDay}
          onSelectDay={mobileCalendar ? selectDay : undefined}
          onSlotTap={mobileCalendar ? handleSlotTap : undefined}
        />
      )}
    </div>
  );
}
