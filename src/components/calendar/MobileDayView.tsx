import { useMemo } from "react";
import { addDays, isSameDay, startOfDay } from "date-fns";
import type { Group, Item } from "@/types";
import { useStore } from "@/state/store";
import { fmt } from "@/lib/format";
import { isBandItem } from "@/lib/allDayBars";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { useHorizontalSwipe } from "@/hooks/useHorizontalSwipe";
import type { ReminderMarker } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";
import { MobileDayAllDayPills } from "@/components/calendar/MobileAllDayPills";
import { MobileChronoAgenda } from "@/components/calendar/MobileChronoAgenda";
import {
  DaySummaryChips,
  MobileDeadlinesSection,
  MobileTasksSection,
  NextUpcomingCard,
} from "@/components/calendar/MobileDaySections";
import { findNextUpcomingItem } from "@/lib/mobileDayEntries";

interface MobileDayViewProps {
  day: Date;
  items: Item[];
  tasksForDay: Item[];
  reminderMarkers: ReminderMarker[];
  deadlineMarkers: DeadlineMarker[];
  groups: Record<string, Group>;
  onSelectDay: (day: Date) => void;
}

/** Widok dnia — planowanie: podsumowanie, najbliższe, agenda, zadania, deadline'y. */
export function MobileDayView({
  day,
  items,
  tasksForDay,
  reminderMarkers,
  deadlineMarkers,
  groups,
  onSelectDay,
}: MobileDayViewProps) {
  const setEditing = useStore((s) => s.setEditing);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const today = isSameDay(day, new Date());

  const dayReminders = useMemo(
    () => reminderMarkers.filter((m) => isSameDay(m.at, day)),
    [reminderMarkers, day],
  );

  const dayDeadlines = useMemo(
    () =>
      deadlineMarkers
        .filter((m) => isSameDay(m.at, day))
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    [deadlineMarkers, day],
  );

  const timedItems = useMemo(
    () =>
      items.filter(
        (it) => !isBandItem(it) && it.type !== "task" && itemCoversCalendarDay(it, day),
      ),
    [items, day],
  );

  const tasks = useMemo(
    () =>
      [...tasksForDay].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.hasDueDate && !b.hasDueDate) return 0;
        if (!a.hasDueDate) return 1;
        if (!b.hasDueDate) return -1;
        return new Date(a.end).getTime() - new Date(b.end).getTime();
      }),
    [tasksForDay],
  );

  const eventCount = timedItems.length;
  const taskCount = tasks.filter((t) => !t.done).length;
  const deadlineCount = dayDeadlines.length;

  const nextUpcoming = useMemo(
    () => (today ? findNextUpcomingItem(day, items) : null),
    [today, day, items],
  );

  const swipeHandlers = useHorizontalSwipe({
    enabled: true,
    onSwipeLeft: () => onSelectDay(addDays(startOfDay(day), 1)),
    onSwipeRight: () => onSelectDay(addDays(startOfDay(day), -1)),
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" {...swipeHandlers}>
      <header className="shrink-0 border-b border-line px-4 pb-3 pt-3">
        <div
          className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${
            today ? "text-accent" : "text-ink-faint"
          }`}
        >
          {fmt(day, "EEEE")}
        </div>
        <div className="mt-0.5">
          <span
            className={`text-2xl font-semibold uppercase tracking-tight ${
              today ? "text-accent" : "text-ink"
            }`}
          >
            {fmt(day, "d MMMM")}
          </span>
        </div>
        <DaySummaryChips
          eventCount={eventCount}
          taskCount={taskCount}
          deadlineCount={deadlineCount}
        />
      </header>

      <MobileDayAllDayPills day={day} items={items} groups={groups} onOpen={setEditing} />

      {nextUpcoming && (
        <NextUpcomingCard item={nextUpcoming} groups={groups} onOpen={setEditing} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        <section className="border-b border-line">
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Plan dnia
          </h3>
          <MobileChronoAgenda
            key={day.toISOString()}
            day={day}
            items={timedItems}
            reminderMarkers={dayReminders}
            deadlineMarkers={[]}
            groups={groups}
            onOpen={setEditing}
            emptyMessage="Brak zaplanowanych wydarzeń."
          />
        </section>

        <MobileTasksSection
          tasks={tasks}
          groups={groups}
          onOpen={setEditing}
          onToggle={toggleTaskDone}
        />

        <MobileDeadlinesSection markers={dayDeadlines} onOpen={setEditing} />
      </div>
    </div>
  );
}
