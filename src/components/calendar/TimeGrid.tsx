import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type MouseEvent as RMouseEvent,
  type ReactNode,
} from "react";
import { addDays, isSameDay, startOfDay } from "date-fns";
import type { Group, Item } from "@/types";
import { useStore } from "@/state/store";
import {
  layoutTimed,
  placementForDay,
  setMinutesOfDay,
  timedGeometry,
  yToMinutes,
  range,
} from "@/lib/time";
import { fmt, fmtRange, fmtTime, tint } from "@/lib/format";
import { isBandItem, layoutBandItems } from "@/lib/allDayBars";
import { itemVisual } from "@/lib/itemVisual";
import { weekendColumnBg, dayColumnWeight, dayColumnLayout, dayIndexAtX, spanColumnLayout } from "@/lib/weekend";
import { groupIdForNewItem } from "@/lib/groups";
import type { ReminderMarker } from "@/lib/reminders";
import { markerAsTimedSlice } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";
import { deadlineMarkerSlice } from "@/lib/deadlines";
import { isOccurrenceId } from "@/lib/itemId";
import { ReminderBell } from "@/components/calendar/ReminderBell";
import { ReminderMarkers } from "@/components/calendar/ReminderMarkers";
import { DeadlineClock } from "@/components/calendar/DeadlineClock";
import { DeadlineMarkers } from "@/components/calendar/DeadlineMarkers";
import { ContextMenu, type MenuAction } from "./ContextMenu";

/** Aktualny czas — odświeżany co 30 s i przy powrocie do karty. */
function useCalendarNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return now;
}

interface TimeGridProps {
  days: Date[];
  items: Item[];
  reminderMarkers: ReminderMarker[];
  deadlineMarkers: DeadlineMarker[];
  groups: Record<string, Group>;
  isMobile?: boolean;
  selectedDay?: Date;
  onSelectDay?: (day: Date) => void;
  onDayHeaderTap?: (day: Date) => void;
  onSlotTap?: (day: Date, minutes: number) => void;
  /** Stała wysokość godziny + przewinięcie do teraz (tydzień mobile). */
  scrollToNow?: boolean;
  equalColumns?: boolean;
  /** Ukryj wiersz nagłówków dni (gdy chrome jest poza TimeGrid). */
  hideDayHeader?: boolean;
  /** Ukryj pas all-day (gdy paski są poza TimeGrid). */
  hideAllDayBand?: boolean;
  /** Kompaktowe bloki w siatce tygodnia (mobile week planner). */
  compactBlocks?: boolean;
  /** Extra content below the timed grid, inside the same scroll container. */
  footer?: ReactNode;
}

interface Override {
  id: string;
  start: Date;
  end: Date;
}

type DragMode = "move" | "resize-start" | "resize-end" | "create";

interface DragState {
  mode: DragMode;
  itemId?: string;
  grabOffsetMin: number;
  durationMin: number;
  startDayIndex: number;
  origStart: Date;
  origEnd: Date;
  createDayIndex: number;
  createFromMin: number;
  moved: boolean;
}

export function TimeGrid({
  days,
  items,
  reminderMarkers,
  deadlineMarkers,
  groups,
  isMobile,
  selectedDay,
  onSelectDay,
  onDayHeaderTap,
  onSlotTap,
  scrollToNow,
  equalColumns,
  hideDayHeader,
  hideAllDayBand,
  compactBlocks,
  footer,
}: TimeGridProps) {
  const settings = useStore((s) => s.settings);
  const { dayStartHour, dayEndHour } = settings;
  const hourHeightAuto = !scrollToNow && settings.hourHeightAuto !== false;
  const [autoHourHeight, setAutoHourHeight] = useState(settings.hourHeight);
  const hourHeight = hourHeightAuto
    ? autoHourHeight
    : scrollToNow
      ? Math.max(compactBlocks ? 36 : 48, settings.hourHeight)
      : settings.hourHeight;
  const gutter = isMobile ? 40 : 56;
  const patchItem = useStore((s) => s.patchItem);
  const setEditing = useStore((s) => s.setEditing);
  const startDraft = useStore((s) => s.startDraft);
  const copyToClipboard = useStore((s) => s.copyToClipboard);
  const duplicateItem = useStore((s) => s.duplicateItem);
  const deleteItem = useStore((s) => s.deleteItem);
  const pasteAt = useStore((s) => s.pasteAt);
  const clipboard = useStore((s) => s.clipboard);

  const gridRef = useRef<HTMLDivElement>(null);
  const timedRegionRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [override, setOverrideState] = useState<Override | null>(null);
  const [draft, setDraftState] = useState<{
    dayIndex: number;
    fromMin: number;
    toMin: number;
  } | null>(null);
  const overrideRef = useRef<Override | null>(null);
  const draftRef = useRef<{ dayIndex: number; fromMin: number; toMin: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const mobileTapRef = useRef<{
    x: number;
    y: number;
    dayIndex: number;
    minutes: number;
    active: boolean;
  } | null>(null);

  const TAP_MOVE_CANCEL = 12;

  const setOverride = (v: Override | null) => {
    overrideRef.current = v;
    setOverrideState(v);
  };
  const setDraft = (v: { dayIndex: number; fromMin: number; toMin: number } | null) => {
    draftRef.current = v;
    setDraftState(v);
  };
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    actions: MenuAction[];
  } | null>(null);

  const columnLayout = useMemo(
    () => dayColumnLayout(days, { equal: equalColumns }),
    [days, equalColumns],
  );
  const hourSpan = Math.max(1, dayEndHour - dayStartHour);
  const gridHeight = hourSpan * hourHeight;
  const now = useCalendarNow();

  const nowIndicator = useMemo(() => {
    const todayIndex = days.findIndex((d) => isSameDay(d, now));
    if (todayIndex < 0) return null;
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const startMin = dayStartHour * 60;
    const endMin = dayEndHour * 60;
    if (mins < startMin || mins > endMin) return null;
    return {
      topPx: ((mins - startMin) / 60) * hourHeight,
      dayIndex: todayIndex,
      label: fmt(now, "HH:mm"),
    };
  }, [days, now, dayStartHour, dayEndHour, hourHeight]);

  // Auto: dopasuj px/h do wysokości panelu kalendarza (do hubu).
  useLayoutEffect(() => {
    if (!hourHeightAuto) return;
    const el = timedRegionRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.clientHeight;
      if (h < 40) return;
      const next = Math.max(28, Math.min(140, Math.floor(h / hourSpan)));
      setAutoHourHeight((prev) => (prev === next ? prev : next));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hourHeightAuto, hourSpan, days.length]);

  useEffect(() => {
    if (!hourHeightAuto) setAutoHourHeight(settings.hourHeight);
  }, [hourHeightAuto, settings.hourHeight]);

  const rangeKey = days[0]?.getTime() ?? 0;
  const viewingToday = useMemo(
    () => days.some((d) => isSameDay(d, new Date())),
    [days],
  );
  useLayoutEffect(() => {
    if (!scrollToNow) return;
    const el = scrollRef.current;
    if (!el) return;
    let tries = 0;
    let raf = 0;
    const apply = () => {
      // Tylko dla „dziś” scroll do aktualnej godziny; inne dni zostają u góry.
      const y = viewingToday
        ? (nowIndicator?.topPx ??
          Math.max(0, new Date().getHours() - dayStartHour) * hourHeight)
        : 0;
      if (el.clientHeight >= 40 && el.scrollHeight > el.clientHeight) {
        el.scrollTop = viewingToday ? Math.max(0, y - el.clientHeight * 0.28) : 0;
        return;
      }
      if (tries++ < 16) raf = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(raf);
    // Tylko przy otwarciu / zmianie dnia — nie przy tyknięciu zegara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToNow, hourHeight, dayStartHour, rangeKey, viewingToday]);

  // Split items into all-day/multi-day band vs per-day timed/before/after.
  const bandItems = useMemo(() => items.filter(isBandItem), [items]);
  const flowItems = useMemo(
    () => items.filter((it) => !bandItems.includes(it)),
    [items, bandItems],
  );

  function pointerInfo(clientX: number, clientY: number) {
    const rect = gridRef.current!.getBoundingClientRect();
    const relX = Math.max(0, Math.min(clientX - rect.left, rect.width - 1));
    const dayIndex = dayIndexAtX(relX / rect.width, columnLayout);
    const minutes = yToMinutes(clientY - rect.top, dayStartHour, hourHeight);
    return { dayIndex, minutes };
  }

  function beginDrag(e: RPointerEvent, mode: DragMode, item?: Item) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { dayIndex, minutes } = pointerInfo(e.clientX, e.clientY);
    if (item) {
      const origStart = new Date(item.start);
      const origEnd = new Date(item.end);
      const startMin = origStart.getHours() * 60 + origStart.getMinutes();
      dragRef.current = {
        mode,
        itemId: item.id,
        grabOffsetMin: minutes - startMin,
        durationMin: (origEnd.getTime() - origStart.getTime()) / 60000,
        startDayIndex: dayIndex,
        origStart,
        origEnd,
        createDayIndex: dayIndex,
        createFromMin: minutes,
        moved: false,
      };
    } else {
      dragRef.current = {
        mode: "create",
        grabOffsetMin: 0,
        durationMin: 60,
        startDayIndex: dayIndex,
        origStart: new Date(),
        origEnd: new Date(),
        createDayIndex: dayIndex,
        createFromMin: minutes,
        moved: false,
      };
      setDraft({ dayIndex, fromMin: minutes, toMin: minutes + 60 });
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { dayIndex, minutes } = pointerInfo(e.clientX, e.clientY);
    d.moved = true;

    if (d.mode === "create") {
      const from = Math.min(d.createFromMin, minutes);
      const to = Math.max(d.createFromMin, minutes);
      setDraft({ dayIndex: d.startDayIndex, fromMin: from, toMin: Math.max(to, from + 15) });
      return;
    }

    if (!d.itemId) return;
    const dayDelta = dayIndex - d.startDayIndex;

    if (d.mode === "move") {
      let newStartMin = minutes - d.grabOffsetMin;
      newStartMin = Math.round(newStartMin / 15) * 15;
      const baseDay = addDays(startOfDay(d.origStart), dayDelta);
      const newStart = setMinutesOfDay(baseDay, newStartMin);
      const newEnd = new Date(newStart.getTime() + d.durationMin * 60000);
      setOverride({ id: d.itemId, start: newStart, end: newEnd });
    } else if (d.mode === "resize-start") {
      let m = Math.round(minutes / 15) * 15;
      const endMin = d.origEnd.getHours() * 60 + d.origEnd.getMinutes();
      if (isSameDay(d.origStart, d.origEnd)) m = Math.min(m, endMin - 15);
      const newStart = setMinutesOfDay(d.origStart, m);
      setOverride({ id: d.itemId, start: newStart, end: d.origEnd });
    } else if (d.mode === "resize-end") {
      let m = Math.round(minutes / 15) * 15;
      const startMin = d.origStart.getHours() * 60 + d.origStart.getMinutes();
      if (isSameDay(d.origStart, d.origEnd)) m = Math.max(m, startMin + 15);
      const newEnd = setMinutesOfDay(d.origEnd, m);
      setOverride({ id: d.itemId, start: d.origStart, end: newEnd });
    }
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const d = dragRef.current;
    dragRef.current = null;

    if (d?.mode === "create") {
      const day = days[d.startDayIndex];
      const draftNow = draftRef.current;
      if (draftNow) {
        const start = setMinutesOfDay(day, draftNow.fromMin);
        const end = setMinutesOfDay(day, draftNow.toMin);
        startDraft({
          type: "event",
          start: start.toISOString(),
          end: end.toISOString(),
          groupId: groupIdForNewItem(),
        });
      }
      setDraft(null);
      return;
    }

    const ov = overrideRef.current;
    if (d?.itemId && ov && d.moved) {
      if (isOccurrenceId(d.itemId)) {
        setEditing(d.itemId);
      } else {
        patchItem(d.itemId, {
          start: ov.start.toISOString(),
          end: ov.end.toISOString(),
        });
      }
    } else if (d?.itemId && !d.moved) {
      setEditing(d.itemId);
    }
    setOverride(null);
  };

  function openGridMenu(e: RMouseEvent) {
    e.preventDefault();
    const { dayIndex, minutes } = pointerInfo(e.clientX, e.clientY);
    const day = days[dayIndex];
    const at = setMinutesOfDay(day, minutes);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        {
          label: "Dodaj wydarzenie",
          onClick: () => {
            const start = at;
            const end = new Date(start.getTime() + 60 * 60000);
            startDraft({
              type: "event",
              start: start.toISOString(),
              end: end.toISOString(),
              groupId: groupIdForNewItem(),
            });
          },
        },
        { label: "Kopiuj wydarzenie", onClick: () => {}, disabled: true },
        {
          label: "Wklej wydarzenie",
          onClick: () => {
            const item = pasteAt(at);
            if (item) setEditing(item.id);
          },
          disabled: !clipboard,
        },
      ],
    });
  }

  function openItemMenu(e: RMouseEvent, item: Item) {
    e.preventDefault();
    e.stopPropagation();
    const { minutes } = pointerInfo(e.clientX, e.clientY);
    const day = days[pointerInfo(e.clientX, e.clientY).dayIndex];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: "Edytuj", onClick: () => setEditing(item.id) },
        { label: "Kopiuj wydarzenie", onClick: () => copyToClipboard(item.id) },
        { label: "Duplikuj", onClick: () => duplicateItem(item.id) },
        {
          label: "Wklej wydarzenie",
          onClick: () => {
            const it = pasteAt(setMinutesOfDay(day, minutes));
            if (it) setEditing(it.id);
          },
          disabled: !clipboard,
        },
        { label: "Usuń", onClick: () => deleteItem(item.id), danger: true },
      ],
    });
  }

  function withOverride(item: Item): Item {
    if (override && override.id === item.id) {
      return { ...item, start: override.start.toISOString(), end: override.end.toISOString() };
    }
    return item;
  }

  function onGridPointerDown(e: RPointerEvent) {
    if (e.button !== 0) return;

    if (isMobile && onSlotTap) {
      const { dayIndex, minutes } = pointerInfo(e.clientX, e.clientY);
      mobileTapRef.current = { x: e.clientX, y: e.clientY, dayIndex, minutes, active: true };
      const onMove = (ev: PointerEvent) => {
        const t = mobileTapRef.current;
        if (!t?.active) return;
        const dx = Math.abs(ev.clientX - t.x);
        const dy = Math.abs(ev.clientY - t.y);
        if (dx > TAP_MOVE_CANCEL || dy > TAP_MOVE_CANCEL) t.active = false;
      };
      const onUp = () => {
        const t = mobileTapRef.current;
        mobileTapRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!t?.active) return;
        onSlotTap(days[t.dayIndex], t.minutes);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      return;
    }

    beginDrag(e, "create");
  }

  const hours = range(dayEndHour - dayStartHour + 1).map((i) => dayStartHour + i);
  const headerSelectable = days.length > 1 && Boolean(onSelectDay || onDayHeaderTap);

  return (
    <div className="flex h-full flex-col">
      {/* Day headers */}
      {!hideDayHeader && (
      <div className="flex border-b border-line bg-surface" style={{ paddingLeft: gutter }}>
        {days.map((day, i) => {
          const today = isSameDay(day, new Date());
          const selected = selectedDay ? isSameDay(day, selectedDay) : false;
          const weekendBg = weekendColumnBg(day);
          const headerContent = (
            <>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                {fmt(day, "EEEEEE")}
              </div>
              <div
                className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center text-sm font-medium ${
                  today
                    ? "rounded-full bg-accent text-white shadow-glow"
                    : selected
                      ? "rounded-md ring-1 ring-inset ring-accent text-ink"
                      : "rounded-full text-ink"
                }`}
              >
                {fmt(day, "d")}
              </div>
            </>
          );
          const headerStyle = {
            flex: equalColumns ? 1 : dayColumnWeight(day),
            backgroundColor: selected ? "rgb(var(--color-accent) / 0.1)" : weekendBg,
          };
          if (isMobile && headerSelectable) {
            return (
              <button
                key={i}
                type="button"
                data-no-swipe
                onClick={() => (onSelectDay ?? onDayHeaderTap)?.(day)}
                className="min-w-0 px-1 py-2 text-center transition hover:bg-surface-overlay"
                style={headerStyle}
                aria-pressed={selected}
              >
                {headerContent}
              </button>
            );
          }
          return (
            <div
              key={i}
              className="min-w-0 px-1 py-2 text-center"
              style={headerStyle}
            >
              {headerContent}
            </div>
          );
        })}
      </div>
      )}

      {/* All-day / multi-day band */}
      {!hideAllDayBand && (
      <AllDayBand
        days={days}
        items={bandItems}
        groups={groups}
        onOpen={(id) => setEditing(id)}
        gutter={gutter}
        equalColumns={equalColumns}
      />
      )}

      <div
        ref={scrollRef}
        className={
          hourHeightAuto
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "flex-1 overflow-y-auto thin-scrollbar"
        }
      >
        {/* Off-hours BEFORE band */}
        <OffHoursBand
          days={days}
          items={flowItems}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          kind="before"
          onOpen={(id) => setEditing(id)}
          gutter={gutter}
          equalColumns={equalColumns}
        />

        {/* Timed grid */}
        <div
          ref={timedRegionRef}
          className={hourHeightAuto ? "min-h-0 flex-1" : undefined}
          style={hourHeightAuto ? undefined : { height: gridHeight }}
        >
          <div className="relative flex" style={{ height: gridHeight }}>
          <div className="relative shrink-0" style={{ width: gutter }}>
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-faint"
                style={{ top: i * hourHeight }}
              >
                {i === 0 ? "" : isMobile ? String(h).padStart(2, "0") : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex-1"
            onPointerDown={onGridPointerDown}
            onContextMenu={openGridMenu}
          >
            {/* hour lines */}
            {hours.map((_, i) => (
              <div
                key={i}
                className="pointer-events-none absolute left-0 right-0 border-t border-line"
                style={{ top: i * hourHeight }}
              />
            ))}
            {scrollToNow &&
              hours.slice(0, -1).map((_, i) => (
                <div
                  key={`half-${i}`}
                  className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-line/50"
                  style={{ top: i * hourHeight + hourHeight / 2 }}
                />
              ))}
            {/* weekend + day column backgrounds */}
            {days.map((day, i) => {
              const selected = selectedDay ? isSameDay(day, selectedDay) : false;
              const bg = selected ? "rgb(var(--color-accent) / 0.06)" : weekendColumnBg(day);
              const col = columnLayout[i];
              return (
                <div
                  key={`bg-${i}`}
                  className="pointer-events-none absolute top-0 bottom-0 border-l border-line first:border-l-0"
                  style={{
                    left: `${col.leftPct}%`,
                    width: `${col.widthPct}%`,
                    backgroundColor: bg,
                  }}
                />
              );
            })}
            {days.map((_, i) => {
              const col = columnLayout[i];
              return (
                <div
                  key={`line-${i}`}
                  className="pointer-events-none absolute top-0 bottom-0 border-l border-line first:border-l-0"
                  style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                />
              );
            })}

            {/* draft preview */}
            {draft && (
              <div
                className="pointer-events-none absolute rounded-md border border-accent bg-accent/25"
                style={{
                  left: `${columnLayout[draft.dayIndex].leftPct}%`,
                  width: `${columnLayout[draft.dayIndex].widthPct}%`,
                  top: ((draft.fromMin - dayStartHour * 60) / 60) * hourHeight,
                  height: ((draft.toMin - draft.fromMin) / 60) * hourHeight,
                }}
              />
            )}

            {/* timed events per day */}
            {days.map((day, dayIndex) => {
              const dayItems = flowItems
                .map(withOverride)
                .filter((it) => placementForDay(it, day, dayStartHour, dayEndHour) === "timed")
                .map((it) => ({
                  item: it,
                  geom: timedGeometry(it, day, dayStartHour, dayEndHour, hourHeight),
                }));
              const laid = layoutTimed(dayItems);
              return laid.map(({ item, geom, col, cols }) => {
                const vis = itemVisual(item, groups);
                const color = vis.color;
                const slot = columnLayout[dayIndex];
                const widthPct = slot.widthPct * (1 / cols);
                const leftPct = slot.leftPct + slot.widthPct * (col / cols);
                const dim = item.done;
                const empty = !item.title.trim();
                const blockStyle = {
                  top: geom.topPx,
                  height: geom.heightPx,
                  left: `calc(${leftPct}% + 1px)`,
                  width: `calc(${widthPct}% - 2px)`,
                  background: compactBlocks
                    ? tint(color, 0.32)
                    : `linear-gradient(180deg, ${tint(color, 0.26)}, ${tint(color, 0.16)})`,
                  borderColor: tint(color, 0.55),
                  boxShadow: `inset 2px 0 0 ${color}`,
                  opacity: vis.shared ? vis.opacity : dim ? 0.5 : 1,
                };
                const title = (
                  <span
                    className={`min-w-0 truncate font-semibold ${dim ? "line-through" : ""} ${
                      empty ? "italic text-ink-light" : ""
                    }`}
                  >
                    {item.title || "Nowe wydarzenie"}
                  </span>
                );

                if (compactBlocks) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-no-swipe
                      onClick={() => setEditing(item.id)}
                      className={`absolute select-none overflow-hidden rounded-[4px] border px-0.5 py-px text-left text-[9px] leading-tight text-ink ${
                        empty ? "border-dashed" : ""
                      } ${vis.shared ? "border-dashed" : ""}`}
                      style={blockStyle}
                    >
                      {title}
                    </button>
                  );
                }

                return (
                  <div
                    key={item.id}
                    data-no-swipe
                    className={`group absolute select-none overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight text-ink shadow-card transition-shadow hover:shadow-pop ${
                      empty ? "border-dashed" : ""
                    } ${vis.shared ? "border-dashed" : ""}`}
                    style={blockStyle}
                    onPointerDown={(e) => beginDrag(e, "move", item)}
                    onContextMenu={(e) => openItemMenu(e, item)}
                  >
                    <div
                      className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                      onPointerDown={(e) => beginDrag(e, "resize-start", item)}
                    />
                    <div className="flex min-w-0 items-center gap-1 pl-0.5">
                      <span
                        className={`min-w-0 truncate font-semibold ${dim ? "line-through" : ""} ${
                          empty ? "italic text-ink-light" : ""
                        }`}
                      >
                        {item.title || "Nowe wydarzenie"}
                      </span>
                      <ReminderBell item={item} size={9} />
                      <DeadlineClock item={item} day={day} size={9} />
                    </div>
                    {geom.heightPx > 28 && !(isMobile && days.length >= 7) && (
                      <div className="pl-0.5 text-ink-light">{fmtRange(item.start, item.end)}</div>
                    )}
                    <div
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      onPointerDown={(e) => beginDrag(e, "resize-end", item)}
                    />
                  </div>
                );
              });
            })}
            {days.map((day, dayIndex) => (
              <ReminderMarkers
                key={`rem-timed-${dayIndex}`}
                markers={reminderMarkers}
                day={day}
                dayIndex={dayIndex}
                columnLayout={columnLayout}
                dayStartHour={dayStartHour}
                dayEndHour={dayEndHour}
                hourHeight={hourHeight}
                groups={groups}
                placement="timed"
                onOpen={(id) => setEditing(id)}
              />
            ))}
            {days.map((day, dayIndex) => (
              <DeadlineMarkers
                key={`deadline-timed-${dayIndex}`}
                markers={deadlineMarkers}
                day={day}
                dayIndex={dayIndex}
                columnLayout={columnLayout}
                dayStartHour={dayStartHour}
                dayEndHour={dayEndHour}
                hourHeight={hourHeight}
                groups={groups}
                placement="timed"
                onOpen={(id) => setEditing(id)}
              />
            ))}
          </div>

          {nowIndicator && (
            <div
              className="pointer-events-none absolute inset-x-0 z-30"
              style={{ top: nowIndicator.topPx }}
              aria-hidden
            >
              <div
                className="absolute top-1/2 flex -translate-y-1/2 items-center justify-end pr-1"
                style={{ left: 0, width: gutter }}
              >
                <span className="rounded bg-surface px-1 text-[10px] font-semibold tabular-nums text-accent">
                  {nowIndicator.label}
                </span>
              </div>
              <div
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-glow"
                style={{ left: gutter }}
              />
              <div
                className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-accent"
                style={{
                  left: `calc(${gutter}px + (100% - ${gutter}px) * ${columnLayout[nowIndicator.dayIndex].leftPct / 100})`,
                  width: `calc((100% - ${gutter}px) * ${columnLayout[nowIndicator.dayIndex].widthPct / 100})`,
                }}
              />
            </div>
          )}
          </div>
        </div>

        {/* Off-hours AFTER band */}
        <OffHoursBand
          days={days}
          items={flowItems}
          reminderMarkers={reminderMarkers}
          deadlineMarkers={deadlineMarkers}
          groups={groups}
          kind="after"
          onOpen={(id) => setEditing(id)}
          gutter={gutter}
          equalColumns={equalColumns}
        />
        {footer}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

function OffHoursBand({
  days,
  items,
  reminderMarkers,
  deadlineMarkers,
  groups,
  kind,
  onOpen,
  gutter,
  equalColumns,
}: {
  days: Date[];
  items: Item[];
  reminderMarkers: ReminderMarker[];
  deadlineMarkers: DeadlineMarker[];
  groups: Record<string, Group>;
  kind: "before" | "after";
  onOpen: (id: string) => void;
  gutter: number;
  equalColumns?: boolean;
}) {
  const { dayStartHour, dayEndHour } = useStore((s) => s.settings);
  const columnLayout = useMemo(
    () => dayColumnLayout(days, { equal: equalColumns }),
    [days, equalColumns],
  );
  const anyDayHas =
    days.some((day) =>
      items.some((it) => placementForDay(it, day, dayStartHour, dayEndHour) === kind),
    ) ||
    reminderMarkers.some((m) => {
      const day = days.find((d) => isSameDay(d, m.at));
      if (!day) return false;
      return placementForDay(
        { ...m.item, ...markerAsTimedSlice(m) },
        day,
        dayStartHour,
        dayEndHour,
      ) === kind;
    }) ||
    deadlineMarkers.some((m) => {
      const day = days.find((d) => isSameDay(d, m.at));
      if (!day) return false;
      return placementForDay(
        { ...m.item, ...deadlineMarkerSlice(m.item.deadlineAt!) },
        day,
        dayStartHour,
        dayEndHour,
      ) === kind;
    });
  if (!anyDayHas) return null;
  return (
    <div
      className={`flex bg-canvas/60 ${kind === "before" ? "border-b" : "border-t"} border-line`}
      style={{ paddingLeft: gutter }}
    >
      {days.map((day, i) => {
        const chips = items.filter(
          (it) => placementForDay(it, day, dayStartHour, dayEndHour) === kind,
        );
        return (
          <div
            key={i}
            className="flex min-w-0 flex-wrap content-start gap-1 p-1"
            style={{
              flex: equalColumns ? 1 : dayColumnWeight(day),
              backgroundColor: weekendColumnBg(day),
            }}
          >
            {chips.map((it) => {
              const vis = itemVisual(it, groups);
              const color = vis.color;
              return (
                <button
                  key={it.id}
                  onClick={() => onOpen(it.id)}
                  title={`${it.title} · ${fmtTime(it.start)}`}
                  className="flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-ink"
                  style={{ background: tint(color, 0.22), opacity: vis.shared ? vis.opacity : 1 }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="truncate">{it.title || fmtTime(it.start)}</span>
                  <ReminderBell item={it} size={9} />
                  <DeadlineClock item={it} day={day} size={9} />
                </button>
              );
            })}
            <ReminderMarkers
              markers={reminderMarkers}
              day={day}
              dayIndex={i}
              columnLayout={columnLayout}
              dayStartHour={dayStartHour}
              dayEndHour={dayEndHour}
              hourHeight={0}
              groups={groups}
              placement={kind}
              onOpen={onOpen}
            />
            <DeadlineMarkers
              markers={deadlineMarkers}
              day={day}
              dayIndex={i}
              columnLayout={columnLayout}
              dayStartHour={dayStartHour}
              dayEndHour={dayEndHour}
              hourHeight={0}
              groups={groups}
              placement={kind}
              onOpen={onOpen}
            />
          </div>
        );
      })}
    </div>
  );
}

function AllDayBand({
  days,
  items,
  groups,
  onOpen,
  gutter,
  equalColumns,
}: {
  days: Date[];
  items: Item[];
  groups: Record<string, Group>;
  onOpen: (id: string) => void;
  gutter: number;
  equalColumns?: boolean;
}) {
  const placed = useMemo(() => layoutBandItems(days, items), [days, items]);
  const layout = useMemo(
    () => dayColumnLayout(days, { equal: equalColumns }),
    [days, equalColumns],
  );
  if (placed.length === 0) return null;
  const rowCount = placed.reduce((m, b) => Math.max(m, b.row + 1), 0);

  return (
    <div className="flex border-b border-line bg-surface" style={{ paddingLeft: gutter }}>
      <div className="relative flex-1" style={{ height: rowCount * 26 + 8 }}>
        {days.map((day, i) => (
          <div
            key={`allday-bg-${i}`}
            className="pointer-events-none absolute top-0 bottom-0 border-l border-line first:border-l-0"
            style={{
              left: `${layout[i].leftPct}%`,
              width: `${layout[i].widthPct}%`,
              backgroundColor: weekendColumnBg(day),
            }}
          />
        ))}
        {placed.map(({ item, startIdx, endIdx, row, continuesLeft, continuesRight }) => {
          const vis = itemVisual(item, groups);
          const color = vis.color;
          const span = spanColumnLayout(layout, startIdx, endIdx);
          const showDeadline = item.deadlineAt && days.some((d, idx) => {
            if (idx < startIdx || idx > endIdx) return false;
            return isSameDay(d, new Date(item.deadlineAt!));
          });
          const radius = [
            continuesLeft ? 0 : 8,
            continuesRight ? 0 : 8,
            continuesRight ? 0 : 8,
            continuesLeft ? 0 : 8,
          ]
            .map((n) => `${n}px`)
            .join(" ");
          return (
            <button
              key={item.id}
              data-no-swipe
              onClick={() => onOpen(item.id)}
              className="absolute flex items-center gap-0.5 overflow-hidden text-left text-[11px] font-semibold text-ink"
              style={{
                left: `calc(${span.leftPct}% + ${continuesLeft ? 0 : 2}px)`,
                width: `calc(${span.widthPct}% - ${continuesLeft || continuesRight ? 2 : 4}px)`,
                top: row * 26 + 4,
                height: 22,
                lineHeight: "22px",
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: radius,
                background: tint(color, 0.22),
                boxShadow: `inset 3px 0 0 ${color}`,
                opacity: vis.opacity,
              }}
            >
              <span className="min-w-0 truncate">{item.title || "(bez tytułu)"}</span>
              <ReminderBell item={item} size={9} />
              {showDeadline && <DeadlineClock item={item} size={9} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
