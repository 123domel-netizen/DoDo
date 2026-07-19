import { useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarClock,
  CheckSquare,
  ListChecks,
  Paperclip,
  Pin,
  Plus,
  Sun,
  Users,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { Item } from "@/types";
import { fmt, fmtRange } from "@/lib/format";
import { allDayCalendarDate } from "@/lib/allDay";
import { groupIdForNewItem, findArchiveGroup, itemMatchesGroupFilter } from "@/lib/groups";
import { isSharedItem, SHARE_CALENDAR_COLOR } from "@/lib/share";
import { effectiveReminders } from "@/lib/reminders";
import { defaultTaskDueRange, calendarBlockFromDeadline, itemDurationMinutes } from "@/lib/factory";
import { isToday, isPast, isTomorrow, addMonths, subDays } from "date-fns";
import { expandItemsForRange, hasRecurrence, itemsForUpcomingEventsList } from "@/lib/recurrence";
import { baseItemId } from "@/lib/itemId";
import { itemSupportsTodoDone } from "@/lib/items";
import { TodayDashboardPanel } from "@/components/dashboard/TodayDashboardPanel";
import { useIsMobile } from "@/hooks/useMediaQuery";

type SideTab = "tasks" | "events" | "today";

export function TodoPanel() {
  const isMobile = useIsMobile();
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const startDraft = useStore((s) => s.startDraft);
  const patchItem = useStore((s) => s.patchItem);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const [tab, setTab] = useState<SideTab>("tasks");
  // Mobile: dolne menu już ma Dashboard / Kalendarz / Zadania — tu tylko lista zadań.
  const activeTab: SideTab = isMobile ? "tasks" : tab;

  const groups = useMemo(() => {
    const m: Record<string, { name: string; color: string }> = {};
    for (const g of groupsArr) m[g.id] = g;
    return m;
  }, [groupsArr]);

  const archiveGroupId = useMemo(
    () => findArchiveGroup(groupsArr)?.id ?? null,
    [groupsArr],
  );

  const inArchiveView = activeGroupFilter === archiveGroupId;

  const todos = useMemo(() => {
    const base = Object.values(itemsMap).filter(
      (it) => it.showInTodo && itemMatchesGroupFilter(it, activeGroupFilter, "todo"),
    );

    if (inArchiveView) {
      return base.sort((a, b) => {
        const ap = a.pinnedAt ? 1 : 0;
        const bp = b.pinnedAt ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    const now = new Date();
    const from = subDays(now, 30);
    const to = addMonths(now, 6);

    const expanded: Item[] = [];
    for (const it of base) {
      if (hasRecurrence(it) && it.hasDueDate && !it.done) {
        expanded.push(...expandItemsForRange([it], from, to, "todo"));
      } else {
        expanded.push(it);
      }
    }

    return expanded.sort((a, b) => {
      const ap = a.pinnedAt ? 1 : 0;
      const bp = b.pinnedAt ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.hasDueDate && !b.hasDueDate) return 0;
      if (!a.hasDueDate) return 1;
      if (!b.hasDueDate) return -1;
      return new Date(a.end).getTime() - new Date(b.end).getTime();
    });
  }, [itemsMap, activeGroupFilter, inArchiveView]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const horizon = addMonths(now, 6);
    return itemsForUpcomingEventsList(
      Object.values(itemsMap).filter(
        (it) =>
          itemMatchesGroupFilter(it, activeGroupFilter, "calendar") &&
          (it.type !== "task" || !it.done),
      ),
      now,
      horizon,
    );
  }, [itemsMap, activeGroupFilter]);

  const newTaskBase = () => ({
    type: "task" as const,
    hasDueDate: false,
    showInTodo: true,
    showInCalendar: false,
    groupId: groupIdForNewItem(),
  });

  const openTaskDraft = () => {
    startDraft(newTaskBase());
  };

  const openEventDraft = () => {
    const start = new Date();
    start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
    startDraft({
      type: "event",
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
      groupId: groupIdForNewItem(),
    });
  };

  const activeTasks = useMemo(() => {
    const seen = new Set<string>();
    let n = 0;
    for (const t of todos) {
      if (t.done) continue;
      const bid = baseItemId(t.id);
      if (seen.has(bid)) continue;
      seen.add(bid);
      n++;
    }
    return n;
  }, [todos]);
  const counterLabel =
    activeTab === "events"
      ? `${upcomingEvents.length} nadchodzących`
      : activeTab === "tasks"
        ? inArchiveView
          ? `${todos.length} zakończonych`
          : `${activeTasks} aktywnych`
        : null;

  return (
    <div className="flex h-full flex-col bg-surface/95">
      <div className="pointer-events-none h-0.5 shrink-0 bg-gradient-to-r from-accent/30 via-accent/10 to-transparent" />
      {!isMobile && (
        <div className="border-b border-line/80 bg-surface-raised/40 px-3 py-2">
          <div className="flex min-w-0 items-stretch gap-1 rounded-xl border border-line bg-surface-raised p-1">
            <PanelTab
              active={activeTab === "tasks"}
              onClick={() => setTab("tasks")}
              icon={<ListChecks size={16} />}
              label="Zadania"
            />
            <PanelTab
              active={activeTab === "events"}
              onClick={() => setTab("events")}
              icon={<CalendarClock size={16} />}
              label="Wydarzenia"
            />
            <PanelTab
              active={activeTab === "today"}
              onClick={() => setTab("today")}
              icon={<Sun size={16} />}
              label="Dashboard"
            />
          </div>
        </div>
      )}

      {activeTab === "tasks" && (
        <PanelActionBar
          addLabel="Dodaj zadanie"
          onAdd={inArchiveView ? undefined : openTaskDraft}
          counterLabel={counterLabel ?? ""}
        />
      )}

      {activeTab === "events" && (
        <PanelActionBar
          addLabel="Dodaj wydarzenie"
          onAdd={openEventDraft}
          counterLabel={counterLabel ?? ""}
        />
      )}

      {activeTab === "today" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <TodayDashboardPanel />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden thin-scrollbar p-2">
          {activeTab === "tasks" ? (
          <>
            {todos.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-ink-faint">
                {inArchiveView
                  ? "Brak zarchiwizowanych zadań."
                  : "Brak zadań. Użyj „Dodaj zadanie” powyżej."}
              </div>
            )}
            <div className="w-full space-y-1">
              {todos.map((it) => (
                <TodoRow
                  key={it.id}
                  item={it}
                  group={it.groupId ? groups[it.groupId] : undefined}
                  onToggle={() => toggleTaskDone(baseItemId(it.id))}
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
                patchItem(baseItemId(it.id), patch);
              }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {upcomingEvents.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-ink-faint">
                Brak nadchodzących wydarzeń.
              </div>
            )}
            <div className="w-full space-y-1">
              {upcomingEvents.map((it) => (
                <EventRow
                  key={it.id}
                  item={it}
                  group={it.groupId ? groups[it.groupId] : undefined}
                  onOpen={() => setEditing(it.id)}
                />
              ))}
            </div>
          </>
        )}
        </div>
      )}
    </div>
  );
}

function PanelTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition ${
        active
          ? "bg-accent text-white shadow-glow"
          : "text-ink-light hover:bg-surface-overlay hover:text-ink"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function PanelActionBar({
  addLabel,
  onAdd,
  counterLabel,
}: {
  addLabel: string;
  onAdd?: () => void;
  counterLabel: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">{counterLabel}</span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent-grad px-2.5 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110"
        >
          <Plus size={14} strokeWidth={2.5} />
          {addLabel}
        </button>
      )}
    </div>
  );
}

export function EventRow({
  item,
  group,
  onOpen,
}: {
  item: Item;
  group?: { name: string; color: string };
  onOpen: () => void;
}) {
  const start = item.allDay ? allDayCalendarDate(item.start) : new Date(item.start);
  const today = isToday(start);
  const tomorrow = isTomorrow(start);
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#5E7FA8");
  const reminderCount = effectiveReminders(item).length;

  const whenLabel = item.allDay
    ? today
      ? "Dziś, cały dzień"
      : tomorrow
        ? "Jutro, cały dzień"
        : `${fmt(start, "EEE d MMM")}, cały dzień`
    : today
      ? `Dziś, ${fmtRange(item.start, item.end)}`
      : tomorrow
        ? `Jutro, ${fmtRange(item.start, item.end)}`
        : `${fmt(start, "EEE d MMM")}, ${fmtRange(item.start, item.end)}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <CalendarClock size={15} className="mt-0.5 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
          <span className={today ? "font-medium text-accent-soft" : ""}>{whenLabel}</span>
          {shared ? (
            <span className="inline-flex items-center gap-1 text-ink-faint">SHARE</span>
          ) : group ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {group.name}
            </span>
          ) : null}
          {item.participants.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Users size={11} /> {item.participants.length}
            </span>
          )}
          {reminderCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Bell size={11} /> {reminderCount}
            </span>
          )}
          {item.attachments.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Paperclip size={11} /> {item.attachments.length}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function TodoRow({
  item,
  group,
  onToggle,
  onOpen,
  onConvert,
}: {
  item: Item;
  group?: { name: string; color: string };
  onToggle: () => void;
  onOpen: () => void;
  onConvert: () => void;
}) {
  const patchItem = useStore((s) => s.patchItem);
  const due = new Date(item.end);
  const overdue = item.hasDueDate && !item.done && isPast(due) && !isToday(due);
  const checklistDone = item.checklist.filter((c) => c.done).length;
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#9b9a97");
  const reminderCount = effectiveReminders(item).length;
  const pinned = Boolean(item.pinnedAt);
  const showMeta =
    item.hasDueDate ||
    shared ||
    Boolean(group) ||
    item.checklist.length > 0 ||
    reminderCount > 0 ||
    item.participants.length > 0 ||
    item.attachments.length > 0;

  const togglePin = () => {
    if (shared) return;
    patchItem(baseItemId(item.id), {
      pinnedAt: pinned ? null : new Date().toISOString(),
    });
  };

  const toggleCalendar = () => {
    if (shared) return;
    if (item.showInCalendar) {
      patchItem(baseItemId(item.id), { showInCalendar: false });
    } else {
      onConvert();
    }
  };

  return (
    <div
      className={`group flex w-full gap-2 rounded-lg border border-transparent px-2 py-1.5 transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      } ${pinned && !item.done ? "bg-accent/[0.06]" : ""}`}
      style={{ borderLeft: `3px solid ${item.done ? "#3a3a42" : color}` }}
    >
      {itemSupportsTodoDone(item) ? (
        <input
          type="checkbox"
          checked={item.done}
          onChange={onToggle}
          disabled={shared}
          className={`mt-0.5 h-4 w-4 shrink-0 accent-accent ${shared ? "cursor-not-allowed opacity-50" : ""}`}
        />
      ) : (
        <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
        <div className={`text-sm font-medium ${item.done ? "text-ink-faint line-through" : "text-ink"}`}>
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        {showMeta && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
            {item.hasDueDate && (
              <span className={overdue ? "font-medium text-red-400" : ""}>
                {item.allDay ? fmt(due, "EEE d MMM") : fmt(due, "EEE d MMM, HH:mm")}
              </span>
            )}
            {shared ? (
              <span className="inline-flex items-center gap-1 text-ink-faint">SHARE</span>
            ) : group ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                {group.name}
              </span>
            ) : null}
            {item.checklist.length > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <CheckSquare size={11} /> {checklistDone}/{item.checklist.length}
              </span>
            )}
            {reminderCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Bell size={11} /> {reminderCount}
              </span>
            )}
            {item.participants.length > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Users size={11} /> {item.participants.length}
              </span>
            )}
            {item.attachments.length > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip size={11} /> {item.attachments.length}
              </span>
            )}
          </div>
        )}
      </div>
      {!shared && (
        <div className="flex shrink-0 items-start gap-0.5 self-center">
          <button
            type="button"
            onClick={togglePin}
            title={pinned ? "Odepnij" : "Przypnij na górę"}
            aria-label={pinned ? "Odepnij" : "Przypnij na górę"}
            aria-pressed={pinned}
            className={`rounded-md p-1 transition hover:bg-surface-raised ${
              pinned ? "text-accent" : "text-ink-faint/45 hover:text-ink-faint"
            }`}
          >
            <Pin size={15} className={pinned ? "fill-accent" : ""} strokeWidth={pinned ? 2.25 : 1.75} />
          </button>
          <button
            type="button"
            onClick={toggleCalendar}
            title={item.showInCalendar ? "Ukryj w kalendarzu" : "Pokaż w kalendarzu"}
            aria-label={item.showInCalendar ? "Ukryj w kalendarzu" : "Pokaż w kalendarzu"}
            aria-pressed={item.showInCalendar}
            className={`rounded-md p-1 transition hover:bg-surface-raised ${
              item.showInCalendar ? "text-accent" : "text-ink-faint/45 hover:text-ink-faint"
            }`}
          >
            <CalendarClock
              size={15}
              className={item.showInCalendar ? "fill-accent/25" : ""}
              strokeWidth={item.showInCalendar ? 2.25 : 1.75}
            />
          </button>
        </div>
      )}
    </div>
  );
}
