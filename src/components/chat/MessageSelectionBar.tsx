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

/** Pasek akcji zbiorczych nad composerem przy zaznaczonych wiadomościach. */
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
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line/80 bg-surface px-3 text-[12px] font-medium text-ink shadow-sm transition hover:border-accent/50 hover:bg-accent/10 hover:text-accent disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-accent/25 bg-gradient-to-r from-accent/10 via-surface-raised/90 to-surface-raised/90 px-2.5 py-2">
      <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-accent/20 px-2.5 text-[11px] font-semibold tabular-nums text-accent">
        {countLabel(count)}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          disabled={busy}
          onClick={onForward}
          className={action}
          title="Przekaż do innej rozmowy"
        >
          <Forward size={13} strokeWidth={2.25} />
          Przekaż
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCopy}
          className={action}
          title="Skopiuj treść (kolejność wg daty)"
        >
          <Copy size={13} strokeWidth={2.25} />
          Skopiuj
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateTask}
          className={action}
          title="Utwórz zadanie (2× zaznaczenie = wiele punktów)"
        >
          <CheckSquare size={13} strokeWidth={2.25} />
          Zadanie
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateEvent}
          className={action}
          title="Utwórz wydarzenie (2× zaznaczenie = wiele punktów)"
        >
          <CalendarPlus size={13} strokeWidth={2.25} />
          Wydarzenie
        </button>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onClear}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-ink/10 hover:text-ink disabled:opacity-40"
        aria-label="Anuluj zaznaczenie"
        title="Anuluj"
      >
        <X size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}
