import { useEffect, useRef, useState } from "react";
import { Filter, Search, X } from "lucide-react";
import {
  hubAdvancedFiltersActive,
  type HubDatePreset,
} from "@/lib/chat/hubListFilters";

const DATE_OPTIONS: { id: HubDatePreset; label: string }[] = [
  { id: "all", label: "Wszystkie" },
  { id: "today", label: "Dziś" },
  { id: "7d", label: "7 dni" },
  { id: "30d", label: "30 dni" },
];

export interface HubFilterConversationOption {
  id: string;
  title: string;
}

interface HubRegistryFilterBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  conversationId: string | null;
  onConversationId: (id: string | null) => void;
  datePreset: HubDatePreset;
  onDatePreset: (p: HubDatePreset) => void;
  conversations: HubFilterConversationOption[];
  placeholder?: string;
  /** Wyczyść rozmowę + datę (query osobno przez X w polu). */
  onClearAdvanced?: () => void;
}

/** Pole Szukaj + przycisk Filtr (rozmowa, data) dla Decyzji / Notatek / Mediów. */
export function HubRegistryFilterBar({
  query,
  onQueryChange,
  conversationId,
  onConversationId,
  datePreset,
  onDatePreset,
  conversations,
  placeholder = "Szukaj…",
  onClearAdvanced,
}: HubRegistryFilterBarProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const advancedOn = hubAdvancedFiltersActive({ conversationId, datePreset });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const clearAdvanced = () => {
    onConversationId(null);
    onDatePreset("all");
    onClearAdvanced?.();
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <Search
          size={12}
          className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-line bg-surface-raised py-1 pl-6 pr-6 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-accent/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
            aria-label="Wyczyść wyszukiwanie"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <div className="relative shrink-0" ref={wrapRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`rounded-md p-1.5 transition ${
            advancedOn || open
              ? "bg-accent/15 text-ink"
              : "text-ink-faint hover:bg-surface-raised hover:text-ink"
          }`}
          title="Filtr: rozmowa i data"
          aria-label="Filtr: rozmowa i data"
          aria-expanded={open}
          aria-pressed={advancedOn}
        >
          <Filter size={13} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-1 w-[15.5rem] rounded-lg border border-line bg-surface-overlay p-2 shadow-pop">
            <label className="block px-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Rozmowa
            </label>
            <select
              value={conversationId ?? ""}
              onChange={(e) => onConversationId(e.target.value || null)}
              className="mt-1 w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent/50"
            >
              <option value="">Wszystkie</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>

            <div className="mt-2 px-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Data
            </div>
            <div className="mt-1 flex flex-wrap gap-0.5">
              {DATE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onDatePreset(o.id)}
                  className={`rounded-md px-1.5 py-1 text-[11px] font-medium transition ${
                    datePreset === o.id
                      ? "bg-accent/15 text-ink"
                      : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {advancedOn && (
              <button
                type="button"
                onClick={() => {
                  clearAdvanced();
                }}
                className="mt-2 w-full rounded-md border border-line px-2 py-1 text-[11px] text-ink-faint transition hover:bg-surface-raised hover:text-ink"
              >
                Wyczyść filtry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
