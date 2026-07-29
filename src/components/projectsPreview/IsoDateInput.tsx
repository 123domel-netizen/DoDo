import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
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

/**
 * Data w formacie dzień/miesiąc/rok. Wartość zewnętrzna = ISO `YYYY-MM-DD`.
 * Kalendarz (native picker) tylko jako pomoc — wyświetlanie zawsze PL.
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
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(isoToPlDate(value));
    setInvalid(false);
  }, [value]);

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

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el || disabled) return;
    try {
      el.showPicker?.();
    } catch {
      el.click();
    }
  };

  return (
    <div className="relative">
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
        className={`${className}${invalid ? " border-red-400/70" : ""}`}
      />
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        value={value || ""}
        onChange={(e) => {
          const iso = e.target.value;
          setInvalid(false);
          setText(isoToPlDate(iso));
          onChange(iso);
        }}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint transition hover:text-ink disabled:opacity-40"
        aria-label="Wybierz datę z kalendarza"
        tabIndex={-1}
      >
        <Calendar size={14} />
      </button>
    </div>
  );
}
