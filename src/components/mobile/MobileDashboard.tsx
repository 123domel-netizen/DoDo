import { useMemo, type ReactNode } from "react";
import { addDays, addMonths, isPast, isToday, startOfDay } from "date-fns";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CheckSquare,
  ListChecks,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { Item, UserTag } from "@/types";
import { itemMatchesGroupFilter } from "@/lib/groups";
import { withNormalizedAllDay, itemCoversCalendarDay } from "@/lib/allDay";
import { expandItemsForRange } from "@/lib/recurrence";
import { calendarBlockFromDeadline, defaultTaskDueRange, itemDurationMinutes } from "@/lib/factory";
import { fmt, tint } from "@/lib/format";
import { isSharedItem, SHARE_CALENDAR_COLOR } from "@/lib/share";
import { effectiveReminders } from "@/lib/reminders";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { baseItemId } from "@/lib/itemId";
import { deadlineIconDimmed } from "@/lib/deadlines";

/** Łączna liczba wydarzeń w sekcjach „dzisiaj” + „nadchodzące”. */
const EVENTS_DISPLAY_TARGET = 5;

function sortEventsByStart(a: Item, b: Item): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}

/** Wspólna szerokość lewej kolumny — godziny wydarzenia / checkbox zadania. */
const DASHBOARD_LEFT_COL = "flex w-12 shrink-0 justify-center";

export function MobileDashboard() {
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const tagsMap = useStore((s) => s.tags);
  const myTagIdsByItem = useStore((s) => s.myTagIdsByItem);
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

  const calendarBase = useMemo(
    () =>
      Object.values(itemsMap)
        .filter(
          (it) =>
            itemMatchesGroupFilter(it, activeGroupFilter, "calendar") &&
            it.hasDueDate &&
            it.showInCalendar &&
            (it.type !== "task" || !it.done),
        )
        .map(withNormalizedAllDay),
    [itemsMap, activeGroupFilter],
  );

  const todayEvents = useMemo(
    () =>
      expandItemsForRange(calendarBase, today, todayEnd)
        .filter((it) => itemCoversCalendarDay(it, today))
        .sort(sortEventsByStart),
    [calendarBase, today, todayEnd],
  );

  const upcomingEvents = useMemo(() => {
    if (todayEvents.length >= EVENTS_DISPLAY_TARGET) return [];
    const need = EVENTS_DISPLAY_TARGET - todayEvents.length;
    const tomorrow = addDays(today, 1);
    const horizon = addMonths(today, 6);
    const todayIds = new Set(todayEvents.map((e) => e.id));
    return expandItemsForRange(calendarBase, tomorrow, horizon)
      .filter((it) => !todayIds.has(it.id) && !itemCoversCalendarDay(it, today))
      .filter((it) => new Date(it.end).getTime() > todayEnd.getTime())
      .sort(sortEventsByStart)
      .slice(0, need);
  }, [calendarBase, today, todayEnd, todayEvents]);

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

  const tagsForItem = (item: Item) =>
    resolveItemTags(effectiveTagIds(item, myTagIdsByItem), tagsMap);

  return (
    <div className="flex h-full flex-col overflow-y-auto thin-scrollbar bg-surface">
      <section className="border-b border-line p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <CalendarClock size={14} />
          Wydarzenia dzisiaj
        </div>
        {todayEvents.length === 0 ? (
          <p className="px-1 py-1.5 text-sm text-ink-faint">Brak wydarzeń na dziś</p>
        ) : (
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
        {upcomingEvents.length > 0 && (
          <>
            <div
              className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
                todayEvents.length === 0 ? "mt-2" : "mt-4"
              }`}
            >
              Nadchodzące
            </div>
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
          </>
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
  );
}

function DashboardMetaRow({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-faint">
      {visible}
    </div>
  );
}

function DashboardMetaDeadline({ item }: { item: Item }) {
  if (!item.deadlineAt) return null;
  const dim = deadlineIconDimmed(item);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 ${dim ? "opacity-50" : ""}`}
    >
      <AlarmClock size={11} className="shrink-0 text-red-500" aria-hidden />
      <span>{fmt(new Date(item.deadlineAt), "EEE d MMM, HH:mm")}</span>
    </span>
  );
}

function DashboardMetaReminders({ item }: { item: Item }) {
  const count = effectiveReminders(item).length;
  if (!count) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Bell size={11} className="shrink-0" aria-hidden />
      {count}
    </span>
  );
}

function DashboardMetaChecklist({ item }: { item: Item }) {
  if (!item.checklist.length) return null;
  const done = item.checklist.filter((c) => c.done).length;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <CheckSquare size={11} className="shrink-0" aria-hidden />
      {done}/{item.checklist.length}
    </span>
  );
}

function DashboardMetaGroup({
  shared,
  group,
  color,
}: {
  shared: boolean;
  group?: { name: string; color: string };
  color: string;
}) {
  if (shared) {
    return <span className="shrink-0 text-ink-faint">SHARE</span>;
  }
  if (!group) return null;
  return (
    <span className="inline-flex min-w-0 max-w-[9rem] items-center gap-1">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{group.name}</span>
    </span>
  );
}

function DashboardMetaTags({ tags }: { tags: UserTag[] }) {
  if (!tags.length) return null;
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-block max-w-[5.5rem] shrink-0 truncate text-[10px] font-medium"
          style={{ color: tag.color }}
        >
          #{tag.name}
        </span>
      ))}
    </>
  );
}

function DashboardMetaEventDate({ item }: { item: Item }) {
  return <span className="shrink-0">{fmt(item.start, "EEE d MMM")}</span>;
}

function DashboardEventRow({
  item,
  group,
  itemTags,
  showEventDate,
  onOpen,
}: {
  item: Item;
  group?: { name: string; color: string };
  itemTags: UserTag[];
  showEventDate?: boolean;
  onOpen: () => void;
}) {
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#5E7FA8");
  const reminderCount = effectiveReminders(item).length;
  const hasChecklist = item.checklist.length > 0;
  const showMeta =
    showEventDate ||
    Boolean(item.deadlineAt) ||
    shared ||
    Boolean(group) ||
    reminderCount > 0 ||
    hasChecklist ||
    itemTags.length > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full min-w-0 gap-2 rounded-lg border border-line/60 bg-surface-raised/40 px-2 py-2 text-left transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className={`${DASHBOARD_LEFT_COL} flex-col items-center pt-0.5 text-[11px] font-medium tabular-nums text-ink-light`}>
        {showEventDate && (
          <div className="mb-0.5 text-center text-[10px] leading-tight text-ink-faint">
            {fmt(item.start, "EEE d MMM")}
          </div>
        )}
        {item.allDay ? (
          <span className="text-[10px] leading-tight text-ink-faint">Cały dzień</span>
        ) : (
          <>
            <div>{fmt(item.start, "HH:mm")}</div>
            <div className="text-ink-faint">{fmt(item.end, "HH:mm")}</div>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="text-sm font-medium text-ink">
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        {showMeta && (
          <DashboardMetaRow>
            {showEventDate && <DashboardMetaEventDate item={item} />}
            <DashboardMetaDeadline item={item} />
            <DashboardMetaGroup shared={shared} group={group} color={color} />
            <DashboardMetaReminders item={item} />
            <DashboardMetaChecklist item={item} />
            <DashboardMetaTags tags={itemTags} />
          </DashboardMetaRow>
        )}
      </div>
    </button>
  );
}

function DashboardTodoRow({
  item,
  group,
  itemTags,
  onToggle,
  onOpen,
  onConvert,
}: {
  item: Item;
  group?: { name: string; color: string };
  itemTags: UserTag[];
  onToggle: () => void;
  onOpen: () => void;
  onConvert: () => void;
}) {
  const due = new Date(item.end);
  const overdue = item.hasDueDate && !item.done && isPast(due) && !isToday(due);
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#9b9a97");

  return (
    <div
      className={`group flex min-w-0 gap-2 rounded-lg border border-transparent px-2 py-1.5 transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${item.done ? "#3a3a42" : color}` }}
    >
      <div className={`${DASHBOARD_LEFT_COL} items-center pt-0.5`}>
        <input
          type="checkbox"
          checked={item.done}
          onChange={onToggle}
          disabled={shared}
          className={`h-4 w-4 accent-accent ${shared ? "cursor-not-allowed opacity-50" : ""}`}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={`cursor-pointer text-sm font-medium ${item.done ? "text-ink-faint line-through" : "text-ink"}`}
          onClick={onOpen}
        >
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        <DashboardMetaRow>
          {item.hasDueDate ? (
            <span className={`shrink-0 ${overdue ? "font-medium text-red-400" : ""}`}>
              {item.allDay ? fmt(due, "EEE d MMM") : fmt(due, "EEE d MMM, HH:mm")}
            </span>
          ) : (
            <span className="shrink-0">Bez terminu</span>
          )}
          <DashboardMetaDeadline item={item} />
          <DashboardMetaGroup shared={shared} group={group} color={color} />
          <DashboardMetaReminders item={item} />
          <DashboardMetaChecklist item={item} />
          <DashboardMetaTags tags={itemTags} />
        </DashboardMetaRow>
      </div>
      {!item.showInCalendar && (
        <button
          onClick={onConvert}
          title="Zmień na wydarzenie (pokaż w kalendarzu)"
          className="shrink-0 self-start rounded-md px-1.5 py-0.5 text-[11px] text-ink-light opacity-0 transition hover:text-ink group-hover:opacity-100"
          style={{ background: tint(color, 0.12) }}
        >
          → kalendarz
        </button>
      )}
    </div>
  );
}
