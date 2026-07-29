import { CalendarPlus, ClipboardList, ListPlus, Zap } from "lucide-react";
import { formatDayShort } from "@/lib/projectsPreview/projectLastEvent";
import type { ScheduleDashboardHint } from "@/lib/projectsPreview/dashboardScheduleHints";
import { SCHEDULE_EVENT_KIND_LABEL } from "@/lib/projectsPreview/types";

const LEFT_COL = "flex w-14 shrink-0 flex-col items-center justify-center text-[10px] text-ink-faint";

export function ScheduleDashboardHintRow({
  hint,
  showDate,
  onAddTask,
  onAddEvent,
}: {
  hint: ScheduleDashboardHint;
  showDate?: boolean;
  onAddTask: () => void;
  onAddEvent: () => void;
}) {
  const kindLabel = SCHEDULE_EVENT_KIND_LABEL[hint.kind];

  return (
    <div
      className="group flex min-w-0 gap-1.5 rounded-lg border border-dashed border-line/45 bg-surface-raised/20 px-1.5 py-1"
      title={`Harmonogram · ${hint.projectLabel}\n${kindLabel}: ${hint.title}`}
    >
      <div className={LEFT_COL}>
        {showDate ? (
          <span className="whitespace-nowrap text-center leading-tight">
            {formatDayShort(hint.date)}
          </span>
        ) : (
          <span className="text-[9px] uppercase tracking-wide">Harm.</span>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1">
          {hint.kind === "budowlane" ? (
            <Zap size={10} className="shrink-0 text-amber-400" aria-hidden />
          ) : (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"
              aria-hidden
            />
          )}
          <span className="truncate text-[11px] text-ink">
            <span className="text-ink-faint">#{hint.projectNumber}</span>{" "}
            {hint.title}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={onAddTask}
          title="Dodaj jako zadanie"
          className="rounded p-0.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
        >
          <ListPlus size={12} />
        </button>
        <button
          type="button"
          onClick={onAddEvent}
          title="Dodaj jako wydarzenie"
          className="rounded p-0.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
        >
          <CalendarPlus size={12} />
        </button>
      </div>
    </div>
  );
}

export function ScheduleDashboardHintSectionLabel() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-normal normal-case text-ink-faint">
      <ClipboardList size={10} className="shrink-0" />
      Harmonogram
    </span>
  );
}
