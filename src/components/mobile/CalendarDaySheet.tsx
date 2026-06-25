import { X } from "lucide-react";
import { fmt } from "@/lib/format";

export function CalendarDaySheet({
  day,
  onClose,
  onViewDay,
  onAddEvent,
}: {
  day: Date;
  onClose: () => void;
  onViewDay: () => void;
  onAddEvent: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div
        className="relative rounded-t-2xl border-t border-line bg-surface-overlay p-4 shadow-pop"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
        <div className="mb-4 flex items-center gap-2">
          <h2 className="flex-1 text-base font-semibold capitalize text-ink">
            {fmt(day, "EEE d MMM")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onViewDay}
            className="w-full rounded-xl border border-line bg-surface-raised px-4 py-3 text-left text-sm font-medium text-ink transition hover:border-line-strong hover:bg-surface-overlay"
          >
            Zobacz dzień
          </button>
          <button
            type="button"
            onClick={onAddEvent}
            className="w-full rounded-xl bg-accent-grad px-4 py-3 text-left text-sm font-semibold text-white shadow-glow transition hover:brightness-110"
          >
            Dodaj wydarzenie
          </button>
        </div>
      </div>
    </div>
  );
}
