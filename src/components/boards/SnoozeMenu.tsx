import { useEffect, useRef, useState } from "react";
import { BellOff } from "lucide-react";
import {
  SNOOZE_PRESET_LABELS,
  snoozeUntilForDate,
  snoozeUntilForPreset,
  type SnoozePreset,
} from "@/lib/boards/sections";
import { fmt } from "@/lib/format";

const PRESETS: SnoozePreset[] = ["tomorrow", "nextWeek", "month"];

function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Przycisk „Odłóż” z listą: jutro / przyszły tydzień / za miesiąc / wybrana data. */
export function SnoozeMenu({
  onPick,
  disabled,
  label = "Odłóż",
}: {
  onPick: (until: Date) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (until: Date) => {
    setOpen(false);
    setDate("");
    setError(null);
    onPick(until);
  };

  const submitDate = () => {
    const until = snoozeUntilForDate(date, new Date());
    if (!until) {
      setError("Wybierz datę w przyszłości.");
      return;
    }
    pick(until);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-ink transition hover:border-line-strong disabled:opacity-50"
      >
        <BellOff size={13} />
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-56 rounded-xl border border-line bg-surface-overlay p-1 shadow-pop"
        >
          {PRESETS.map((p) => {
            const until = snoozeUntilForPreset(p, new Date());
            return (
              <button
                key={p}
                type="button"
                role="menuitem"
                onClick={() => pick(until)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition hover:bg-surface-raised"
              >
                <span>{SNOOZE_PRESET_LABELS[p]}</span>
                <span className="text-[11px] text-ink-faint">{fmt(until, "EEE d MMM")}</span>
              </button>
            );
          })}
          <div className="mt-1 border-t border-line/70 px-2.5 pb-1.5 pt-2">
            <label className="mb-1 block text-[11px] text-ink-faint">Wybrana data</label>
            <div className="flex gap-1.5">
              <input
                type="date"
                min={todayInput()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setError(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={submitDate}
                disabled={!date}
                className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                OK
              </button>
            </div>
            {error && <div className="mt-1 text-[11px] text-red-400">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
