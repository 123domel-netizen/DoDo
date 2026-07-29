import { Check, ClipboardList, X } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { formatDayShort } from "@/lib/projectsPreview/projectLastEvent";
import { scheduleEventLabel } from "@/lib/projectsPreview/types";

interface ToWriteQueuePanelProps {
  onClose: () => void;
  /** Jump to the budowa board, focused on the event's day / block. */
  onOpenEvent: (opts: {
    projectId: string;
    blockId: string | null;
    date: string;
  }) => void;
}

/**
 * Slide-over kolejki „do wpisania”. Read + one action (oznacz wpisane) —
 * pełna edycja żyje na tablicy, przy zdarzeniu.
 */
export function ToWriteQueuePanel({
  onClose,
  onOpenEvent,
}: ToWriteQueuePanelProps) {
  const repo = useProjectsPreviewRepo();
  const queue = repo.listToWrite();

  return (
    <div className="absolute inset-0 z-[40] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Zamknij kolejkę"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-sm flex-col border-l border-line bg-surface-overlay shadow-pop"
        aria-label="Do wpisania"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <ClipboardList size={14} className="shrink-0 text-amber-300" />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
            Do wpisania
            <span className="ml-1.5 font-normal tabular-nums text-ink-faint">
              {queue.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
          {queue.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-faint">
              Nic nie czeka na wpisanie.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {queue.map((event) => (
                <li key={event.id}>
                  <div className="flex items-start gap-2 px-3 py-2 transition hover:bg-surface-raised/50">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenEvent({
                          projectId: event.projectId,
                          blockId: event.blockId,
                          date: event.date,
                        })
                      }
                      className="min-w-0 flex-1 text-left"
                      title="Pokaż na harmonogramie"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-accent">
                          #{event.project?.number ?? "?"}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                          {formatDayShort(event.date)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] font-medium text-ink">
                        {scheduleEventLabel(event)}
                      </div>
                      {event.note.trim() ? (
                        <div className="truncate text-[10px] text-ink-faint">
                          {event.note}
                        </div>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => repo.setDocEventStatus(event.id, "wpisane")}
                      className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[10px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
                      title="Oznacz jako wpisane"
                    >
                      <Check size={11} />
                      Wpisane
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
