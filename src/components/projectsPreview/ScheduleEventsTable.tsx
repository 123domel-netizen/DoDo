import { Pencil, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { formatDayShort } from "@/lib/projectsPreview/projectLastEvent";
import {
  DOC_EVENT_STATUS_LABEL,
  DOC_EVENT_STATUSES,
  projectLabel,
  scheduleEventLabel,
  type DocEventStatus,
  type PreviewProject,
  type ScheduleBlock,
  type ScheduleEvent,
  type ScheduleEventKind,
} from "@/lib/projectsPreview/types";

interface ScheduleEventsTableProps {
  kind: ScheduleEventKind;
  events: ScheduleEvent[];
  projects: PreviewProject[];
  blocks: ScheduleBlock[];
  onEdit: (event: ScheduleEvent) => void;
  onAdd: () => void;
}

/**
 * Flat table of schedule events for one kind (budowlane | dokumentacyjne).
 * Used by the top-level Zdarzenia section — not by the Gantt toolbar.
 */
export function ScheduleEventsTable({
  kind,
  events,
  projects,
  blocks,
  onEdit,
  onAdd,
}: ScheduleEventsTableProps) {
  const repo = useProjectsPreviewRepo();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const byBlock = new Map(blocks.map((b) => [b.id, b]));

  const sorted = events
    .slice()
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        scheduleEventLabel(a).localeCompare(scheduleEventLabel(b)),
    );

  const emptyCopy =
    kind === "budowlane"
      ? "Brak zdarzeń budowlanych w wybranym zakresie."
      : "Brak zdarzeń dokumentacyjnych w wybranym zakresie.";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] text-ink-faint">
          {sorted.length}{" "}
          {sorted.length === 1 ? "zdarzenie" : "zdarzeń"} ·{" "}
          {kind === "budowlane" ? "budowlane" : "dokumentacyjne"}
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white"
        >
          {kind === "budowlane" ? (
            <Zap size={12} className="text-amber-200" />
          ) : null}
          Dodaj
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto thin-scrollbar">
        {sorted.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-faint">
            {emptyCopy}
          </p>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface-raised/95 backdrop-blur-sm">
              <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="w-[4.5rem] px-2 py-1">Data</th>
                <th className="w-[8rem] px-1.5 py-1">Budowa</th>
                <th className="min-w-[10rem] px-1.5 py-1">Treść</th>
                <th className="min-w-[7rem] px-1.5 py-1">Robota</th>
                {kind === "dokumentacyjne" ? (
                  <th className="w-[6.5rem] px-1.5 py-1">Status</th>
                ) : null}
                <th className="min-w-[7rem] px-1.5 py-1">Notatka</th>
                <th className="w-[4rem] px-1.5 py-1 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((event) => {
                const project = byProject.get(event.projectId);
                const block = event.blockId
                  ? byBlock.get(event.blockId)
                  : undefined;
                return (
                  <tr
                    key={event.id}
                    className="border-b border-line/50 transition hover:bg-surface-raised/40"
                  >
                    <td className="whitespace-nowrap px-2 py-1 tabular-nums text-ink-light">
                      {formatDayShort(event.date)}
                    </td>
                    <td
                      className="max-w-[8rem] truncate px-1.5 py-1 font-medium text-ink"
                      title={project ? projectLabel(project) : undefined}
                    >
                      {project ? projectLabel(project) : "—"}
                    </td>
                    <td className="max-w-[18rem] truncate px-1.5 py-1 text-ink">
                      <button
                        type="button"
                        onClick={() => onEdit(event)}
                        className="inline-flex max-w-full items-center gap-1 truncate text-left font-medium hover:text-accent"
                        title={scheduleEventLabel(event)}
                      >
                        {kind === "budowlane" ? (
                          <Zap
                            size={11}
                            className="shrink-0 text-amber-400"
                          />
                        ) : (
                          <span
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"
                            aria-hidden
                          />
                        )}
                        <span className="truncate">
                          {scheduleEventLabel(event)}
                        </span>
                      </button>
                    </td>
                    <td
                      className="max-w-[10rem] truncate px-1.5 py-1 text-[11px] text-ink-faint"
                      title={
                        block ? block.title || block.scope : undefined
                      }
                    >
                      {block ? block.title || block.scope : "Bez roboty"}
                    </td>
                    {kind === "dokumentacyjne" ? (
                      <td className="whitespace-nowrap px-1.5 py-1">
                        <select
                          value={event.status ?? "do_wpisania"}
                          onChange={(e) =>
                            repo.setDocEventStatus(
                              event.id,
                              e.target.value as DocEventStatus,
                            )
                          }
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Status zdarzenia"
                          className="max-w-[7.5rem] rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-ink-light outline-none transition hover:border-line hover:bg-surface-raised focus:border-line-strong focus:bg-surface-raised"
                        >
                          {DOC_EVENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {DOC_EVENT_STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td
                      className="max-w-[12rem] truncate px-1.5 py-1 text-[11px] text-ink-faint"
                      title={event.note.trim() || undefined}
                    >
                      {event.note.trim() || "—"}
                    </td>
                    <td className="px-1.5 py-0.5 text-right">
                      <div className="inline-flex items-center">
                        <button
                          type="button"
                          title="Edytuj"
                          onClick={() => onEdit(event)}
                          className="rounded p-0.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          title={
                            pendingDeleteId === event.id
                              ? "Potwierdź usunięcie"
                              : "Usuń"
                          }
                          onClick={() => {
                            if (pendingDeleteId === event.id) {
                              repo.deleteScheduleEvent(event.id);
                              setPendingDeleteId(null);
                              return;
                            }
                            setPendingDeleteId(event.id);
                          }}
                          onBlur={() => {
                            if (pendingDeleteId === event.id) {
                              setPendingDeleteId(null);
                            }
                          }}
                          className={
                            pendingDeleteId === event.id
                              ? "rounded p-0.5 text-rose-300 hover:bg-red-950/40"
                              : "rounded p-0.5 text-ink-faint hover:bg-surface-raised hover:text-rose-300"
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
