import {
  CalendarPlus,
  CheckSquare,
  Copy,
  Forward,
  X,
} from "lucide-react";

interface MessageSelectionBarProps {
  count: number;
  busy?: boolean;
  onForward: () => void;
  onCreateTask: () => void;
  onCreateEvent: () => void;
  onCopy: () => void;
  onClear: () => void;
}

function countLabel(n: number): string {
  if (n === 1) return "1 zaznaczona";
  if (n >= 2 && n <= 4) return `${n} zaznaczone`;
  return `${n} zaznaczonych`;
}

/** Pasek akcji zbiorczych nad composerem — zawsze widoczne przyciski (wrap w wąskim panelu). */
export function MessageSelectionBar({
  count,
  busy = false,
  onForward,
  onCreateTask,
  onCreateEvent,
  onCopy,
  onClear,
}: MessageSelectionBarProps) {
  const action =
    "inline-flex h-8 min-w-0 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center gap-1.5 rounded-lg border border-line/80 bg-surface px-2 text-[12px] font-medium text-ink transition hover:border-accent/50 hover:bg-accent/10 hover:text-accent sm:flex-none sm:basis-auto sm:justify-start sm:rounded-full sm:px-3 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-accent/25 bg-gradient-to-r from-accent/10 via-surface-raised/90 to-surface-raised/90 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 items-center rounded-full bg-accent/20 px-2.5 text-[11px] font-semibold tabular-nums text-accent">
          {countLabel(count)}
        </span>
        <span className="min-w-0 flex-1 text-[10px] text-ink-faint">
          2× zaznaczenie = wiele punktów
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-ink/10 hover:text-ink disabled:opacity-40"
          aria-label="Anuluj zaznaczenie"
          title="Anuluj"
        >
          <X size={15} strokeWidth={2.25} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onForward}
          className={action}
          title="Przekaż do innej rozmowy"
        >
          <Forward size={13} strokeWidth={2.25} className="shrink-0" />
          Przekaż
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCopy}
          className={action}
          title="Skopiuj treść (kolejność wg daty)"
        >
          <Copy size={13} strokeWidth={2.25} className="shrink-0" />
          Skopiuj
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateTask}
          className={action}
          title="Utwórz zadanie"
        >
          <CheckSquare size={13} strokeWidth={2.25} className="shrink-0" />
          Zadanie
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateEvent}
          className={action}
          title="Utwórz wydarzenie"
        >
          <CalendarPlus size={13} strokeWidth={2.25} className="shrink-0" />
          Wydarzenie
        </button>
      </div>
    </div>
  );
}
