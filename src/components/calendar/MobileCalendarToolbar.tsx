import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  getMobileCalendarNavLabel,
  type MobileCalendarMode,
} from "@/lib/viewLabel";

export function MobileCalendarToolbar({
  view,
  anchor,
  nineDayStartWeekday,
  onToday,
  onShift,
  onAddEvent,
}: {
  view: MobileCalendarMode;
  anchor: Date;
  nineDayStartWeekday: number;
  onToday: () => void;
  onShift: (dir: number) => void;
  onAddEvent: () => void;
}) {
  const label = getMobileCalendarNavLabel(view, anchor, nineDayStartWeekday);
  const showRangeNav = view !== "today";

  return (
    <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
      <button
        type="button"
        onClick={onToday}
        className="flex h-10 shrink-0 items-center rounded-lg border border-line/70 bg-surface-raised/50 px-3 text-xs font-semibold text-accent transition hover:border-accent/40 hover:bg-accent/10 active:bg-accent/15"
      >
        Dziś
      </button>

      <div className="flex min-h-10 min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-line/50 bg-surface-raised/30">
        {showRangeNav ? (
          <button
            type="button"
            onClick={() => onShift(-1)}
            className="flex w-11 shrink-0 items-center justify-center text-ink-faint transition active:bg-surface-overlay hover:bg-surface-overlay hover:text-ink"
            aria-label="Poprzedni"
          >
            <ChevronLeft size={20} strokeWidth={2.25} />
          </button>
        ) : (
          <span className="w-11 shrink-0" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 items-center justify-center truncate px-1 text-center text-[13px] font-semibold capitalize tracking-tight text-ink">
          {label}
        </span>
        {showRangeNav ? (
          <button
            type="button"
            onClick={() => onShift(1)}
            className="flex w-11 shrink-0 items-center justify-center text-ink-faint transition active:bg-surface-overlay hover:bg-surface-overlay hover:text-ink"
            aria-label="Następny"
          >
            <ChevronRight size={20} strokeWidth={2.25} />
          </button>
        ) : (
          <span className="w-11 shrink-0" aria-hidden />
        )}
      </div>

      <button
        type="button"
        onClick={onAddEvent}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-grad text-white shadow-glow transition hover:brightness-110 active:brightness-95"
        aria-label="Dodaj wydarzenie"
        title="Dodaj wydarzenie"
      >
        <Plus size={18} strokeWidth={2.25} />
      </button>
    </div>
  );
}
