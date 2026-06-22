import { forwardRef, useEffect, useRef, useState } from "react";
import type { Item, ItemRecurrence, RecurrenceFrequency, RecurrencePresetId } from "@/types";
import {
  detectPreset,
  presetRecurrence,
  recurrenceSummary,
  weekdayFromItemStart,
} from "@/lib/recurrenceRules";
import { Repeat } from "lucide-react";

const PRESETS: { id: RecurrencePresetId; label: string }[] = [
  { id: "none", label: "Nie powtarza się" },
  { id: "daily", label: "Codziennie" },
  { id: "weekly", label: "Co tydzień" },
  { id: "monthly", label: "Co miesiąc" },
  { id: "yearly", label: "Co rok" },
  { id: "weekdays", label: "W każdy dzień roboczy" },
  { id: "custom", label: "Niestandardowo…" },
];

const FREQ_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: "daily", label: "dzień" },
  { value: "weekly", label: "tydzień" },
  { value: "monthly", label: "miesiąc" },
  { value: "yearly", label: "rok" },
];

const WEEKDAY_LABELS = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];

type EndType = "never" | "until" | "count";

function endType(rec: ItemRecurrence | null): EndType {
  if (!rec) return "never";
  if (rec.count != null && rec.count > 0) return "count";
  if (rec.until) return "until";
  return "never";
}

function toDateInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInput(value: string): string {
  const d = new Date(value);
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

function defaultCustomRecurrence(item: Pick<Item, "start">): ItemRecurrence {
  return {
    frequency: "weekly",
    interval: 1,
    byWeekday: [weekdayFromItemStart(item)],
  };
}

export function RecurrenceEditor({
  item,
  readOnly,
  onChange,
}: {
  item: Pick<Item, "start" | "recurrence">;
  readOnly?: boolean;
  onChange: (recurrence: ItemRecurrence | null) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const preset = detectPreset(item.recurrence, item);
  const summary = recurrenceSummary(item.recurrence, item);

  useEffect(() => {
    if (!customOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setCustomOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [customOpen]);

  const applyPreset = (id: RecurrencePresetId) => {
    if (id === "custom") {
      setCustomOpen(true);
      if (!item.recurrence || preset !== "custom") {
        onChange(defaultCustomRecurrence(item));
      }
      return;
    }
    setCustomOpen(false);
    onChange(presetRecurrence(id, item));
  };

  if (readOnly) {
    return <span className="text-sm text-ink-light">{summary}</span>;
  }

  return (
    <div className="space-y-2">
      <select
        value={preset === "custom" ? "custom" : preset}
        onChange={(e) => applyPreset(e.target.value as RecurrencePresetId)}
        className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none"
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      {preset !== "none" && preset !== "custom" && (
        <p className="text-xs text-ink-faint">{summary}</p>
      )}

      {(preset === "custom" || customOpen) && item.recurrence && (
        <CustomRecurrencePanel
          ref={wrapRef}
          recurrence={item.recurrence}
          item={item}
          onChange={onChange}
          onClose={() => setCustomOpen(false)}
        />
      )}
    </div>
  );
}

const CustomRecurrencePanel = forwardRef<
  HTMLDivElement,
  {
    recurrence: ItemRecurrence;
    item: Pick<Item, "start">;
    onChange: (recurrence: ItemRecurrence | null) => void;
    onClose: () => void;
  }
>(function CustomRecurrencePanel({ recurrence, item, onChange, onClose }, ref) {
  const end = endType(recurrence);
  const [endMode, setEndMode] = useState<EndType>(end);
  const [untilDate, setUntilDate] = useState(
    recurrence.until ? toDateInput(recurrence.until) : toDateInput(item.start),
  );
  const [countValue, setCountValue] = useState(String(recurrence.count ?? 10));

  const patch = (p: Partial<ItemRecurrence>) => {
    const next: ItemRecurrence = { ...recurrence, ...p };
    if (endMode === "never") {
      next.until = null;
      next.count = null;
    } else if (endMode === "until") {
      next.until = fromDateInput(untilDate);
      next.count = null;
    } else {
      next.count = Math.max(1, parseInt(countValue, 10) || 1);
      next.until = null;
    }
    onChange(next);
  };

  const toggleWeekday = (d: number) => {
    const current = recurrence.byWeekday ?? [weekdayFromItemStart(item)];
    const set = new Set(current);
    if (set.has(d)) {
      if (set.size > 1) set.delete(d);
    } else {
      set.add(d);
    }
    patch({ byWeekday: [...set].sort((a, b) => a - b) });
  };

  return (
    <div
      ref={ref}
      className="rounded-lg border border-line bg-surface-overlay p-3 shadow-pop"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-light">
        <Repeat size={14} />
        Niestandardowa powtarzalność
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-faint">Co</span>
        <input
          type="number"
          min={1}
          max={999}
          value={recurrence.interval}
          onChange={(e) => patch({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="w-14 rounded-md border border-line bg-surface-raised px-2 py-1 text-center text-sm text-ink outline-none"
        />
        <select
          value={recurrence.frequency}
          onChange={(e) => {
            const frequency = e.target.value as RecurrenceFrequency;
            const extra: Partial<ItemRecurrence> = { frequency, weekdaysOnly: false };
            if (frequency === "weekly" && !recurrence.byWeekday?.length) {
              extra.byWeekday = [weekdayFromItemStart(item)];
            }
            patch(extra);
          }}
          className="rounded-md border border-line bg-surface-raised px-2 py-1 text-sm text-ink outline-none"
        >
          {FREQ_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {recurrence.frequency === "weekly" && (
        <div className="mb-3 flex flex-wrap gap-1">
          {WEEKDAY_LABELS.map((label, i) => {
            const selected = (recurrence.byWeekday ?? []).includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(i)}
                className={`h-7 w-7 rounded-full text-[11px] font-medium transition ${
                  selected
                    ? "bg-accent text-white"
                    : "border border-line bg-surface-raised text-ink-faint hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <span className="text-xs font-medium text-ink-faint">Koniec</span>
        <label className="flex items-center gap-2 text-sm text-ink-light">
          <input
            type="radio"
            name="rec-end"
            checked={endMode === "never"}
            onChange={() => {
              setEndMode("never");
              patch({ until: null, count: null });
            }}
          />
          Nigdy
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink-light">
          <input
            type="radio"
            name="rec-end"
            checked={endMode === "until"}
            onChange={() => {
              setEndMode("until");
              patch({ until: fromDateInput(untilDate), count: null });
            }}
          />
          W dniu
          <input
            type="date"
            value={untilDate}
            disabled={endMode !== "until"}
            onChange={(e) => {
              setUntilDate(e.target.value);
              if (endMode === "until") patch({ until: fromDateInput(e.target.value), count: null });
            }}
            className="rounded-md border border-line bg-surface-raised px-2 py-0.5 text-xs text-ink outline-none disabled:opacity-50"
          />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-ink-light">
          <input
            type="radio"
            name="rec-end"
            checked={endMode === "count"}
            onChange={() => {
              setEndMode("count");
              patch({ count: Math.max(1, parseInt(countValue, 10) || 1), until: null });
            }}
          />
          Po
          <input
            type="number"
            min={1}
            max={999}
            value={countValue}
            disabled={endMode !== "count"}
            onChange={(e) => {
              setCountValue(e.target.value);
              if (endMode === "count") {
                patch({ count: Math.max(1, parseInt(e.target.value, 10) || 1), until: null });
              }
            }}
            className="w-14 rounded-md border border-line bg-surface-raised px-2 py-0.5 text-center text-xs text-ink outline-none disabled:opacity-50"
          />
          wystąpieniach
        </label>
      </div>

      <p className="mt-3 text-xs text-ink-faint">{recurrenceSummary(recurrence, item)}</p>

      <button
        type="button"
        onClick={onClose}
        className="mt-2 w-full rounded-md border border-line px-2 py-1 text-xs text-ink-faint hover:text-ink"
      >
        Zamknij
      </button>
    </div>
  );
});
