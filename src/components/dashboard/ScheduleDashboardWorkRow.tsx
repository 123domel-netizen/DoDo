import { useEffect, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  GanttChart,
  ListPlus,
  Zap,
} from "lucide-react";
import { useStore } from "@/state/store";
import { calendarBlockFromDeadline } from "@/lib/factory";
import {
  formatScheduleWorkLine,
  type ScheduleDashboardEvent,
  type ScheduleDashboardFeedItem,
  type ScheduleDashboardWork,
} from "@/lib/projectsPreview/dashboardScheduleWorks";
import {
  loadDashboardSchedulesCollapsed,
  resolveDashboardSchedulesCollapsed,
  saveDashboardSchedulesCollapsed,
} from "@/lib/projectsPreview/dashboardSchedulesCollapse";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import type { ScheduleEvent } from "@/lib/projectsPreview/types";
import { SCHEDULE_EVENT_KIND_LABEL } from "@/lib/projectsPreview/types";
import { useScheduleDashboardWorks } from "@/hooks/useScheduleDashboardWorks";
import { useScheduleRepo } from "@/hooks/useScheduleRepo";
import {
  ScheduleEventSheet,
  type ScheduleEventDraft,
} from "@/components/projectsPreview/ScheduleEventSheet";

function isoToDotDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function workDueIso(work: ScheduleDashboardWork): string {
  const today = todayIso();
  if (work.inProgress && work.startDate <= today) return today;
  return work.startDate;
}

function FeedActions({
  onAddTask,
  onAddEvent,
}: {
  onAddTask: () => void;
  onAddEvent: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0 opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
      <button
        type="button"
        onClick={onAddTask}
        title="Utwórz zadanie"
        className="rounded p-0.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
      >
        <ListPlus size={12} />
      </button>
      <button
        type="button"
        onClick={onAddEvent}
        title="Utwórz wydarzenie"
        className="rounded p-0.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
      >
        <CalendarPlus size={12} />
      </button>
    </div>
  );
}

function WorkFeedRow({
  work,
  showStartDate,
  onAddTask,
  onAddEvent,
}: {
  work: ScheduleDashboardWork;
  showStartDate?: boolean;
  onAddTask: () => void;
  onAddEvent: () => void;
}) {
  return (
    <div
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition hover:bg-surface-raised/40"
      title={`${work.projectLabel}\n${work.startDate} → ${work.endDate}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          work.inProgress ? "bg-accent" : "bg-ink-faint"
        }`}
        aria-hidden
      />
      <p className="min-w-0 flex-1 truncate text-[12px] leading-snug text-ink">
        <span className="text-ink-faint">#{work.projectNumber}</span> {work.title}
        {work.crewName ? ` ${work.crewName}` : ""}
        {showStartDate ? (
          <span className="text-ink-faint"> {isoToDotDate(work.startDate)}</span>
        ) : null}
      </p>
      <FeedActions onAddTask={onAddTask} onAddEvent={onAddEvent} />
    </div>
  );
}

function EventFeedRow({
  event,
  showDate,
  onOpen,
  onAddTask,
  onAddEvent,
}: {
  event: ScheduleDashboardEvent;
  showDate?: boolean;
  onOpen: () => void;
  onAddTask: () => void;
  onAddEvent: () => void;
}) {
  const kindLabel = SCHEDULE_EVENT_KIND_LABEL[event.kind];
  return (
    <div
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition hover:bg-surface-raised/40"
      title={`Harmonogram · ${event.projectLabel}\n${kindLabel}: ${event.title}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {event.kind === "budowlane" ? (
          <Zap size={10} className="shrink-0 text-amber-400" aria-hidden />
        ) : (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-ink">
          <span className="text-ink-faint">#{event.projectNumber}</span>{" "}
          {event.title}
          {showDate ? (
            <span className="text-ink-faint"> {isoToDotDate(event.date)}</span>
          ) : null}
        </span>
      </button>
      <FeedActions onAddTask={onAddTask} onAddEvent={onAddEvent} />
    </div>
  );
}

function FeedList({
  items,
  showDates,
  onOpenEvent,
  onAddTaskFromWork,
  onAddEventFromWork,
  onAddTaskFromEvent,
  onAddEventFromEvent,
}: {
  items: ScheduleDashboardFeedItem[];
  showDates?: boolean;
  onOpenEvent: (event: ScheduleDashboardEvent) => void;
  onAddTaskFromWork: (work: ScheduleDashboardWork) => void;
  onAddEventFromWork: (work: ScheduleDashboardWork) => void;
  onAddTaskFromEvent: (event: ScheduleDashboardEvent) => void;
  onAddEventFromEvent: (event: ScheduleDashboardEvent) => void;
}) {
  return (
    <div className="space-y-px">
      {items.map((item) =>
        item.type === "work" ? (
          <WorkFeedRow
            key={`w:${item.work.id}`}
            work={item.work}
            showStartDate={showDates && !item.work.inProgress}
            onAddTask={() => onAddTaskFromWork(item.work)}
            onAddEvent={() => onAddEventFromWork(item.work)}
          />
        ) : (
          <EventFeedRow
            key={`e:${item.event.id}`}
            event={item.event}
            showDate={showDates}
            onOpen={() => onOpenEvent(item.event)}
            onAddTask={() => onAddTaskFromEvent(item.event)}
            onAddEvent={() => onAddEventFromEvent(item.event)}
          />
        ),
      )}
    </div>
  );
}

export function ScheduleDashboardWorksSection() {
  const { inProgress, startingSoon } = useScheduleDashboardWorks();
  const addItem = useStore((s) => s.addItem);
  const setEditing = useStore((s) => s.setEditing);
  const authUserId = useStore((s) => s.authUserId);
  const collapseUserId = authUserId ?? "local";
  const scheduleRepo = useScheduleRepo();
  const scheduleState = scheduleRepo.getState();
  const [editEvent, setEditEvent] = useState<{
    event: ScheduleEvent;
    meta: ScheduleDashboardEvent;
  } | null>(null);
  const [storedCollapsed, setStoredCollapsed] = useState<boolean | null>(() =>
    loadDashboardSchedulesCollapsed(collapseUserId),
  );

  useEffect(() => {
    setStoredCollapsed(loadDashboardSchedulesCollapsed(collapseUserId));
  }, [collapseUserId]);

  const collapsed = resolveDashboardSchedulesCollapsed({
    userId: collapseUserId,
    projects: scheduleState.projects,
    stored: storedCollapsed,
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    saveDashboardSchedulesCollapsed(collapseUserId, next);
    setStoredCollapsed(next);
  };

  const empty = inProgress.length === 0 && startingSoon.length === 0;
  const feedCount = inProgress.length + startingSoon.length;

  const isoNoon = (date: string) => new Date(`${date}T12:00:00`).toISOString();

  const addTaskFromWork = (work: ScheduleDashboardWork) => {
    const due = isoNoon(workDueIso(work));
    addItem({
      type: "task",
      title: formatScheduleWorkLine(work),
      showInTodo: true,
      showInCalendar: false,
      hasDueDate: true,
      start: due,
      end: due,
      description: `Harmonogram · zakres (${work.projectLabel})`,
    });
  };

  const addEventFromWork = (work: ScheduleDashboardWork) => {
    const due = isoNoon(workDueIso(work));
    const { start, end } = calendarBlockFromDeadline(due, 60);
    const item = addItem({
      type: "event",
      title: formatScheduleWorkLine(work),
      showInTodo: true,
      showInCalendar: true,
      hasDueDate: true,
      allDay: true,
      start,
      end,
      description: `Harmonogram · zakres (${work.projectLabel})`,
    });
    setEditing(item.id);
  };

  const addTaskFromEvent = (event: ScheduleDashboardEvent) => {
    const due = isoNoon(event.date);
    addItem({
      type: "task",
      title: `${event.projectLabel}: ${event.title}`,
      showInTodo: true,
      showInCalendar: false,
      hasDueDate: true,
      start: due,
      end: due,
      description: `Harmonogram (${event.kind === "budowlane" ? "budowlane" : "dokumentacyjne"})`,
    });
  };

  const addEventFromEvent = (event: ScheduleDashboardEvent) => {
    const due = isoNoon(event.date);
    const { start, end } = calendarBlockFromDeadline(due, 60);
    const item = addItem({
      type: "event",
      title: `${event.projectLabel}: ${event.title}`,
      showInTodo: true,
      showInCalendar: true,
      hasDueDate: true,
      allDay: true,
      start,
      end,
      description: `Harmonogram (${event.kind === "budowlane" ? "budowlane" : "dokumentacyjne"})`,
    });
    setEditing(item.id);
  };

  const openEvent = async (meta: ScheduleDashboardEvent) => {
    let event = scheduleRepo
      .getState()
      .scheduleEvents.find((e) => e.id === meta.id);
    if (!event && scheduleRepo.reload) {
      try {
        await scheduleRepo.reload();
      } catch (err) {
        console.warn("[schedules] reload before open failed:", err);
      }
      event = scheduleRepo
        .getState()
        .scheduleEvents.find((e) => e.id === meta.id);
    }
    if (!event) {
      alert("Nie udało się wczytać zdarzenia z harmonogramu.");
      return;
    }
    setEditEvent({ event, meta });
  };

  const saveEvent = (data: ScheduleEventDraft) => {
    scheduleRepo.upsertScheduleEvent(data);
    setEditEvent(null);
  };

  return (
    <>
      <section className="border-b border-line p-3 xl:px-3.5 xl:py-3.5 2xl:px-4">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className={`flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-faint transition hover:text-ink-light ${
            collapsed || empty ? "mb-0" : "mb-1.5"
          }`}
        >
          {collapsed ? (
            <ChevronRight size={14} className="shrink-0" aria-hidden />
          ) : (
            <ChevronDown size={14} className="shrink-0" aria-hidden />
          )}
          <GanttChart size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">Harmonogramy</span>
          {collapsed && feedCount > 0 ? (
            <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
              {feedCount}
            </span>
          ) : null}
          {!collapsed && empty ? (
            <span className="font-normal normal-case tracking-normal text-ink-faint">
              Brak aktywnych zakresów
            </span>
          ) : null}
        </button>

        {!collapsed && inProgress.length > 0 ? (
          <div className={startingSoon.length > 0 ? "mb-2" : undefined}>
            <p className="mb-0.5 text-[10px] font-medium text-ink-faint">
              Aktualnie powinny być procedowane
            </p>
            <FeedList
              items={inProgress}
              onOpenEvent={(e) => void openEvent(e)}
              onAddTaskFromWork={addTaskFromWork}
              onAddEventFromWork={addEventFromWork}
              onAddTaskFromEvent={addTaskFromEvent}
              onAddEventFromEvent={addEventFromEvent}
            />
          </div>
        ) : null}

        {!collapsed && startingSoon.length > 0 ? (
          <div>
            <p className="mb-0.5 text-[10px] font-medium text-ink-faint">
              W najbliższym czasie rozpoczynają się
            </p>
            <FeedList
              items={startingSoon}
              showDates
              onOpenEvent={(e) => void openEvent(e)}
              onAddTaskFromWork={addTaskFromWork}
              onAddEventFromWork={addEventFromWork}
              onAddTaskFromEvent={addTaskFromEvent}
              onAddEventFromEvent={addEventFromEvent}
            />
          </div>
        ) : null}

        {!collapsed && empty ? (
          <p className="mt-1 text-[11px] text-ink-faint">Brak aktywnych zakresów</p>
        ) : null}
      </section>

      {editEvent ? (
        <ScheduleEventSheet
          key={editEvent.event.id}
          projectId={editEvent.event.projectId}
          project={
            scheduleState.projects.find(
              (p) => p.id === editEvent.event.projectId,
            ) ?? {
              number: editEvent.meta.projectNumber,
              name: editEvent.meta.projectName,
            }
          }
          blocks={scheduleState.scheduleBlocks.filter(
            (b) => b.projectId === editEvent.event.projectId,
          )}
          categoryMeta={scheduleState.categoryMeta.filter(
            (m) => m.projectId === editEvent.event.projectId,
          )}
          blockId={editEvent.event.blockId}
          defaultCategoryId={editEvent.event.categoryId}
          event={editEvent.event}
          defaultKind={editEvent.event.kind}
          lockKind
          catalog={scheduleState.catalog}
          scheduleCatalog={scheduleState.scheduleCatalog}
          users={scheduleState.users}
          onClose={() => setEditEvent(null)}
          onSave={saveEvent}
          onDelete={() => {
            scheduleRepo.deleteScheduleEvent(editEvent.event.id);
            setEditEvent(null);
          }}
        />
      ) : null}
    </>
  );
}
