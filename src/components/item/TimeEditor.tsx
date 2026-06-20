import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  isToday,
  setYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmt, fmtTime } from "@/lib/format";
import { normalizeAllDayRange } from "@/lib/allDay";

const SLOT_MINUTES = 15;

function timeSlots(): { h: number; m: number; label: string }[] {
  const slots: { h: number; m: number; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      slots.push({ h, m, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` });
    }
  }
  return slots;
}

const SLOTS = timeSlots();

const DURATION_PRESETS: { label: string; minutes: number }[] = [
  { label: "0 min", minutes: 0 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "45 min", minutes: 45 },
  { label: "1 godz", minutes: 60 },
  { label: "1,5 godz", minutes: 90 },
  { label: "2 godz", minutes: 120 },
  { label: "2,5 godz", minutes: 150 },
  { label: "3 godz", minutes: 180 },
  { label: "4 godz", minutes: 240 },
  { label: "6 godz", minutes: 360 },
  { label: "8 godz", minutes: 480 },
];

function durationMinutesRaw(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function changeDuration(startIso: string, minutes: number, minDuration = 0) {
  const s = new Date(startIso);
  const dur = Math.max(minDuration, minutes);
  return { end: new Date(s.getTime() + dur * 60_000).toISOString() };
}

function parseDurationInput(raw: string): number | null {
  const v = raw.trim().toLowerCase().replace(",", ".");
  if (!v) return null;
  if (v === "0" || v === "0 min" || v === "0m") return 0;
  const hours = v.match(/^([\d.]+)\s*h(?:\s|$)/);
  if (hours) {
    const n = parseFloat(hours[1]);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
  }
  const mins = v.match(/^([\d.]+)\s*(?:min|m)?$/);
  if (mins) {
    const n = parseFloat(mins[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    if (v.includes("min") || v.endsWith("m") || n > 12) return Math.round(n);
    return Math.round(n * 60);
  }
  return null;
}

function durationLabel(a: Date, b: Date): string {
  const m = durationMinutesRaw(a, b);
  if (m === 0) return "0 min";
  if (m >= 1440 && m % 1440 === 0) return `${m / 1440} dni`;
  if (m >= 1440) return `${Math.round((m / 1440) * 10) / 10} dni`;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} godz ${mm} min` : `${h} godz`;
  }
  return `${m} min`;
}

function snapMinutes(m: number): number {
  return Math.round(m / SLOT_MINUTES) * SLOT_MINUTES;
}

function moveToDate(startIso: string, endIso: string, target: Date): { start: string; end: string } {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const daySpan = differenceInCalendarDays(startOfDay(e), startOfDay(s));
  const ns = new Date(target);
  ns.setHours(s.getHours(), s.getMinutes(), s.getSeconds(), 0);
  const ne = new Date(ns);
  if (daySpan > 0) {
    ne.setDate(ne.getDate() + daySpan);
    ne.setHours(e.getHours(), e.getMinutes(), 0, 0);
  } else {
    ne.setHours(e.getHours(), e.getMinutes(), 0, 0);
  }
  return { start: ns.toISOString(), end: ne.toISOString() };
}

function changeStartTime(startIso: string, endIso: string, h: number, m: number) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const dur = Math.max(0, e.getTime() - s.getTime());
  const ns = new Date(s);
  ns.setHours(h, m, 0, 0);
  return { start: ns.toISOString(), end: new Date(ns.getTime() + dur).toISOString() };
}

function changeEndTime(startIso: string, _endIso: string, h: number, m: number) {
  const s = new Date(startIso);
  const ne = new Date(s);
  ne.setHours(h, m, 0, 0);
  if (ne.getTime() < s.getTime()) return { end: s.toISOString() };
  return { end: ne.toISOString() };
}

function toAllDay(startIso: string) {
  return normalizeAllDayRange(startIso);
}

function fromAllDay(startIso: string) {
  const d = startOfDay(new Date(startIso));
  d.setHours(12, 0, 0, 0);
  const end = new Date(d.getTime() + 60 * 60_000);
  return { start: d.toISOString(), end: end.toISOString(), allDay: false };
}

export interface TimeEditorProps {
  start: string;
  end: string;
  allDay: boolean;
  allowClear?: boolean;
  /** Minimalny czas trwania (np. 60 dla zadania w kalendarzu). */
  minDurationMinutes?: number;
  /** Czy dozwolone 0 min (wydarzenie punktowe / termin zadania). */
  allowZeroDuration?: boolean;
  onChange: (patch: Partial<{ start: string; end: string; allDay: boolean; hasDueDate: boolean }>) => void;
  onClear?: () => void;
}

export function TimeEditor({
  start,
  end,
  allDay,
  allowClear,
  minDurationMinutes = 0,
  allowZeroDuration = true,
  onChange,
  onClear,
}: TimeEditorProps) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const [openPicker, setOpenPicker] = useState<"start" | "end" | "duration" | "date" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPicker) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenPicker(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openPicker]);

  const durationMin = durationMinutesRaw(startDate, endDate);
  const isPointInTime = durationMin === 0;
  const effectiveMin = allowZeroDuration ? minDurationMinutes : Math.max(minDurationMinutes, SLOT_MINUTES);
  const durationPresets = allowZeroDuration
    ? DURATION_PRESETS
    : DURATION_PRESETS.filter((p) => p.minutes >= effectiveMin);

  useEffect(() => {
    if (!allDay) return;
    const s = startOfDay(new Date(start));
    const expectedEnd = addDays(s, 1);
    if (startOfDay(new Date(end)).getTime() !== expectedEnd.getTime()) {
      onChange({ start: s.toISOString(), end: expectedEnd.toISOString() });
    }
  }, [allDay, start, end, onChange]);

  return (
    <div ref={rootRef} className="space-y-2">
      {!allDay && (
        <div className="flex flex-wrap items-center gap-1.5">
          <TimePickerButton
            label={fmtTime(start)}
            open={openPicker === "start"}
            onToggle={() => setOpenPicker((p) => (p === "start" ? null : "start"))}
            selectedH={startDate.getHours()}
            selectedM={snapMinutes(startDate.getMinutes())}
            onPick={(h, m) => {
              onChange(changeStartTime(start, end, h, m));
              setOpenPicker(null);
            }}
          />
          {!isPointInTime && (
            <>
              <span className="px-0.5 text-sm text-ink-faint">→</span>
              <TimePickerButton
                label={fmtTime(end)}
                open={openPicker === "end"}
                onToggle={() => setOpenPicker((p) => (p === "end" ? null : "end"))}
                selectedH={endDate.getHours()}
                selectedM={snapMinutes(endDate.getMinutes())}
                onPick={(h, m) => {
                  onChange(changeEndTime(start, end, h, m));
                  setOpenPicker(null);
                }}
              />
            </>
          )}
          <DurationPickerButton
            label={durationLabel(startDate, endDate)}
            open={openPicker === "duration"}
            onToggle={() => setOpenPicker((p) => (p === "duration" ? null : "duration"))}
            selectedMinutes={durationMin}
            presets={durationPresets}
            minDuration={effectiveMin}
            onPick={(minutes) => {
              onChange(changeDuration(start, minutes, effectiveMin));
              setOpenPicker(null);
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <DatePickerButton
          label={fmt(startDate, "EEE d MMM yyyy")}
          open={openPicker === "date"}
          onToggle={() => setOpenPicker((p) => (p === "date" ? null : "date"))}
          anchor={startDate}
          onPick={(day) => {
            if (allDay) {
              const s = startOfDay(day);
              onChange({ start: s.toISOString(), end: addDays(s, 1).toISOString() });
            } else {
              onChange(moveToDate(start, end, day));
            }
            setOpenPicker(null);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => {
            if (allDay) onChange(fromAllDay(start));
            else onChange({ ...toAllDay(start), allDay: true });
          }}
          className={`font-medium transition hover:text-ink ${
            allDay ? "text-accent-soft" : "text-ink-light"
          }`}
        >
          Cały dzień
        </button>
        {allowClear && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-ink-faint transition hover:text-ink"
          >
            Usuń termin
          </button>
        )}
      </div>
    </div>
  );
}

function DurationPickerButton({
  label,
  open,
  onToggle,
  selectedMinutes,
  presets,
  minDuration,
  onPick,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  selectedMinutes: number;
  presets: { label: string; minutes: number }[];
  minDuration: number;
  onPick: (minutes: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = presets.findIndex((p) => p.minutes === selectedMinutes);
    const el = listRef.current.children[idx >= 0 ? idx : 0] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center" });
  }, [open, selectedMinutes, presets]);

  const applyCustom = () => {
    const minutes = parseDurationInput(custom);
    if (minutes === null || minutes < minDuration) return;
    onPick(minutes);
    setCustom("");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        title="Zmień czas trwania"
        className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
          open
            ? "bg-accent/20 text-accent-soft ring-1 ring-accent/40"
            : "bg-surface-raised text-ink-light ring-1 ring-line hover:text-ink hover:ring-line-strong"
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-xl border border-line bg-surface-overlay shadow-pop">
          <div ref={listRef} className="max-h-44 overflow-y-auto thin-scrollbar py-1">
            {presets.map((preset) => {
              const active = preset.minutes === selectedMinutes;
              return (
                <button
                  key={preset.minutes}
                  type="button"
                  onClick={() => onPick(preset.minutes)}
                  className={`block w-full px-3 py-1.5 text-left text-sm transition ${
                    active
                      ? "bg-surface-raised font-medium text-ink"
                      : "text-ink-light hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="border-t border-line p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">Własne</div>
            <div className="flex gap-1">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyCustom()}
                placeholder="2,5 h"
                className="min-w-0 flex-1 rounded-md bg-surface-raised px-2 py-1 text-xs text-ink outline-none ring-1 ring-line focus:ring-accent"
              />
              <button
                type="button"
                onClick={applyCustom}
                className="shrink-0 rounded-md bg-surface-raised px-2 py-1 text-xs text-ink-light ring-1 ring-line hover:text-ink"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimePickerButton({
  label,
  open,
  onToggle,
  selectedH,
  selectedM,
  onPick,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  selectedH: number;
  selectedM: number;
  onPick: (h: number, m: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = SLOTS.findIndex((s) => s.h === selectedH && s.m === selectedM);
    const el = listRef.current.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "center" });
  }, [open, selectedH, selectedM]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-lg px-2.5 py-1 text-sm font-medium tabular-nums transition ${
          open
            ? "bg-accent/20 text-accent-soft ring-1 ring-accent/40"
            : "bg-surface-raised text-ink ring-1 ring-line hover:ring-line-strong"
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-52 w-28 overflow-y-auto thin-scrollbar rounded-xl border border-line bg-surface-overlay py-1 shadow-pop">
          <div ref={listRef}>
            {SLOTS.map((slot) => {
              const active = slot.h === selectedH && slot.m === selectedM;
              return (
                <button
                  key={slot.label}
                  type="button"
                  onClick={() => onPick(slot.h, slot.m)}
                  className={`block w-full px-3 py-1.5 text-left text-sm tabular-nums transition ${
                    active
                      ? "bg-surface-raised font-medium text-ink"
                      : "text-ink-light hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DatePickerButton({
  label,
  open,
  onToggle,
  anchor,
  onPick,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  anchor: Date;
  onPick: (day: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(anchor));
  const thisYear = new Date().getFullYear();
  const yearOptions = useMemo(
    () => Array.from({ length: 21 }, (_, i) => thisYear - 10 + i),
    [thisYear],
  );

  useEffect(() => {
    if (open) setViewMonth(startOfMonth(anchor));
  }, [open, anchor]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start, end });
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [viewMonth]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${
          open
            ? "bg-accent/20 text-accent-soft ring-1 ring-accent/40"
            : "bg-surface-raised text-ink ring-1 ring-line hover:ring-line-strong"
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[260px] rounded-xl border border-line bg-surface-overlay p-3 shadow-pop">
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addYears(m, -1))}
              className="rounded-md p-1 text-ink-light hover:bg-surface-raised hover:text-ink"
              aria-label="Poprzedni rok"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, -1))}
                className="rounded-md px-1 py-1 text-ink-light hover:bg-surface-raised hover:text-ink"
                aria-label="Poprzedni miesiąc"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="truncate text-sm font-semibold capitalize text-ink">
                {fmt(viewMonth, "LLLL")}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
                className="rounded-md px-1 py-1 text-ink-light hover:bg-surface-raised hover:text-ink"
                aria-label="Następny miesiąc"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addYears(m, 1))}
              className="rounded-md p-1 text-ink-light hover:bg-surface-raised hover:text-ink"
              aria-label="Następny rok"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="mb-2 flex justify-center">
            <select
              value={viewMonth.getFullYear()}
              onChange={(e) => setViewMonth((m) => setYear(m, Number(e.target.value)))}
              className="rounded-lg border border-line bg-surface-raised px-2 py-1 text-sm text-ink outline-none"
              aria-label="Rok"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase text-ink-faint">
            {["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {weeks.flat().map((day) => {
              const inMonth = isSameMonth(day, viewMonth);
              const selected = isSameDay(day, anchor);
              const today = isToday(day);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => onPick(day)}
                  className={`flex h-8 w-full items-center justify-center rounded-lg text-sm transition ${
                    selected
                      ? "bg-accent text-white font-semibold"
                      : today
                        ? "font-semibold text-accent-soft ring-1 ring-accent/30"
                        : inMonth
                          ? "text-ink hover:bg-surface-raised"
                          : "text-ink-faint hover:bg-surface-raised"
                  }`}
                >
                  {fmt(day, "d")}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
