import { useMemo } from "react";
import { isSameDay, isSameMonth, startOfDay } from "date-fns";
import type { Group, Item } from "@/types";
import { useStore } from "@/state/store";
import { fmt, tint } from "@/lib/format";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { dayColumnLayout, spanColumnLayout, weekendColumnBg } from "@/lib/weekend";
import { isBandItem, layoutBandItems } from "@/lib/allDayBars";
import { itemVisual } from "@/lib/itemVisual";
import type { ReminderMarker } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";
import { DayAgenda, type AgendaEntry } from "@/components/calendar/DayAgenda";

const DATE_H = 22;
const BAR_H = 11;
const BAR_GAP = 1;
const DOTS_H = 8;
const MAX_BAR_ROWS = 3;

interface MobileMonthViewProps {
  days: Date[];
  items: Item[];
  reminderMarkers: ReminderMarker[];
  deadlineMarkers: DeadlineMarker[];
  groups: Record<string, Group>;
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  onViewDay?: (day: Date) => void;
  onAddEvent?: (day: Date) => void;
}

export function MobileMonthView({
  days,
  items,
  reminderMarkers,
  deadlineMarkers,
  groups,
  selectedDay,
  onSelectDay,
  onViewDay,
  onAddEvent,
}: MobileMonthViewProps) {
  const setEditing = useStore((s) => s.setEditing);
  const anchor = new Date(useStore((s) => s.settings.anchorDate));
  const today = startOfDay(new Date());

  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const weekBars = useMemo(
    () => weeks.map((week) => layoutBandItems(week, items)),
    [weeks, items],
  );

  const bandIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) if (isBandItem(it)) ids.add(it.id);
    return ids;
  }, [items]);

  const dotsByDay = useMemo(() => {
    const map = new Map<
      number,
      { markers: { color: string; task: boolean }[]; deadline: boolean }
    >();
    for (const day of days) {
      const key = startOfDay(day).getTime();
      const markers: { color: string; task: boolean }[] = [];
      for (const it of items) {
        if (bandIds.has(it.id) || !itemCoversCalendarDay(it, day)) continue;
        if (markers.length >= 3) break;
        markers.push({ color: itemVisual(it, groups).color, task: it.type === "task" });
      }
      const deadline = deadlineMarkers.some((m) => isSameDay(m.at, day));
      map.set(key, { markers, deadline });
    }
    return map;
  }, [days, items, bandIds, deadlineMarkers, groups]);

  const agendaEntries = useMemo((): AgendaEntry[] => {
    const dayItems = items
      .filter((it) => itemCoversCalendarDay(it, selectedDay))
      .map((it) => ({ kind: "item" as const, at: new Date(it.start), item: it }));
    const dayReminders = reminderMarkers
      .filter((m) => isSameDay(m.at, selectedDay))
      .map((m) => ({ kind: "reminder" as const, at: m.at, marker: m }));
    const dayDeadlines = deadlineMarkers
      .filter((m) => isSameDay(m.at, selectedDay))
      .map((m) => ({ kind: "deadline" as const, at: m.at, marker: m }));
    return [...dayItems, ...dayReminders, ...dayDeadlines].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
  }, [items, reminderMarkers, deadlineMarkers, selectedDay]);

  const weekdayLabels = days.slice(0, 7);
  const equalLayout = dayColumnLayout(weekdayLabels, { equal: true });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-line">
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {weekdayLabels.map((d, i) => (
            <div
              key={i}
              className="px-0.5 py-1 text-center text-[10px] font-medium uppercase tracking-wide text-ink-faint"
            >
              {fmt(d, "EEE").replace(/\./g, "").toUpperCase()}
            </div>
          ))}
        </div>

        <div className="flex flex-col">
          {weeks.map((week, wi) => {
            const bars = weekBars[wi] ?? [];
            const barRows = Math.min(
              MAX_BAR_ROWS,
              bars.reduce((m, b) => Math.max(m, b.row + 1), 0),
            );
            const barsH = barRows > 0 ? barRows * (BAR_H + BAR_GAP) + 2 : 2;
            const weekH = DATE_H + barsH + DOTS_H;

            return (
              <div key={wi} className="relative" style={{ height: weekH }}>
                <div
                  className="grid h-full"
                  style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
                >
                  {week.map((day, di) => {
                    const inMonth = isSameMonth(day, anchor);
                    const isToday = isSameDay(day, today);
                    const isSelected = isSameDay(day, selectedDay);
                    const weekendBg = weekendColumnBg(day);
                    const key = startOfDay(day).getTime();
                    const dots = dotsByDay.get(key);
                    return (
                      <button
                        key={di}
                        type="button"
                        onClick={() => onSelectDay(day)}
                        className={`relative flex min-w-0 flex-col items-center px-0.5 pt-0.5 transition ${
                          isSelected ? "bg-accent/10" : ""
                        }`}
                        style={
                          !isSelected && weekendBg ? { backgroundColor: weekendBg } : undefined
                        }
                        aria-current={isToday ? "date" : undefined}
                        aria-pressed={isSelected}
                      >
                        {isSelected && (
                          <span
                            className="pointer-events-none absolute inset-0.5 rounded-md ring-1 ring-inset ring-accent/80"
                            aria-hidden
                          />
                        )}
                        <span
                          className={`relative z-[1] flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium tabular-nums ${
                            isToday
                              ? "bg-accent text-white shadow-glow"
                              : inMonth
                                ? "text-ink"
                                : "text-ink-faint"
                          }`}
                        >
                          {fmt(day, "d")}
                        </span>
                        <span className="mt-auto mb-0.5 flex h-2 items-center justify-center gap-0.5">
                          {dots?.markers.map((m, i) => (
                            <span
                              key={i}
                              className={m.task ? "h-1 w-1 rounded-sm" : "h-1 w-1 rounded-full"}
                              style={{ background: m.color }}
                              aria-hidden
                            />
                          ))}
                          {dots?.deadline && (
                            <span className="h-1 w-1 rounded-full bg-red-500" aria-hidden />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {barRows > 0 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[2]"
                    style={{ top: DATE_H, height: barsH }}
                  >
                    {bars
                      .filter((b) => b.row < MAX_BAR_ROWS)
                      .map((bar) => {
                        const vis = itemVisual(bar.item, groups);
                        const span = spanColumnLayout(equalLayout, bar.startIdx, bar.endIdx);
                        const wide = bar.endIdx - bar.startIdx >= 1;
                        const radius = [
                          bar.continuesLeft ? 0 : 999,
                          bar.continuesRight ? 0 : 999,
                          bar.continuesRight ? 0 : 999,
                          bar.continuesLeft ? 0 : 999,
                        ]
                          .map((n) => `${n}px`)
                          .join(" ");
                        return (
                          <button
                            key={bar.item.id}
                            type="button"
                            data-no-swipe
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(bar.item.id);
                            }}
                            title={bar.item.title || "Wydarzenie"}
                            className="pointer-events-auto absolute overflow-hidden px-1 text-left text-[9px] font-semibold leading-[11px] text-ink"
                            style={{
                              left: `calc(${span.leftPct}% + 2px)`,
                              width: `calc(${span.widthPct}% - 4px)`,
                              top: bar.row * (BAR_H + BAR_GAP),
                              height: BAR_H,
                              borderRadius: radius,
                              background: tint(vis.color, 0.28),
                              boxShadow: `inset 2px 0 0 ${vis.color}`,
                              opacity: vis.opacity,
                            }}
                          >
                            {wide || !bar.continuesLeft ? (
                              <span className="block truncate">
                                {bar.item.title || "(bez tytułu)"}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DayAgenda
        day={selectedDay}
        entries={agendaEntries}
        groups={groups}
        onOpen={setEditing}
        onViewDay={onViewDay}
        onAdd={onAddEvent}
      />
    </div>
  );
}
