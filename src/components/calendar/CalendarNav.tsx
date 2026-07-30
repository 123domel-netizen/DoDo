import { addDays, addMonths, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { useSchedulesAvailable } from "@/hooks/useScheduleRepo";
import type { CalendarViewKind } from "@/types";
import { getViewLabel } from "@/lib/viewLabel";
import { getViewDays } from "@/lib/time";
import { fmt } from "@/lib/format";

const VIEWS: { key: CalendarViewKind; label: string }[] = [
  { key: "day", label: "Dzień" },
  { key: "week", label: "Tydzień" },
  { key: "eleven", label: "11 dni" },
  { key: "month", label: "Miesiąc" },
];

/** Wysokość huba sprzed wejścia w Harmonogramy (powiększony / normalny / zwinięty). */
let hubLayoutBeforeSchedules: {
  hubExpanded: boolean;
  hubCollapsed: boolean;
} | null = null;

function restoreHubLayoutAfterSchedules() {
  const saved = hubLayoutBeforeSchedules;
  if (!saved) return;
  hubLayoutBeforeSchedules = null;
  useChatStore.setState({
    hubExpanded: saved.hubExpanded,
    hubCollapsed: saved.hubCollapsed,
  });
}

/** Pasek nawigacji kalendarza (desktop) — nad siatką / przeglądem. */
export function CalendarNav() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const schedulesAvailable = useSchedulesAvailable();
  const anchor = new Date(settings.anchorDate);
  const isDashboard = settings.mainAreaMode === "dashboard";
  const isProjects = settings.mainAreaMode === "projects";
  const showCalendarChrome = !isDashboard && !isProjects;

  const openSchedules = () => {
    if (!isProjects) {
      const s = useChatStore.getState();
      hubLayoutBeforeSchedules = {
        hubExpanded: s.hubExpanded,
        hubCollapsed: s.hubCollapsed,
      };
    }
    setSettings({ mainAreaMode: "projects" });
    // Tylko przy kliknięciu w nav: hub z powiększonego → normalny (nie do paska).
    useChatStore.setState({ hubExpanded: false, hubCollapsed: false });
  };

  const leaveSchedulesTo = (patch: Parameters<typeof setSettings>[0]) => {
    setSettings(patch);
    if (isProjects) restoreHubLayoutAfterSchedules();
  };

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
      {showCalendarChrome && (
        <>
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
        </>
      )}

      {isDashboard && (
        <div className="min-w-0 flex-1 truncate text-xs font-medium capitalize text-ink">
          {fmt(new Date(), "EEEE, d MMMM")}
        </div>
      )}

      {isProjects && (
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          Harmonogramy
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5 rounded-md border border-line bg-surface-raised p-0.5">
        <button
          type="button"
          onClick={() => leaveSchedulesTo({ mainAreaMode: "dashboard" })}
          className={`rounded px-2 py-0.5 text-xs transition ${
            isDashboard
              ? "bg-accent text-white shadow-glow"
              : "text-ink-light hover:text-ink"
          }`}
        >
          Przegląd
        </button>
        {schedulesAvailable ? (
          <button
            type="button"
            onClick={openSchedules}
            className={`rounded px-2 py-0.5 text-xs transition ${
              settings.mainAreaMode === "projects"
                ? "bg-accent text-white shadow-glow"
                : "text-ink-light hover:text-ink"
            }`}
            aria-label="Harmonogramy"
            title="Harmonogramy"
          >
            Harmonogramy
          </button>
        ) : null}
        <span className="mx-0.5 h-3 w-px bg-line" aria-hidden />
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() =>
              leaveSchedulesTo({ mainAreaMode: "calendar", view: v.key })
            }
            className={`rounded px-2 py-0.5 text-xs transition ${
              !isDashboard &&
              settings.mainAreaMode !== "projects" &&
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
