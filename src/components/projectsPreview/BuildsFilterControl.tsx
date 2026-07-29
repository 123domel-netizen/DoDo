import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Search } from "lucide-react";
import { normalizeSearchText } from "@/lib/projectsPreview/normalize";
import { projectLabel, type PreviewProject } from "@/lib/projectsPreview/types";

export type BuildsFilterValue = string[] | "all";

interface BuildsFilterControlProps {
  projects: PreviewProject[];
  value: BuildsFilterValue;
  onChange: (next: BuildsFilterValue) => void;
  /** Dim / disable while a single budowa is focused on the board. */
  disabled?: boolean;
}

/**
 * Filtr budów: domyślnie wszystkie; klik w jedną budowę = tylko ona.
 * Ponowny klik w wybraną albo „Wszystkie aktywne” wraca do pełnego widoku.
 */
export function BuildsFilterControl({
  projects,
  value,
  onChange,
  disabled = false,
}: BuildsFilterControlProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query);
    if (!q) return projects;
    return projects.filter((p) => {
      const hay = normalizeSearchText(`${p.number} ${p.name}`);
      return hay.includes(q) || String(p.number).includes(query.trim());
    });
  }, [projects, query]);

  const isAll = value === "all";
  const soloId =
    Array.isArray(value) && value.length === 1 ? value[0]! : null;
  const soloProject = soloId
    ? projects.find((p) => p.id === soloId)
    : null;

  const buttonLabel = (() => {
    if (projects.length === 0) return "Brak budów";
    if (isAll) return "Wszystkie budowy";
    if (soloProject) return projectLabel(soloProject);
    if (Array.isArray(value) && value.length > 1) {
      return `${value.length} budowy`;
    }
    return "Wybierz budowę";
  })();

  const selectAll = () => {
    onChange("all");
    setOpen(false);
  };

  /** Klik w budowę → tylko ona; ponowny klik w tę samą → z powrotem wszystkie. */
  const selectOne = (id: string) => {
    if (soloId === id) {
      onChange("all");
    } else {
      onChange([id]);
    }
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        disabled={disabled || projects.length === 0}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Filtr budów"
        className={`inline-flex h-7 max-w-[13rem] items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition sm:max-w-[16rem] ${
          disabled
            ? "cursor-not-allowed border-line/50 text-ink-faint opacity-60"
            : open || !isAll
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-line text-ink-light hover:border-line-strong hover:text-ink"
        }`}
      >
        <Building2 size={13} className="shrink-0 opacity-80" />
        <span className="min-w-0 truncate">{buttonLabel}</span>
        <ChevronsUpDown size={12} className="shrink-0 opacity-60" />
      </button>

      {open && !disabled ? (
        <div
          className="absolute left-0 top-full z-40 mt-1 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-surface-overlay shadow-pop"
          role="listbox"
          aria-label="Filtr budów"
        >
          <div className="border-b border-line px-2 py-1.5">
            <label className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1">
              <Search size={12} className="shrink-0 text-ink-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj numeru lub nazwy…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
          </div>

          <div className="max-h-64 overflow-y-auto thin-scrollbar py-1">
            <button
              type="button"
              onClick={selectAll}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised"
            >
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                  isAll
                    ? "border-accent bg-accent text-white"
                    : "border-line text-transparent"
                }`}
              >
                <Check size={10} strokeWidth={3} />
              </span>
              <span className="font-medium text-ink">Wszystkie aktywne</span>
              <span className="ml-auto text-[10px] tabular-nums text-ink-faint">
                {projects.length}
              </span>
            </button>

            <div className="my-1 border-t border-line/70" />

            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-ink-faint">
                Nic nie pasuje.
              </p>
            ) : (
              filtered.map((p) => {
                const on = soloId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectOne(p.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                        on
                          ? "border-accent bg-accent text-white"
                          : "border-line text-transparent"
                      }`}
                    >
                      <Check size={10} strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      <span className="font-semibold tabular-nums text-accent">
                        #{p.number}
                      </span>{" "}
                      {p.name}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
