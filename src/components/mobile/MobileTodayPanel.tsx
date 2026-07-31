import { useMemo } from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useStore } from "@/state/store";
import { findArchiveGroup, itemMatchesGroupFilter } from "@/lib/groups";
import { withNormalizedAllDay, itemCoversCalendarDay } from "@/lib/allDay";
import { expandItemsForRange } from "@/lib/recurrence";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { baseItemId } from "@/lib/itemId";
import { itemSupportsTodoDone } from "@/lib/items";
import type { Item } from "@/types";
import { DashboardEventRow } from "@/components/dashboard/TodayDashboardPanel";

function sortEventsByStart(a: Item, b: Item): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}

/** Widok „Lista” w mobilnym Kalendarzu: dziś (godzina) + nadchodzące (dzień + godzina). */
export function MobileTodayPanel() {
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const tagsMap = useStore((s) => s.tags);
  const myTagIdsByItem = useStore((s) => s.myTagIdsByItem);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const setEditing = useStore((s) => s.setEditing);

  const groups = useMemo(() => {
    const m: Record<string, { name: string; color: string }> = {};
    for (const g of groupsArr) m[g.id] = g;
    return m;
  }, [groupsArr]);

  const inArchiveView =
    activeGroupFilter != null &&
    activeGroupFilter === (findArchiveGroup(groupsArr)?.id ?? null);

  const today = startOfDay(new Date());
  const todayEnd = addDays(today, 1);

  const calendarBase = useMemo(
    () =>
      Object.values(itemsMap)
        .filter(
          (it) =>
            itemMatchesGroupFilter(it, activeGroupFilter, "dashboard") &&
            it.hasDueDate &&
            it.showInCalendar &&
            (inArchiveView || !(itemSupportsTodoDone(it) && it.done)),
        )
        .map(withNormalizedAllDay),
    [itemsMap, activeGroupFilter, inArchiveView],
  );

  const todayEvents = useMemo(
    () =>
      expandItemsForRange(calendarBase, today, todayEnd)
        .filter((it) => itemCoversCalendarDay(it, today))
        .sort(sortEventsByStart),
    [calendarBase, today, todayEnd],
  );

  const upcomingEvents = useMemo(() => {
    const tomorrow = addDays(today, 1);
    const horizon = addMonths(today, 12);
    const todayIds = new Set(todayEvents.map((e) => e.id));
    return expandItemsForRange(calendarBase, tomorrow, horizon)
      .filter((it) => !todayIds.has(it.id) && !itemCoversCalendarDay(it, today))
      .filter((it) => new Date(it.end).getTime() > todayEnd.getTime())
      .sort(sortEventsByStart);
  }, [calendarBase, today, todayEnd, todayEvents]);

  const tagsForItem = (item: Item) => {
    const baseId = baseItemId(item.id);
    const source = itemsMap[baseId] ?? item;
    return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto thin-scrollbar bg-surface">
      <section className="border-b border-line p-3">
        <div
          className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
            todayEvents.length === 0 ? "mb-1" : "mb-2"
          }`}
        >
          <CalendarClock size={14} className="shrink-0" />
          <span className="shrink-0">Wydarzenia dzisiaj</span>
          {todayEvents.length === 0 && (
            <span className="min-w-0 flex-1 truncate text-xs font-normal normal-case text-ink-faint">
              Brak wydarzeń na dziś
            </span>
          )}
        </div>
        {todayEvents.length > 0 && (
          <div className="space-y-1">
            {todayEvents.map((it) => (
              <DashboardEventRow
                key={it.id}
                item={it}
                group={it.groupId ? groups[it.groupId] : undefined}
                itemTags={tagsForItem(it)}
                onOpen={() => setEditing(it.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="p-3 pb-6">
        <div
          className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
            upcomingEvents.length === 0 ? "mb-1" : "mb-2"
          }`}
        >
          <span className="shrink-0">Wydarzenia nadchodzące</span>
          {upcomingEvents.length === 0 && (
            <span className="min-w-0 flex-1 truncate text-xs font-normal normal-case text-ink-faint">
              Brak nadchodzących
            </span>
          )}
        </div>
        {upcomingEvents.length > 0 && (
          <div className="space-y-1">
            {upcomingEvents.map((it) => (
              <DashboardEventRow
                key={it.id}
                item={it}
                group={it.groupId ? groups[it.groupId] : undefined}
                itemTags={tagsForItem(it)}
                showEventDate
                onOpen={() => setEditing(it.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
