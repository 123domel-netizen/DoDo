import { type ReactNode } from "react";
import { isPast, isToday } from "date-fns";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CheckSquare,
  ListChecks,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { Item, UserTag } from "@/types";
import { calendarBlockFromDeadline, defaultTaskDueRange, itemDurationMinutes } from "@/lib/factory";
import { fmt, tint } from "@/lib/format";
import { isSharedItem, SHARE_CALENDAR_COLOR } from "@/lib/share";
import { effectiveReminders } from "@/lib/reminders";
import { effectiveTagIds, resolveItemTags } from "@/lib/tags";
import { baseItemId } from "@/lib/itemId";
import { deadlineIconDimmed } from "@/lib/deadlines";
import { useTodayDashboardData } from "@/hooks/useTodayDashboardData";

const DASHBOARD_LEFT_COL = "flex w-14 shrink-0 justify-center";

/** Desktop side-panel „Dziś” — ta sama logika co MobileDashboard. */
export function TodayDashboardPanel() {
  const { groups, itemsMap, tagsMap, myTagIdsByItem, todayEvents, upcomingEvents, tasks } =
    useTodayDashboardData();
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const patchItem = useStore((s) => s.patchItem);

  const tagsForItem = (item: Item) => {
    const baseId = baseItemId(item.id);
    const source = itemsMap[baseId] ?? item;
    return resolveItemTags(effectiveTagIds(source, myTagIdsByItem), tagsMap);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto overflow-x-hidden thin-scrollbar">
      <section className="border-b border-line p-3">
        <div
          className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
            todayEvents.length === 0 ? "mb-1" : "mb-2"
          }`}
        >
          <CalendarClock size={14} className="shrink-0" />
          <span className="shrink-0">Wydarzenia dzisiaj</span>
          {todayEvents.length === 0 && (
            <span className="text-xs font-normal normal-case text-ink-faint">
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
        {upcomingEvents.length > 0 && (
          <>
            <div
              className={`mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
                todayEvents.length === 0 ? "mt-1.5" : "mt-4"
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
          className="inline-flex max-w-[5.5rem] shrink-0 items-center truncate rounded-full px-1.5 py-px text-[10px] font-medium"
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
      <div
        className={`${DASHBOARD_LEFT_COL} flex-col items-center pt-0.5 text-[11px] font-medium tabular-nums text-ink-light`}
      >
        {showEventDate && (
          <div className="mb-0.5 whitespace-nowrap text-center text-[10px] leading-tight text-ink-faint">
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
          className="shrink-0 self-start rounded-md px-1.5 py-0.5 text-[11px] text-ink-light opacity-0 transition hover:text-ink group-hover:opacity-100"
          style={{ background: tint(color, 0.12) }}
        >
          → kalendarz
        </button>
      )}
    </div>
  );
}
