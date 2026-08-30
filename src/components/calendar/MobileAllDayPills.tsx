import { useMemo } from "react";
import { isSameDay } from "date-fns";
import type { Group, Item } from "@/types";
import { fmt, tint } from "@/lib/format";
import {
  allDayCalendarDate,
  allDayLastCalendarDate,
  itemCoversCalendarDay,
} from "@/lib/allDay";
import { isBandItem, layoutBandItems } from "@/lib/allDayBars";
import { itemVisual } from "@/lib/itemVisual";
import { dayColumnLayout, spanColumnLayout, weekendColumnBg } from "@/lib/weekend";
import { ReminderBell } from "@/components/calendar/ReminderBell";
import { DeadlineClock } from "@/components/calendar/DeadlineClock";

const BAR_H = 22;
const BAR_GAP = 4;

/** Pigułki wielodniowe aktywne w danym tygodniu (widok tygodnia). */
export function MobileWeekBandPills({
  weekDays,
  items,
  groups,
  onOpen,
}: {
  weekDays: Date[];
  items: Item[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
}) {
  const pills = useMemo(() => {
    if (!weekDays.length) return [];
    const rangeStart = weekDays[0].getTime();
    const rangeEnd = weekDays[weekDays.length - 1].getTime() + 86400000;
    return items
      .filter((it) => isBandItem(it))
      .filter((it) => {
        const s = it.allDay
          ? allDayCalendarDate(it.start).getTime()
          : new Date(it.start).getTime();
        const e = it.allDay
          ? allDayLastCalendarDate(it.end).getTime() + 86400000
          : new Date(it.end).getTime();
        return e > rangeStart && s < rangeEnd;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [weekDays, items]);

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-b border-line bg-surface px-3 py-2">
      {pills.map((item) => {
        const vis = itemVisual(item, groups);
        const start = item.allDay ? allDayCalendarDate(item.start) : new Date(item.start);
        const last = item.allDay
          ? allDayLastCalendarDate(item.end)
          : new Date(new Date(item.end).getTime() - 1);
        const rangeLabel =
          fmt(start, "d MMM") === fmt(last, "d MMM")
            ? "Cały dzień"
            : `${fmt(start, "d MMM")} – ${fmt(last, "d MMM")}`;
        return (
          <button
            key={item.id}
            type="button"
            data-no-swipe
            onClick={() => onOpen(item.id)}
            className="flex w-full max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-[11px] font-semibold text-ink"
            style={{
              background: tint(vis.color, 0.28),
              boxShadow: `inset 3px 0 0 ${vis.color}`,
              opacity: vis.opacity,
            }}
          >
            <span className="min-w-0 flex-1 truncate">{item.title || "(bez tytułu)"}</span>
            <span className="shrink-0 text-[10px] font-medium text-ink-light">· {rangeLabel}</span>
            <ReminderBell item={item} size={9} />
          </button>
        );
      })}
    </div>
  );
}

/** Paski wielodniowe na siatce kolumn (desktop / legacy). */
export function MobileWeekAllDayBand({
  weekDays,
  items,
  groups,
  onOpen,
}: {
  weekDays: Date[];
  items: Item[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
}) {
  const placed = useMemo(() => layoutBandItems(weekDays, items), [weekDays, items]);
  const layout = useMemo(() => dayColumnLayout(weekDays, { equal: true }), [weekDays]);
  if (placed.length === 0) return null;
  const rowCount = placed.reduce((m, b) => Math.max(m, b.row + 1), 0);

  return (
    <div className="border-b border-line bg-surface px-1 py-1.5">
      <div className="relative" style={{ height: rowCount * (BAR_H + BAR_GAP) - BAR_GAP }}>
        {weekDays.map((day, i) => (
          <div
            key={i}
            className="pointer-events-none absolute top-0 bottom-0"
            style={{
              left: `${layout[i].leftPct}%`,
              width: `${layout[i].widthPct}%`,
              backgroundColor: weekendColumnBg(day),
            }}
          />
        ))}
        {placed.map((bar) => {
          const vis = itemVisual(bar.item, groups);
          const span = spanColumnLayout(layout, bar.startIdx, bar.endIdx);
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
              onClick={() => onOpen(bar.item.id)}
              className="absolute flex items-center gap-0.5 overflow-hidden px-2 text-left text-[11px] font-semibold text-ink"
              style={{
                left: `calc(${span.leftPct}% + ${bar.continuesLeft ? 0 : 2}px)`,
                width: `calc(${span.widthPct}% - ${bar.continuesLeft || bar.continuesRight ? 2 : 4}px)`,
                top: bar.row * (BAR_H + BAR_GAP),
                height: BAR_H,
                borderRadius: radius,
                background: tint(vis.color, 0.28),
                boxShadow: `inset 3px 0 0 ${vis.color}`,
                opacity: vis.opacity,
              }}
            >
              <span className="min-w-0 truncate">{bar.item.title || "(bez tytułu)"}</span>
              <ReminderBell item={bar.item} size={9} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Lista pigułek wielodniowych/całodniowych aktywnych w danym dniu. */
export function MobileDayAllDayPills({
  day,
  items,
  groups,
  onOpen,
}: {
  day: Date;
  items: Item[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
}) {
  const pills = useMemo(
    () =>
      items
        .filter((it) => isBandItem(it) && itemCoversCalendarDay(it, day))
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [items, day],
  );

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line bg-surface px-3 py-2">
      {pills.map((item) => {
        const vis = itemVisual(item, groups);
        const start = item.allDay ? allDayCalendarDate(item.start) : new Date(item.start);
        const last = item.allDay
          ? allDayLastCalendarDate(item.end)
          : new Date(new Date(item.end).getTime() - 1);
        const same = isSameDay(start, last);
        const rangeLabel = same
          ? "Cały dzień"
          : `${fmt(start, "d MMM")} – ${fmt(last, "d MMM")}`;
        return (
          <button
            key={item.id}
            type="button"
            data-no-swipe
            onClick={() => onOpen(item.id)}
            className="flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-left text-[11px] font-semibold text-ink"
            style={{
              background: tint(vis.color, 0.28),
              boxShadow: `inset 3px 0 0 ${vis.color}`,
              opacity: vis.opacity,
            }}
          >
            <span className="min-w-0 truncate">{item.title || "(bez tytułu)"}</span>
            <span className="shrink-0 text-[10px] font-medium text-ink-light">{rangeLabel}</span>
            <ReminderBell item={item} size={9} />
            <DeadlineClock item={item} day={day} size={9} />
          </button>
        );
      })}
    </div>
  );
}
