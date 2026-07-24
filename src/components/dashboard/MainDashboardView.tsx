import { useMemo } from "react";
import { CalendarClock, ListChecks, Plus } from "lucide-react";
import { useStore } from "@/state/store";
import type { Item } from "@/types";
import { calendarBlockFromDeadline, defaultTaskDueRange, itemDurationMinutes } from "@/lib/factory";
import { groupIdForNewItem } from "@/lib/groups";
import { fmt } from "@/lib/format";
import { baseItemId } from "@/lib/itemId";
import { itemSupportsTodoDone } from "@/lib/items";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { useTodayDashboardData } from "@/hooks/useTodayDashboardData";
import {
  DashboardEventRow,
  DashboardTodoRow,
} from "@/components/dashboard/TodayDashboardPanel";

const MAIN_EVENTS_TARGET = 14;

/** Pełnoszerokościowy przegląd w miejscu kalendarza (desktop). */
export function MainDashboardView() {
  const { groups, itemsMap, tagsMap, myTagIdsByItem, todayEvents, upcomingEvents, tasks } =
    useTodayDashboardData({ eventsTarget: MAIN_EVENTS_TARGET });
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const patchItem = useStore((s) => s.patchItem);
  const startDraft = useStore((s) => s.startDraft);

  const tagsForItem = (item: Item) => {
    const baseId = baseItemId(item.id);
    const source = itemsMap[baseId] ?? item;
    return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
  };

  const shownInEvents = useMemo(() => {
    const ids = new Set<string>();
    for (const it of todayEvents) ids.add(baseItemId(it.id));
    for (const it of upcomingEvents) ids.add(baseItemId(it.id));
    return ids;
  }, [todayEvents, upcomingEvents]);

  const tasksOnly = useMemo(
    () => tasks.filter((it) => !shownInEvents.has(baseItemId(it.id))),
    [tasks, shownInEvents],
  );

  const todayLabel = fmt(new Date(), "EEEE, d MMMM yyyy");

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

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
              Przegląd
            </h1>
            <p className="mt-0.5 text-sm capitalize text-ink-faint">{todayLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addEvent}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink transition hover:border-line-strong"
            >
              <Plus size={15} />
              Wydarzenie
            </button>
            <button
              type="button"
              onClick={addTask}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110"
            >
              <Plus size={15} />
              Zadanie
            </button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
          <section className="rounded-2xl border border-line bg-surface-raised/40 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <CalendarClock size={15} className="shrink-0" />
              Wydarzenia
            </div>

            {todayEvents.length === 0 && upcomingEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                <p className="text-sm text-ink-faint">Brak nadchodzących wydarzeń</p>
                <button
                  type="button"
                  onClick={addEvent}
                  className="mt-3 text-sm font-medium text-accent transition hover:brightness-110"
                >
                  Dodaj pierwsze
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    Dzisiaj
                    {todayEvents.length > 0 && (
                      <span className="ml-1.5 font-normal opacity-70">{todayEvents.length}</span>
                    )}
                  </div>
                  {todayEvents.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-ink-faint">Nic na dziś w kalendarzu</p>
                  ) : (
                    <div className="space-y-1.5">
                      {todayEvents.map((it) => (
                        <DashboardEventRow
                          key={it.id}
                          item={it}
                          group={it.groupId ? groups[it.groupId] : undefined}
                          itemTags={tagsForItem(it)}
                          onOpen={() => setEditing(it.id)}
                          onToggle={
                            itemSupportsTodoDone(it)
                              ? () => toggleTaskDone(baseItemId(it.id))
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>

                {upcomingEvents.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Nadchodzące
                      <span className="ml-1.5 font-normal opacity-70">{upcomingEvents.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {upcomingEvents.map((it) => (
                        <DashboardEventRow
                          key={it.id}
                          item={it}
                          group={it.groupId ? groups[it.groupId] : undefined}
                          itemTags={tagsForItem(it)}
                          showEventDate
                          onOpen={() => setEditing(it.id)}
                          onToggle={
                            itemSupportsTodoDone(it)
                              ? () => toggleTaskDone(baseItemId(it.id))
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface-raised/40 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <ListChecks size={15} className="shrink-0" />
                Zadania
                {tasksOnly.length > 0 && (
                  <span className="font-normal normal-case opacity-70">{tasksOnly.length}</span>
                )}
              </div>
            </div>

            {tasksOnly.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                <p className="text-sm text-ink-faint">Brak otwartych zadań</p>
                <button
                  type="button"
                  onClick={addTask}
                  className="mt-3 text-sm font-medium text-accent transition hover:brightness-110"
                >
                  Dodaj zadanie
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {tasksOnly.map((it) => (
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
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
