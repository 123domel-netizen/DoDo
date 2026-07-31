import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { pl } from "date-fns/locale";
import { isoToPlDate, plDateToIso } from "@/lib/projectsPreview/dateFormat";

interface IsoDateInputProps {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
  /** Domyślnie `dd/mm/rrrr`. */
  placeholder?: string;
}

const WEEKDAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"] as const;
const POPOVER_W = 280;
const POPOVER_H_EST = 310;

function parseIsoLocal(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoLocal(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function placePopover(
  anchor: DOMRect,
  popH: number,
): { top: number; left: number } {
  const spaceBelow = window.innerHeight - anchor.bottom;
  const openUp = spaceBelow < popH + 12 && anchor.top > spaceBelow;
  const top = openUp
    ? Math.max(8, anchor.top - popH - 6)
    : Math.min(anchor.bottom + 6, window.innerHeight - popH - 8);
  const left = Math.min(
    Math.max(8, anchor.right - POPOVER_W),
    window.innerWidth - POPOVER_W - 8,
  );
  return { top, left };
}

/**
 * Data w formacie dzień/miesiąc/rok. Wartość zewnętrzna = ISO `YYYY-MM-DD`.
 * Własny kalendarz PL (natywny picker bierze język systemu, nie `lang` dokumentu).
 */
export function IsoDateInput({
  value,
  onChange,
  className =
    "w-full rounded-lg border border-line bg-surface-raised px-2.5 py-2 pr-9 text-sm text-ink outline-none focus:border-line-strong",
  id,
  disabled,
  placeholder = "dd/mm/rrrr",
}: IsoDateInputProps) {
  const [text, setText] = useState(() => isoToPlDate(value));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const selected = parseIsoLocal(value);
  const [viewMonth, setViewMonth] = useState(
    () => startOfMonth(selected ?? new Date()),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const listId = useId();

  useEffect(() => {
    setText(isoToPlDate(value));
    setInvalid(false);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    setViewMonth(startOfMonth(selected ?? new Date()));
  }, [open, selected]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = rootRef.current!.getBoundingClientRect();
      const h = popoverRef.current?.offsetHeight || POPOVER_H_EST;
      setPos(placePopover(r, h));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, viewMonth]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setInvalid(false);
      setText("");
      if (value) onChange("");
      return;
    }
    const iso = plDateToIso(trimmed);
    if (!iso) {
      setInvalid(true);
      setText(isoToPlDate(value));
      return;
    }
    setInvalid(false);
    setText(isoToPlDate(iso));
    if (iso !== value) onChange(iso);
  };

  const pickDay = (d: Date) => {
    const iso = toIsoLocal(d);
    setInvalid(false);
    setText(isoToPlDate(iso));
    onChange(iso);
    setOpen(false);
  };

  const monthStart = startOfMonth(viewMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(text);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-invalid={invalid || undefined}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`${className}${invalid ? " border-red-400/70" : ""}`}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint transition hover:text-ink disabled:opacity-40"
        aria-label="Wybierz datę z kalendarza"
        aria-expanded={open}
        tabIndex={-1}
      >
        <Calendar size={14} />
      </button>

      {open && !disabled
        ? createPortal(
            <div
              ref={popoverRef}
              id={listId}
              role="dialog"
              aria-label="Kalendarz"
              style={{
                position: "fixed",
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                width: POPOVER_W,
                visibility: pos ? "visible" : "hidden",
              }}
              className="z-[9300] rounded-xl border border-line bg-surface-overlay p-2.5 shadow-pop"
            >
              <div className="mb-2 flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                  className="rounded-md p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
                  aria-label="Poprzedni miesiąc"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="text-[13px] font-semibold capitalize text-ink">
                  {format(viewMonth, "LLLL yyyy", { locale: pl })}
                </div>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="rounded-md p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
                  aria-label="Następny miesiąc"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="mb-1 grid grid-cols-7 gap-0.5">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="py-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-ink-faint"
                  >
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-0.5">
                {days.map((d) => {
                  const inMonth = isSameMonth(d, viewMonth);
                  const sel = selected ? isSameDay(d, selected) : false;
                  const today = isToday(d);
                  return (
                    <button
                      key={toIsoLocal(d)}
                      type="button"
                      onClick={() => pickDay(d)}
                      className={`flex h-8 items-center justify-center rounded-md text-[12px] transition ${
                        sel
                          ? "bg-accent font-semibold text-white"
                          : today
                            ? "bg-accent/15 font-medium text-accent hover:bg-accent/25"
                            : inMonth
                              ? "text-ink hover:bg-surface-raised"
                              : "text-ink-faint/50 hover:bg-surface-raised/60"
                      }`}
                    >
                      {format(d, "d")}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex justify-between border-t border-line/60 pt-2">
                <button
                  type="button"
                  onClick={() => pickDay(new Date())}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
                >
                  Dziś
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-1 text-[11px] text-ink-faint hover:bg-surface-raised hover:text-ink"
                >
                  Zamknij
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
