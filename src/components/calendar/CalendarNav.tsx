import { addDays, addMonths, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { useSchedulesAvailable } from "@/hooks/useScheduleRepo";
import {
  useBoardsAvailable,
  useBoardsUnreadTotal,
  useEffectiveMainAreaMode,
} from "@/hooks/useBoards";
import { BoardChips } from "@/components/boards/BoardChips";
import { leaveBoardsRoute, navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import type { CalendarViewKind, MainAreaMode } from "@/types";
import { getViewLabel } from "@/lib/viewLabel";
import { getViewDays } from "@/lib/time";
import { isValidDate } from "@/lib/dates";
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

function isSchedulesMode(mode: MainAreaMode): boolean {
  return mode === "projects" || mode === "attendance";
}

const chipClass = (active: boolean) =>
  `rounded px-2 py-0.5 text-xs transition ${
    active ? "bg-accent text-white shadow-glow" : "text-ink-light hover:text-ink"
  }`;

function navAnchor(iso: string): Date {
  const d = new Date(iso);
  return startOfDay(isValidDate(d) ? d : new Date());
}

/** Pasek nawigacji kalendarza (desktop) — nad siatką / przeglądem. */
export function CalendarNav() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const schedulesAvailable = useSchedulesAvailable();
  const boardsAvailable = useBoardsAvailable();
  const mainAreaMode = useEffectiveMainAreaMode();
  const boardsUnread = useBoardsUnreadTotal();
  const anchor = navAnchor(settings.anchorDate);
  const isAttendance = mainAreaMode === "attendance";
  const isCalendar = mainAreaMode === "calendar";
  const isBoards = mainAreaMode === "boards";
  const isSchedules = isSchedulesMode(mainAreaMode);
  const showCalendarChrome = isCalendar;

  const enterBoards = () => {
    if (isSchedules) restoreHubLayoutAfterSchedules();
    setSettings({ mainAreaMode: "boards" });
    navigateToBoards({ boardId: useBoardsStore.getState().activeBoardId ?? undefined });
  };

  const enterSchedules = (mode: "projects" | "attendance") => {
    leaveBoardsRoute();
    if (!isSchedules) {
      const s = useChatStore.getState();
      hubLayoutBeforeSchedules = {
        hubExpanded: s.hubExpanded,
        hubCollapsed: s.hubCollapsed,
      };
    }
    setSettings({ mainAreaMode: mode });
    // Tylko przy kliknięciu w nav: hub z powiększonego → normalny (nie do paska).
    useChatStore.setState({ hubExpanded: false, hubCollapsed: false });
  };

  const leaveSchedulesTo = (patch: Parameters<typeof setSettings>[0]) => {
    leaveBoardsRoute();
    setSettings(patch);
    if (isSchedules) restoreHubLayoutAfterSchedules();
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
    <div className="shrink-0 border-b border-line">
      {/* Rząd 1: chrome daty + tryby główne (zawsze w jednym wierszu jak w Przeglądzie). */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
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

            <div className="min-w-0 flex-1 truncate text-xs font-medium capitalize text-ink">
              {getViewLabel(settings.view, anchor, settings.nineDayStartWeekday)}
            </div>
          </>
        )}

        {isSchedules && (
          <div className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
            {isAttendance ? "Obecności" : "Harmonogramy"}
          </div>
        )}

        {isBoards && (
          <div className="min-w-0 flex-1 truncate text-xs font-medium text-ink">Tablice</div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-surface-raised p-0.5">
          <button
            type="button"
            onClick={() =>
              leaveSchedulesTo({
                mainAreaMode: "calendar",
                // Każde kliknięcie Kalendarz → aktualna data (Dzień/Tydzień/11 dni/Miesiąc bez zmian).
                anchorDate: startOfDay(new Date()).toISOString(),
              })
            }
            className={chipClass(isCalendar)}
          >
            Kalendarz
          </button>
          {boardsAvailable ? (
            <button
              type="button"
              onClick={enterBoards}
              className={`${chipClass(isBoards)} flex items-center gap-1`}
              aria-label="Tablice"
              title="Tablice"
            >
              Tablice
              {boardsUnread > 0 && (
                <span
                  className={`flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ${
                    isBoards ? "bg-white/25 text-white" : "bg-accent text-white"
                  }`}
                >
                  {boardsUnread > 99 ? "99+" : boardsUnread}
                </span>
              )}
            </button>
          ) : null}
          {schedulesAvailable ? (
            <button
              type="button"
              onClick={() => enterSchedules("attendance")}
              className={chipClass(isSchedules)}
              aria-label="Obecności"
              title="Obecności (Harmonogramy wewnątrz)"
            >
              Obecności
            </button>
          ) : null}
        </div>
      </div>

      {/* Rząd 2 (Tablice): nazwy tablic w miejscu przełącznika widoków kalendarza. */}
      {isBoards ? (
        <div className="px-2 pb-1.5">
          <BoardChips />
        </div>
      ) : null}

      {/* Rząd 2: widoki kalendarza — tylko w trybie Kalendarz, nie wypycha menu trybów. */}
      {isCalendar ? (
        <div className="flex items-center justify-end px-2 pb-1.5">
          <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-raised p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setSettings({ view: v.key })}
                className={chipClass(settings.view === v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
