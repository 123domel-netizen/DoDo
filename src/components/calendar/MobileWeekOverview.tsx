import { useCallback, useMemo } from "react";
import { isSameDay, startOfDay } from "date-fns";
import type { Group, Item } from "@/types";
import { useStore } from "@/state/store";
import { fmt } from "@/lib/format";
import { baseItemId } from "@/lib/itemId";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import {
  dayActivityCount,
  weekHasCalendarEvents,
  weekTimedSections,
} from "@/lib/mobileWeekPlanner";
import { MobileWeekBandPills } from "@/components/calendar/MobileAllDayPills";
import { DashboardEventRow } from "@/components/dashboard/TodayDashboardPanel";

interface MobileWeekOverviewProps {
  weekDays: Date[];
  items: Item[];
  groups: Record<string, Group>;
  onViewDay: (day: Date) => void;
}

/** Kompaktowy pasek tygodnia — wszystkie 7 dni, kropka = zajęty. */
function WeekOverviewStrip({
  weekDays,
  items,
  onViewDay,
}: {
  weekDays: Date[];
  items: Item[];
  onViewDay: (day: Date) => void;
}) {
  const today = startOfDay(new Date());
  const loads = useMemo(
    () => weekDays.map((day) => dayActivityCount(day, items)),
    [weekDays, items],
  );

  return (
    <div className="flex px-0.5 py-1">
      {weekDays.map((day, i) => {
        const isToday = isSameDay(day, today);
        const busy = loads[i] > 0;
        return (
          <button
            key={day.toISOString()}
            type="button"
            data-no-swipe
            onClick={() => onViewDay(day)}
            className="flex min-w-0 flex-1 flex-col items-center gap-px py-0.5 transition hover:bg-surface-overlay"
            aria-label={`${fmt(day, "EEEE d MMMM")}${busy ? `, ${loads[i]} wydarzeń` : ", wolny"}`}
          >
            <span className="text-[9px] font-medium uppercase tracking-wide text-ink-faint">
              {fmt(day, "EEE")}
            </span>
            <span
              className={`flex h-6 w-6 items-center justify-center text-[11px] font-semibold tabular-nums ${
                isToday
                  ? "rounded-full bg-accent text-white shadow-glow"
                  : "text-ink"
              }`}
            >
              {fmt(day, "d")}
            </span>
            <span
              className={`mt-px h-1 w-1 rounded-full ${busy ? "bg-accent" : "bg-transparent"}`}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

/** Agenda tygodnia — tylko dni z wydarzeniami godzinowymi. */
function WeekAgenda({
  weekDays,
  items,
  groups,
  tagsForItem,
  onOpen,
  onViewDay,
}: {
  weekDays: Date[];
  items: Item[];
  groups: Record<string, Group>;
  tagsForItem: (item: Item) => ReturnType<typeof resolveItemTags>;
  onOpen: (id: string) => void;
  onViewDay: (day: Date) => void;
}) {
  const sections = useMemo(
    () => weekTimedSections(weekDays, items),
    [weekDays, items],
  );

  if (sections.length === 0) return null;

  return (
    <div className="space-y-3 px-3 pb-4 pt-2">
      {sections.map(({ day, events }) => {
        const isToday = isSameDay(day, new Date());
        return (
          <section key={day.toISOString()}>
            <button
              type="button"
              data-no-swipe
              onClick={() => onViewDay(day)}
              className={`mb-1 flex w-full items-baseline gap-2 text-left ${
                isToday ? "text-accent" : "text-ink-faint"
              }`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide">
                {fmt(day, "EEEE")}
              </span>
              <span className="text-[11px] font-medium tabular-nums">
                {fmt(day, "d MMM")}
              </span>
            </button>
            <div className="space-y-1">
              {events.map((item) => (
                <DashboardEventRow
                  key={item.id}
                  item={item}
                  group={item.groupId ? groups[item.groupId] : undefined}
                  itemTags={tagsForItem(item)}
                  onOpen={() => onOpen(item.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Widok tygodnia — gęstość treści: pasek 7 dni, wielodniowe, agenda (bez pustej siatki).
 */
export function MobileWeekOverview({
  weekDays,
  items,
  groups,
  onViewDay,
}: MobileWeekOverviewProps) {
  const setEditing = useStore((s) => s.setEditing);
  const itemsMap = useStore((s) => s.items);
  const tagsMap = useStore((s) => s.tags);
  const myTagIdsByItem = useStore((s) => s.myTagIdsByItem);

  const tagsForItem = useCallback(
    (item: Item) => {
      const baseId = baseItemId(item.id);
      const source = itemsMap[baseId] ?? item;
      return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
    },
    [itemsMap, tagsMap, myTagIdsByItem],
  );

  const hasEvents = weekHasCalendarEvents(weekDays, items);
  const hasTimed = weekTimedSections(weekDays, items).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="sticky top-0 z-10 shrink-0 border-b border-line bg-surface">
        <WeekOverviewStrip weekDays={weekDays} items={items} onViewDay={onViewDay} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        <MobileWeekBandPills
          weekDays={weekDays}
          items={items}
          groups={groups}
          onOpen={setEditing}
        />

        <WeekAgenda
          weekDays={weekDays}
          items={items}
          groups={groups}
          tagsForItem={tagsForItem}
          onOpen={setEditing}
          onViewDay={onViewDay}
        />

        {!hasEvents && (
          <p className="px-4 py-8 text-center text-sm text-ink-faint">
            Spokojny tydzień — brak wydarzeń.
          </p>
        )}
        {hasEvents && !hasTimed && (
          <p className="px-4 pb-6 pt-2 text-center text-xs text-ink-faint">
            Brak innych wydarzeń godzinowych w tym tygodniu.
          </p>
        )}
      </div>
    </div>
  );
}
