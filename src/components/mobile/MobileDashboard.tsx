import { useMemo } from "react";
import { addDays, startOfDay } from "date-fns";
import { CalendarClock, ListChecks } from "lucide-react";
import { useStore } from "@/state/store";
import type { Item } from "@/types";
import { itemMatchesGroupFilter } from "@/lib/groups";
import { withNormalizedAllDay } from "@/lib/allDay";
import { expandItemsForRange } from "@/lib/recurrence";
import { calendarBlockFromDeadline, defaultTaskDueRange, itemDurationMinutes } from "@/lib/factory";
import { fmt, fmtRange } from "@/lib/format";
import { isSharedItem, SHARE_CALENDAR_COLOR } from "@/lib/share";
import { TodoRow } from "@/components/todo/TodoPanel";

export function MobileDashboard() {
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const patchItem = useStore((s) => s.patchItem);

  const groups = useMemo(() => {
    const m: Record<string, { name: string; color: string }> = {};
    for (const g of groupsArr) m[g.id] = g;
    return m;
  }, [groupsArr]);

  const today = startOfDay(new Date());
  const todayEnd = addDays(today, 1);

  const todayEvents = useMemo(() => {
    const base = Object.values(itemsMap)
      .filter(
        (it) =>
          itemMatchesGroupFilter(it, activeGroupFilter, "calendar") &&
          it.hasDueDate &&
          it.showInCalendar &&
          (it.type !== "task" || !it.done),
      )
      .map(withNormalizedAllDay);
    return expandItemsForRange(base, today, todayEnd).sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
  }, [itemsMap, activeGroupFilter, today, todayEnd]);

  const tasks = useMemo(
    () =>
      Object.values(itemsMap)
        .filter((it) => it.showInTodo && itemMatchesGroupFilter(it, activeGroupFilter, "todo"))
        .filter((it) => !it.done)
        .sort((a, b) => {
          if (!a.hasDueDate && !b.hasDueDate) return 0;
          if (!a.hasDueDate) return 1;
          if (!b.hasDueDate) return -1;
          return new Date(a.end).getTime() - new Date(b.end).getTime();
        }),
    [itemsMap, activeGroupFilter],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto thin-scrollbar bg-surface">
      <section className="border-b border-line p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <CalendarClock size={14} />
          Wydarzenia dzisiaj
        </div>
        {todayEvents.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-faint">Brak wydarzeń na dziś</p>
        ) : (
          <div className="space-y-1">
            {todayEvents.map((it) => (
              <DashboardEventRow
                key={it.id}
                item={it}
                group={it.groupId ? groups[it.groupId] : undefined}
                onOpen={() => setEditing(it.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex-1 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <ListChecks size={14} />
          Zadania
        </div>
        {tasks.length === 0 ? (
          <p className="px-1 py-4 text-center text-sm text-ink-faint">Brak zadań</p>
        ) : (
          <div className="space-y-1">
            {tasks.map((it) => (
              <TodoRow
                key={it.id}
                item={it}
                group={it.groupId ? groups[it.groupId] : undefined}
                onToggle={() => toggleTaskDone(it.id)}
                onOpen={() => setEditing(it.id)}
                onConvert={() => {
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
                  patchItem(it.id, patch);
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DashboardEventRow({
  item,
  group,
  onOpen,
}: {
  item: Item;
  group?: { name: string; color: string };
  onOpen: () => void;
}) {
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#5E7FA8");
  const timeLabel = item.allDay
    ? "Cały dzień"
    : fmtRange(item.start, item.end);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full gap-2 rounded-lg border border-line/60 bg-surface-raised/40 px-2 py-2 text-left transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="w-14 shrink-0 pt-0.5 text-right text-[11px] font-medium tabular-nums text-ink-light">
        {item.allDay ? (
          <span className="text-[10px] leading-tight text-ink-faint">Cały dzień</span>
        ) : (
          <>
            <div>{fmt(item.start, "HH:mm")}</div>
            <div className="text-ink-faint">{fmt(item.end, "HH:mm")}</div>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        {(!item.allDay || shared || group) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-ink-faint">
            {!item.allDay && <span className="shrink-0">{timeLabel}</span>}
            {shared ? (
              <span className="shrink-0">SHARE</span>
            ) : group ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate">{group.name}</span>
              </span>
            ) : null}
          </div>
        )}
      </div>
    </button>
  );
}
