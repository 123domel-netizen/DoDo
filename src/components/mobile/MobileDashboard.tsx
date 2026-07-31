import {
  CalendarClock,
  ListChecks,
  Plus,
} from "lucide-react";
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
import { useTodayDashboardData } from "@/hooks/useTodayDashboardData";
import { ScheduleDashboardWorksSection } from "@/components/dashboard/ScheduleDashboardWorkRow";
import {
  DashboardEventRow,
  DashboardTodoRow,
} from "@/components/dashboard/TodayDashboardPanel";

export function MobileDashboard() {
  const {
    groups,
    itemsMap,
    tagsMap,
    myTagIdsByItem,
    todayEvents,
    upcomingEvents,
    tasks,
  } = useTodayDashboardData();
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const patchItem = useStore((s) => s.patchItem);
  const startDraft = useStore((s) => s.startDraft);

  const hasTodaySection = todayEvents.length > 0;
  const hasUpcomingSection = upcomingEvents.length > 0;

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

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        <ScheduleDashboardWorksSection />

        <section className="border-b border-line p-3">
          <div
            className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
              hasTodaySection || hasUpcomingSection ? "mb-1.5" : "mb-1"
            }`}
          >
            <CalendarClock size={14} className="shrink-0" />
            <span className="shrink-0">Wydarzenia nadchodzące</span>
            {!hasTodaySection && !hasUpcomingSection ? (
              <span className="min-w-0 flex-1 truncate text-xs font-normal normal-case text-ink-faint">
                Brak wydarzeń
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <button
              type="button"
              onClick={addEvent}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-grad px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white shadow-glow transition hover:brightness-110"
            >
              <Plus size={12} strokeWidth={2.5} />
              Dodaj wydarzenie
            </button>
          </div>
          {hasTodaySection ? (
            <>
              <div className="mb-0.5 text-[10px] font-medium text-ink-faint">
                Dzisiaj
              </div>
              <div className="space-y-0.5">
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
            </>
          ) : null}
          {hasUpcomingSection ? (
            <>
              <div
                className={`mb-0.5 text-[10px] font-medium text-ink-faint ${
                  hasTodaySection ? "mt-2" : ""
                }`}
              >
                Później
              </div>
              <div className="space-y-0.5">
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
            </>
          ) : null}
        </section>

        <section className="p-3 pb-4">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <ListChecks size={14} />
            <span className="min-w-0 flex-1">Zadania</span>
            <button
              type="button"
              onClick={addTask}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-grad px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white shadow-glow transition hover:brightness-110"
            >
              <Plus size={12} strokeWidth={2.5} />
              Dodaj zadanie
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-ink-faint">Brak zadań</p>
          ) : (
            <div className="space-y-px">
              {tasks.map((it) => (
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
  );
}
