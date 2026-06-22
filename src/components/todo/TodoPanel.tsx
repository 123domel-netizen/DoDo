import { useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarClock,
  CheckSquare,
  ListChecks,
  Paperclip,
  Plus,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { Item } from "@/types";
import { fmt, fmtRange, tint } from "@/lib/format";
import { allDayCalendarDate } from "@/lib/allDay";
import { groupIdForNewItem, findArchiveGroup, itemMatchesGroupFilter } from "@/lib/groups";
import { isSharedItem, SHARE_CALENDAR_COLOR } from "@/lib/share";
import { effectiveReminders } from "@/lib/reminders";
import { defaultTaskDueRange, calendarBlockFromDeadline, itemDurationMinutes } from "@/lib/factory";
import { isToday, isPast, isTomorrow, addMonths } from "date-fns";
import { itemsForUpcomingEventsList } from "@/lib/recurrence";

type SideTab = "tasks" | "events";

export function TodoPanel() {
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const addItem = useStore((s) => s.addItem);
  const startDraft = useStore((s) => s.startDraft);
  const patchItem = useStore((s) => s.patchItem);
  const toggleTaskDone = useStore((s) => s.toggleTaskDone);
  const setEditing = useStore((s) => s.setEditing);
  const [draftTitle, setDraftTitle] = useState("");
  const [tab, setTab] = useState<SideTab>("tasks");

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

  const todos = useMemo(
    () =>
      Object.values(itemsMap)
        .filter((it) => it.showInTodo && itemMatchesGroupFilter(it, activeGroupFilter, "todo"))
        .sort((a, b) => {
          if (archiveGroupId && a.groupId === archiveGroupId && b.groupId === archiveGroupId) {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          }
          if (a.done !== b.done) return a.done ? 1 : -1;
          if (!a.hasDueDate && !b.hasDueDate) return 0;
          if (!a.hasDueDate) return 1;
          if (!b.hasDueDate) return -1;
          return new Date(a.end).getTime() - new Date(b.end).getTime();
        }),
    [itemsMap, activeGroupFilter, archiveGroupId],
  );

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

  const addQuickTask = () => {
    const title = draftTitle.trim();
    if (!title) return;
    addItem({ ...newTaskBase(), title });
    setDraftTitle("");
  };

  const openDetailsDraft = () => {
    startDraft({
      ...newTaskBase(),
      title: draftTitle.trim(),
    });
    setDraftTitle("");
  };

  const activeTasks = todos.filter((t) => !t.done).length;
  const counterLabel =
    tab === "events"
      ? `${upcomingEvents.length} nadchodzących`
      : inArchiveView
        ? `${todos.length} zakończonych`
        : `${activeTasks} aktywnych`;

  return (
    <div className="flex h-full flex-col bg-surface/95">
      <div className="pointer-events-none h-0.5 shrink-0 bg-gradient-to-r from-accent/30 via-accent/10 to-transparent" />
      <div className="flex items-center gap-2 border-b border-line/80 bg-surface-raised/40 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5">
          <TabButton
            active={tab === "tasks"}
            onClick={() => setTab("tasks")}
            icon={<ListChecks size={14} />}
            label="Zadania"
          />
          <TabButton
            active={tab === "events"}
            onClick={() => setTab("events")}
            icon={<CalendarClock size={14} />}
            label="Wydarzenia"
          />
        </div>
        <span className="shrink-0 text-xs text-ink-faint">{counterLabel}</span>
      </div>

      {tab === "tasks" && !inArchiveView && (
        <div className="border-b border-line p-2">
          <div className="flex items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 transition focus-within:border-line-strong">
              <Plus size={15} className="shrink-0 text-ink-faint" />
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuickTask()}
                placeholder="Nowe zadanie…"
                className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <button
              type="button"
              onClick={openDetailsDraft}
              title="Dodaj zadanie ze szczegółami"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
            >
              <SlidersHorizontal size={14} />
              Szczegóły
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto thin-scrollbar p-2">
        {tab === "tasks" ? (
          <>
            {todos.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-ink-faint">
                {inArchiveView
                  ? "Brak zarchiwizowanych zadań."
                  : "Brak zadań. Dodaj pierwsze powyżej."}
              </div>
            )}
            <div className="space-y-1">
              {todos.map((it) => (
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
          </>
        ) : (
          <>
            {upcomingEvents.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-ink-faint">
                Brak nadchodzących wydarzeń.
              </div>
            )}
            <div className="space-y-1">
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
    </div>
  );
}

function TabButton({
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
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${
        active ? "bg-accent text-white shadow-glow" : "text-ink-light hover:text-ink"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
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
  const due = new Date(item.end);
  const overdue = item.hasDueDate && !item.done && isPast(due) && !isToday(due);
  const checklistDone = item.checklist.filter((c) => c.done).length;
  const shared = isSharedItem(item);
  const color = shared ? SHARE_CALENDAR_COLOR : (group?.color ?? "#9b9a97");
  const reminderCount = effectiveReminders(item).length;

  return (
    <div
      className={`group flex gap-2 rounded-lg border border-transparent px-2 py-1.5 transition hover:bg-surface-overlay ${
        shared ? "opacity-[0.72]" : ""
      }`}
      style={{ borderLeft: `3px solid ${item.done ? "#3a3a42" : color}` }}
    >
      <input
        type="checkbox"
        checked={item.done}
        onChange={onToggle}
        disabled={shared}
        className={`mt-0.5 h-4 w-4 shrink-0 accent-accent ${shared ? "cursor-not-allowed opacity-50" : ""}`}
      />
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
        <div className={`text-sm font-medium ${item.done ? "text-ink-faint line-through" : "text-ink"}`}>
          {item.title || "(bez tytułu)"}
          {shared && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              SHARE
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
          {item.hasDueDate ? (
            <span className={overdue ? "font-medium text-red-400" : ""}>
              {item.allDay ? fmt(due, "EEE d MMM") : fmt(due, "EEE d MMM, HH:mm")}
            </span>
          ) : (
            <span>Bez terminu</span>
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
      </div>
      {!item.showInCalendar && (
        <button
          onClick={onConvert}
          title="Zmień na wydarzenie (pokaż w kalendarzu)"
          className="self-start rounded-md px-1.5 py-0.5 text-[11px] text-ink-light opacity-0 transition hover:text-ink group-hover:opacity-100"
          style={{ background: tint(color, 0.12) }}
        >
          → kalendarz
        </button>
      )}
    </div>
  );
}
