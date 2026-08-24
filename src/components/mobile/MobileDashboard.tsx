import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ListChecks, Plus } from "lucide-react";
import { useStore } from "@/state/store";
import type { Item } from "@/types";
import { groupIdForNewItem } from "@/lib/groups";
import {
  calendarBlockFromDeadline,
  defaultTaskDueRange,
  itemDurationMinutes,
} from "@/lib/factory";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { baseItemId } from "@/lib/itemId";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { startOfDay } from "date-fns";
import {
  EVENTS_DISPLAY_EXPANDED,
  useTodayDashboardData,
} from "@/hooks/useTodayDashboardData";
import { ScheduleDashboardWorksSection } from "@/components/dashboard/ScheduleDashboardWorkRow";
import { NotebookDashboardSection } from "@/components/dashboard/NotebookDashboardSection";
import {
  DashboardEventRow,
  DashboardTodoRow,
} from "@/components/dashboard/TodayDashboardPanel";
import { MobileSectionToggle } from "@/components/mobile/dashboard/MobileSectionToggle";
import { useMobileSectionExpanded } from "@/components/mobile/dashboard/sectionCollapse";

const EVENTS_COLLAPSED = 3;
/** Szacunek wysokości wiersza zadania (tytuł + meta). */
const TASK_ROW_EST_PX = 44;

function sortEventsByStart(a: Item, b: Item): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}

export function MobileDashboard({
  onOpenCalendar,
  onOpenTasks,
  onOpenSchedules,
}: {
  onOpenCalendar?: () => void;
  onOpenTasks?: () => void;
  onOpenSchedules?: () => void;
}) {
  const {
    groups,
    itemsMap,
    tagsMap,
    myTagIdsByItem,
    todayEvents,
    upcomingEvents,
    pinnedEvents,
    tasks,
  } = useTodayDashboardData({ eventsTarget: EVENTS_DISPLAY_EXPANDED });
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const patchItem = useStore((s) => s.patchItem);
  const startDraft = useStore((s) => s.startDraft);

  const [eventsExpanded, toggleEvents] = useMobileSectionExpanded(
    "events",
    false,
  );
  const [tasksExpanded, toggleTasks] = useMobileSectionExpanded(
    "tasks",
    false,
  );

  const fitBoxRef = useRef<HTMLDivElement>(null);
  const pinnedBoxRef = useRef<HTMLDivElement>(null);
  const [unpinnedFit, setUnpinnedFit] = useState(0);

  const today = startOfDay(new Date());

  const allUpcomingChrono = useMemo(() => {
    const merged = [...todayEvents, ...upcomingEvents];
    const byId = new Map(merged.map((it) => [baseItemId(it.id), it]));
    for (const p of pinnedEvents) {
      const id = baseItemId(p.id);
      if (!byId.has(id)) byId.set(id, p);
    }
    return [...byId.values()].sort(sortEventsByStart);
  }, [todayEvents, upcomingEvents, pinnedEvents]);

  const visibleEvents = useMemo(() => {
    if (eventsExpanded) return allUpcomingChrono;
    const nearest = allUpcomingChrono.slice(0, EVENTS_COLLAPSED);
    const seen = new Set(nearest.map((it) => baseItemId(it.id)));
    const extraPinned = pinnedEvents.filter(
      (it) => !seen.has(baseItemId(it.id)),
    );
    return [...nearest, ...extraPinned].sort(sortEventsByStart);
  }, [eventsExpanded, allUpcomingChrono, pinnedEvents]);

  const eventsToday = useMemo(
    () => visibleEvents.filter((it) => itemCoversCalendarDay(it, today)),
    [visibleEvents, today],
  );
  const eventsLater = useMemo(
    () => visibleEvents.filter((it) => !itemCoversCalendarDay(it, today)),
    [visibleEvents, today],
  );

  const pinnedTasks = useMemo(
    () => tasks.filter((it) => Boolean(it.pinnedAt)),
    [tasks],
  );
  const unpinnedTasks = useMemo(
    () => tasks.filter((it) => !it.pinnedAt),
    [tasks],
  );

  useLayoutEffect(() => {
    if (tasksExpanded) return;
    const box = fitBoxRef.current;
    if (!box) return;

    const measure = () => {
      const avail = box.clientHeight;
      const pinnedH = pinnedBoxRef.current?.offsetHeight ?? 0;
      const free = Math.max(0, avail - pinnedH);
      const n = Math.floor(free / TASK_ROW_EST_PX);
      setUnpinnedFit(Math.max(0, Math.min(n, unpinnedTasks.length)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [
    tasksExpanded,
    pinnedTasks.length,
    unpinnedTasks.length,
    eventsExpanded,
    visibleEvents.length,
  ]);

  // Jeśli wiersze są wyższe niż szacunek — zmniejsz liczbę aż zmieści się nad belką czatu.
  useLayoutEffect(() => {
    if (tasksExpanded) return;
    const box = fitBoxRef.current;
    if (!box || unpinnedFit <= 0) return;
    if (box.scrollHeight > box.clientHeight + 2) {
      setUnpinnedFit((n) => Math.max(0, n - 1));
    }
  }, [tasksExpanded, unpinnedFit, pinnedTasks.length]);

  const visibleUnpinned = tasksExpanded
    ? unpinnedTasks
    : unpinnedTasks.slice(0, unpinnedFit);

  const visibleTasks = tasksExpanded
    ? tasks
    : [...pinnedTasks, ...visibleUnpinned];

  const hiddenEventsCount = Math.max(
    0,
    allUpcomingChrono.length - visibleEvents.length,
  );
  const hiddenTasksCount = Math.max(0, tasks.length - visibleTasks.length);

  const addTask = () => {
    startDraft({
      type: "task",
      hasDueDate: false,
      showInTodo: true,
      showInCalendar: false,
      groupId: groupIdForNewItem(),
    });
  };

  const addEvent = () => {
    const start = new Date();
    start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
    startDraft({
      type: "event",
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
      groupId: groupIdForNewItem(),
    });
  };

  const tagsForItem = (item: Item) => {
    const baseId = baseItemId(item.id);
    const source = itemsMap[baseId] ?? item;
    return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
  };

  const renderTodo = (it: Item) => (
    <DashboardTodoRow
      key={it.id}
      item={it}
      group={it.groupId ? groups[it.groupId] : undefined}
      itemTags={tagsForItem(it)}
      onToggle={() => toggleTaskDone(baseItemId(it.id))}
      onOpen={() => setEditing(it.id)}
      onConvert={() => {
        const id = baseItemId(it.id);
        const patch: Partial<Item> = {
          type: "event",
          showInCalendar: true,
          hasDueDate: true,
        };
        if (!it.hasDueDate) {
          const { end } = defaultTaskDueRange();
          Object.assign(patch, calendarBlockFromDeadline(end, 60));
        } else if (itemDurationMinutes(it.start, it.end) < 60) {
          Object.assign(patch, calendarBlockFromDeadline(it.end, 60));
        }
        patchItem(id, patch);
      }}
    />
  );

  const hasEvents = eventsToday.length > 0 || eventsLater.length > 0;

  const sectionTitleBtn =
    "inline-flex min-w-0 max-w-full shrink items-center truncate rounded-md border border-line bg-surface-raised/60 px-2 py-1 text-left text-sm font-medium uppercase tracking-wide text-ink-light transition hover:border-line-strong hover:bg-surface-overlay hover:text-ink active:bg-surface-overlay";

  const tasksHeader = (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
      <ListChecks size={14} className="shrink-0" />
      <button
        type="button"
        onClick={onOpenTasks}
        className={sectionTitleBtn}
        title="Otwórz zadania"
      >
        Zadania
      </button>
      <span className="min-w-0 flex-1" aria-hidden />
      {!tasksExpanded && hiddenTasksCount > 0 ? (
        <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
          +{hiddenTasksCount}
        </span>
      ) : null}
      <button
        type="button"
        onClick={addTask}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-grad px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white shadow-glow transition hover:brightness-110"
      >
        <Plus size={12} strokeWidth={2.5} />
        Dodaj
      </button>
      <MobileSectionToggle expanded={tasksExpanded} onToggle={toggleTasks} />
    </div>
  );

  const eventsSection = (
    <section className="border-b border-line p-3">
      <div
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
          hasEvents ? "mb-1.5" : "mb-0"
        }`}
      >
        <CalendarClock size={14} className="shrink-0" />
        <button
          type="button"
          onClick={onOpenCalendar}
          className={sectionTitleBtn}
          title="Otwórz kalendarz"
        >
          Wydarzenia
        </button>
        <span className="min-w-0 flex-1" aria-hidden />
        {!hasEvents && !eventsExpanded ? (
          <span className="text-[10px] font-normal normal-case tracking-normal text-ink-faint">
            Brak
          </span>
        ) : null}
        {!eventsExpanded && hiddenEventsCount > 0 ? (
          <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
            +{hiddenEventsCount}
          </span>
        ) : null}
        <button
          type="button"
          onClick={addEvent}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-grad px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white shadow-glow transition hover:brightness-110"
        >
          <Plus size={12} strokeWidth={2.5} />
          Dodaj
        </button>
        <MobileSectionToggle
          expanded={eventsExpanded}
          onToggle={toggleEvents}
        />
      </div>

      {eventsToday.length > 0 ? (
        <>
          <div className="mb-0.5 text-[10px] font-medium text-ink-faint">
            Dzisiaj
          </div>
          <div className="space-y-0.5">
            {eventsToday.map((it) => (
              <DashboardEventRow
                key={it.id}
                item={it}
                group={it.groupId ? groups[it.groupId] : undefined}
                itemTags={tagsForItem(it)}
                onOpen={() => setEditing(it.id)}
              />
            ))}
          </div>
        </>
      ) : null}
      {eventsLater.length > 0 ? (
        <>
          <div
            className={`mb-0.5 text-[10px] font-medium text-ink-faint ${
              eventsToday.length > 0 ? "mt-2" : ""
            }`}
          >
            Później
          </div>
          <div className="space-y-0.5">
            {eventsLater.map((it) => (
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
        </>
      ) : null}
      {!hasEvents && eventsExpanded ? (
        <p className="py-2 text-center text-[12px] text-ink-faint">
          Brak wydarzeń
        </p>
      ) : null}
    </section>
  );

  // Zwinięte zadania: wypełnij wolne miejsce nad belką awatarów (bez scrolla listy).
  if (!tasksExpanded) {
    return (
      <div className="flex h-full flex-col bg-surface">
        <div className="min-h-0 shrink overflow-y-auto thin-scrollbar">
          <ScheduleDashboardWorksSection onOpenSchedules={onOpenSchedules} />
          <div className="border-b border-line px-3 py-2">
            <NotebookDashboardSection dense />
          </div>
          {eventsSection}
        </div>
        <section className="flex min-h-0 flex-1 flex-col border-t border-line p-3 pt-2.5">
          {tasksHeader}
          <div ref={fitBoxRef} className="min-h-0 flex-1 overflow-hidden">
            {pinnedTasks.length === 0 && visibleUnpinned.length === 0 ? (
              <p className="px-1 py-4 text-center text-sm text-ink-faint">
                Brak zadań
              </p>
            ) : (
              <>
                <div ref={pinnedBoxRef} className="space-y-px">
                  {pinnedTasks.map(renderTodo)}
                </div>
                <div className="space-y-px">
                  {visibleUnpinned.map(renderTodo)}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        <ScheduleDashboardWorksSection onOpenSchedules={onOpenSchedules} />
        <div className="border-b border-line px-3 py-2">
          <NotebookDashboardSection dense />
        </div>
        {eventsSection}
        <section className="p-3 pb-4">
          {tasksHeader}
          {tasks.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-ink-faint">
              Brak zadań
            </p>
          ) : (
            <div className="space-y-px">{tasks.map(renderTodo)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
