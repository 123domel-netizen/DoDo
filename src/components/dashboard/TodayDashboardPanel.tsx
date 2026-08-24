import { type ReactNode } from "react";
import { isPast, isToday } from "date-fns";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CheckSquare,
  ListChecks,
  Plus,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { Item, UserTag } from "@/types";
import {
  calendarBlockFromDeadline,
  defaultTaskDueRange,
  itemDurationMinutes,
} from "@/lib/factory";
import { fmt, tint } from "@/lib/format";
import { groupIdForNewItem } from "@/lib/groups";
import { isSharedItem, SHARE_CALENDAR_COLOR } from "@/lib/share";
import { effectiveReminders } from "@/lib/reminders";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { baseItemId } from "@/lib/itemId";
import { deadlineIconDimmed } from "@/lib/deadlines";
import { itemSupportsTodoDone } from "@/lib/items";
import { useTodayDashboardData } from "@/hooks/useTodayDashboardData";
import { ScheduleDashboardWorksSection } from "@/components/dashboard/ScheduleDashboardWorkRow";
import { DASHBOARD_LEAD_COL } from "@/components/dashboard/dashboardRowLayout";
import { MobileSectionToggle } from "@/components/mobile/dashboard/MobileSectionToggle";
import { useMobileSectionExpanded } from "@/components/mobile/dashboard/sectionCollapse";

/** Desktop side-panel „Dziś” — ta sama logika co MobileDashboard. */
export function TodayDashboardPanel() {
  const { groups, itemsMap, tagsMap, myTagIdsByItem, todayEvents, upcomingEvents, tasks } =
    useTodayDashboardData();
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const patchItem = useStore((s) => s.patchItem);
  const startDraft = useStore((s) => s.startDraft);
  const setSettings = useStore((s) => s.setSettings);

  const [eventsExpanded, toggleEvents] = useMobileSectionExpanded(
    "sidebar-events",
    true,
  );
  const [tasksExpanded, toggleTasks] = useMobileSectionExpanded(
    "sidebar-tasks",
    true,
  );

  const hasTodaySection = todayEvents.length > 0;
  const hasUpcomingSection = upcomingEvents.length > 0;
  const eventsCount = todayEvents.length + upcomingEvents.length;
  const eventsEmpty = eventsCount === 0;
  const tasksEmpty = tasks.length === 0;

  const tagsForItem = (item: Item) => {
    const baseId = baseItemId(item.id);
    const source = itemsMap[baseId] ?? item;
    return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
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

  const addTask = () => {
    startDraft({
      type: "task",
      hasDueDate: false,
      showInTodo: true,
      showInCalendar: false,
      groupId: groupIdForNewItem(),
    });
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-y-auto overflow-x-hidden thin-scrollbar">
      <ScheduleDashboardWorksSection
        onOpenSchedules={() => setSettings({ mainAreaMode: "projects" })}
      />

      <section className="border-b border-line p-3 xl:px-3.5 xl:py-3.5 2xl:px-4">
        <div
          className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
            !eventsExpanded || eventsEmpty ? "mb-0" : "mb-1.5"
          }`}
        >
          <CalendarClock size={14} className="shrink-0" />
          <span className="min-w-0 shrink truncate text-sm font-medium uppercase tracking-wide text-ink-light">
            Wydarzenia nadchodzące
          </span>
          <span className="min-w-0 flex-1" aria-hidden />
          {!eventsExpanded && eventsCount > 0 ? (
            <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
              {eventsCount}
            </span>
          ) : null}
          {eventsExpanded && eventsEmpty ? (
            <span className="text-[10px] font-normal normal-case tracking-normal text-ink-faint">
              Brak
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
        {eventsExpanded && hasTodaySection ? (
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
                  onToggle={
                    itemSupportsTodoDone(it)
                      ? () => toggleTaskDone(baseItemId(it.id))
                      : undefined
                  }
                />
              ))}
            </div>
          </>
        ) : null}
        {eventsExpanded && hasUpcomingSection ? (
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
                  onToggle={
                    itemSupportsTodoDone(it)
                      ? () => toggleTaskDone(baseItemId(it.id))
                      : undefined
                  }
                />
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="flex-1 p-3 xl:px-3.5 xl:py-3.5 2xl:px-4">
        <div
          className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
            !tasksExpanded || tasksEmpty ? "mb-0" : "mb-1.5"
          }`}
        >
          <ListChecks size={14} className="shrink-0" />
          <span className="min-w-0 shrink truncate text-sm font-medium uppercase tracking-wide text-ink-light">
            Zadania
          </span>
          <span className="min-w-0 flex-1" aria-hidden />
          {!tasksExpanded && tasks.length > 0 ? (
            <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
              {tasks.length}
            </span>
          ) : null}
          {tasksExpanded && tasksEmpty ? (
            <span className="text-[10px] font-normal normal-case tracking-normal text-ink-faint">
              Brak
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
        {tasksExpanded && !tasksEmpty ? (
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
        ) : null}
      </section>
    </div>
  );
}

function DashboardMetaRow({ children }: { children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div className="mt-px flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] leading-tight text-ink-faint">
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
      <AlarmClock size={10} className="shrink-0 text-red-500" aria-hidden />
      <span>{fmt(new Date(item.deadlineAt), "EEE d MMM, HH:mm")}</span>
    </span>
  );
}

function DashboardMetaReminders({ item }: { item: Item }) {
  const count = effectiveReminders(item).length;
  if (!count) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Bell size={10} className="shrink-0" aria-hidden />
      {count}
    </span>
  );
}

function DashboardMetaChecklist({ item }: { item: Item }) {
  if (!item.checklist.length) return null;
  const done = item.checklist.filter((c) => c.done).length;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <CheckSquare size={10} className="shrink-0" aria-hidden />
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
    <span className="inline-flex min-w-0 max-w-[9rem] items-center gap-1 xl:max-w-[14rem] 2xl:max-w-[18rem]">
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
          className="inline-flex max-w-[5.5rem] shrink-0 items-center truncate rounded-full px-1.5 py-px text-[10px] font-medium xl:max-w-[9rem] 2xl:max-w-[11rem]"
          style={{
            color: tag.color,
            background: `${tag.color}22`,
            border: `1px solid ${tag.color}44`,
          }}
        >
          #{tag.name}
        </span>
      ))}
    </>
  );
}

export function DashboardEventRow({
  item,
  group,
  itemTags,
  showEventDate,
  onOpen,
  onToggle,
}: {
  item: Item;
  group?: { name: string; color: string };
  itemTags: UserTag[];
  showEventDate?: boolean;
  onOpen: () => void;
  /** Zadania / wydarzenia z „pokaż w todo” — checkbox odhaczania. */
  onToggle?: () => void;
}) {
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#4A8FC4");
  const reminderCount = effectiveReminders(item).length;
  const hasChecklist = item.checklist.length > 0;
  const showMeta =
    Boolean(item.deadlineAt) ||
    shared ||
    Boolean(group) ||
    reminderCount > 0 ||
    hasChecklist ||
    itemTags.length > 0;
  const canToggleDone = Boolean(onToggle) && itemSupportsTodoDone(item);

  const timeCol = (
    <div
      className={`${DASHBOARD_LEAD_COL} flex-col text-[10px] font-medium tabular-nums leading-tight text-ink-light`}
    >
      {showEventDate && (
        <div className="whitespace-nowrap text-center text-[9px] leading-tight text-ink-faint">
          {fmt(item.start, "d.MM")}
        </div>
      )}
      {item.allDay ? (
        <span className="text-[9px] leading-tight text-ink-faint">cały dzień</span>
      ) : (
        <>
          <div>{fmt(item.start, "HH:mm")}</div>
          <div className="text-ink-faint">{fmt(item.end, "HH:mm")}</div>
        </>
      )}
    </div>
  );

  const body = (
    <div className="min-w-0 flex-1 overflow-hidden">
      <div
        className={`truncate text-sm font-medium leading-snug ${item.done ? "text-ink-faint line-through" : "text-ink"} ${
          canToggleDone ? "cursor-pointer" : ""
        }`}
        onClick={canToggleDone ? onOpen : undefined}
      >
        {item.title || "(bez tytułu)"}
        {shared && (
          <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
            SHARE
          </span>
        )}
      </div>
      {showMeta && (
        <DashboardMetaRow>
          <DashboardMetaDeadline item={item} />
          <DashboardMetaGroup shared={shared} group={group} color={color} />
          <DashboardMetaReminders item={item} />
          <DashboardMetaChecklist item={item} />
          <DashboardMetaTags tags={itemTags} />
        </DashboardMetaRow>
      )}
    </div>
  );

  const toggleCol = canToggleDone ? (
    <input
      type="checkbox"
      checked={item.done}
      onChange={onToggle}
      disabled={shared}
      onClick={(e) => e.stopPropagation()}
      className={`h-3.5 w-3.5 shrink-0 self-center accent-accent ${shared ? "cursor-not-allowed opacity-50" : ""}`}
      title={item.done ? "Oznacz jako niewykonane" : "Oznacz jako wykonane"}
    />
  ) : null;

  if (canToggleDone) {
    return (
      <div
        className={`group flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line/50 bg-surface-raised/30 px-1.5 py-1 text-left transition hover:bg-surface-overlay ${
          shared ? "opacity-[0.72]" : ""
        }`}
        style={{ borderLeft: `3px solid ${item.done ? "var(--line-strong-hex)" : color}` }}
      >
        {timeCol}
        {body}
        {toggleCol}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line/50 bg-surface-raised/30 px-1.5 py-1 text-left transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {timeCol}
      {body}
    </button>
  );
}

export function DashboardTodoRow({
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
  const reminderCount = effectiveReminders(item).length;
  const hasChecklist = item.checklist.length > 0;
  const showMeta =
    item.hasDueDate ||
    Boolean(item.deadlineAt) ||
    shared ||
    Boolean(group) ||
    reminderCount > 0 ||
    hasChecklist ||
    itemTags.length > 0;

  return (
    <div
      className={`group relative flex min-w-0 items-start gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${item.done ? "var(--line-strong-hex)" : color}` }}
    >
      <div className={`${DASHBOARD_LEAD_COL} pt-0.5`}>
        <input
          type="checkbox"
          checked={item.done}
          onChange={onToggle}
          disabled={shared}
          className={`h-3.5 w-3.5 accent-accent ${shared ? "cursor-not-allowed opacity-50" : ""}`}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={`cursor-pointer truncate text-sm font-medium leading-snug ${item.done ? "text-ink-faint line-through" : "text-ink"}`}
          onClick={onOpen}
        >
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        {showMeta && (
          <DashboardMetaRow>
            {item.hasDueDate && (
              <span className={`shrink-0 ${overdue ? "font-medium text-red-400" : ""}`}>
                {item.allDay ? fmt(due, "EEE d MMM") : fmt(due, "EEE d MMM, HH:mm")}
              </span>
            )}
            <DashboardMetaDeadline item={item} />
            <DashboardMetaGroup shared={shared} group={group} color={color} />
            <DashboardMetaReminders item={item} />
            <DashboardMetaChecklist item={item} />
            <DashboardMetaTags tags={itemTags} />
          </DashboardMetaRow>
        )}
      </div>
      {!item.showInCalendar && (
        <button
          onClick={onConvert}
          title="Zmień na wydarzenie (pokaż w kalendarzu)"
          className="absolute right-1 top-0.5 shrink-0 rounded px-1 py-px text-[10px] text-ink-light opacity-0 transition hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
          style={{ background: tint(color, 0.12) }}
        >
          → kalendarz
        </button>
      )}
    </div>
  );
}
