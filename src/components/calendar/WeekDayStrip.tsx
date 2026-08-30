import { isSameDay, startOfDay } from "date-fns";
import { fmt } from "@/lib/format";

/** Kompaktowy pasek Pn–Nd z zaznaczeniem dnia i oznaczeniem „dziś”. */
export function WeekDayStrip({
  days,
  selectedDay,
  onSelectDay,
}: {
  days: Date[];
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
}) {
  const today = startOfDay(new Date());

  return (
    <div className="flex border-b border-line bg-surface px-1 py-1.5">
      {days.map((day) => {
        const isToday = isSameDay(day, today);
        const isSelected = isSameDay(day, selectedDay);
        return (
          <button
            key={day.toISOString()}
            type="button"
            data-no-swipe
            onClick={() => onSelectDay(day)}
            aria-pressed={isSelected}
            aria-current={isToday ? "date" : undefined}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition ${
              isSelected
                ? "border border-accent bg-accent/12 shadow-sm"
                : "border border-transparent hover:bg-surface-overlay"
            }`}
          >
            <span
              className={`text-[10px] font-medium uppercase tracking-wide ${
                isSelected ? "text-accent" : "text-ink-faint"
              }`}
            >
              {fmt(day, "EEEEEE")}
            </span>
            <span
              className={`flex h-7 w-7 items-center justify-center text-sm font-semibold tabular-nums ${
                isToday
                  ? "rounded-full bg-accent text-white shadow-glow"
                  : isSelected
                    ? "rounded-md ring-1 ring-inset ring-accent text-ink"
                    : "rounded-full text-ink"
              }`}
            >
              {fmt(day, "d")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
