import { addDays, addMonths, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "@/state/store";
import type { CalendarViewKind } from "@/types";
import { getViewLabel } from "@/lib/viewLabel";
import { getViewDays } from "@/lib/time";

const VIEWS: { key: CalendarViewKind; label: string }[] = [
  { key: "day", label: "Dzień" },
  { key: "week", label: "Tydzień" },
  { key: "eleven", label: "11 dni" },
  { key: "month", label: "Miesiąc" },
];

/** Pasek nawigacji kalendarza (desktop) — nad siatką. */
export function CalendarNav() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const anchor = new Date(settings.anchorDate);

  const shift = (dir: number) => {
    if (settings.view === "month") {
      setSettings({ anchorDate: startOfDay(addMonths(anchor, dir)).toISOString() });
      return;
    }
    if (settings.view === "day") {
      setSettings({ anchorDate: startOfDay(addDays(anchor, dir)).toISOString() });
      return;
    }
    if (settings.view === "eleven") {
      const days = getViewDays("eleven", anchor, settings.nineDayStartWeekday);
      const next = addDays(days[0], dir * 7);
      setSettings({ anchorDate: startOfDay(next).toISOString() });
      return;
    }
    setSettings({ anchorDate: startOfDay(addDays(anchor, dir * 7)).toISOString() });
  };

  const goToday = () => setSettings({ anchorDate: startOfDay(new Date()).toISOString() });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
      <button
        type="button"
        onClick={goToday}
        className="rounded-md border border-line bg-surface-raised px-2 py-0.5 text-xs text-ink transition hover:border-line-strong"
      >
        Dziś
      </button>

      <div className="flex items-center">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="rounded-md p-0.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Poprzedni"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="rounded-md p-0.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Następny"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="min-w-0 flex-1 truncate text-xs font-medium capitalize text-ink sm:min-w-[140px] sm:flex-none">
        {getViewLabel(settings.view, anchor, settings.nineDayStartWeekday)}
      </div>

      <div className="ml-auto flex items-center gap-0.5 rounded-md border border-line bg-surface-raised p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setSettings({ view: v.key })}
            className={`rounded px-2 py-0.5 text-xs transition ${
              settings.view === v.key
                ? "bg-accent text-white shadow-glow"
                : "text-ink-light hover:text-ink"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
