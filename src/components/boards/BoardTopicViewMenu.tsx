import { useEffect, useRef, useState } from "react";
import { Columns3, Filter, ListFilter } from "lucide-react";
import type { BoardField } from "@/lib/boards/types";
import type { BoardTopicViewPrefs, TopicFieldFilters, TopicViewSort } from "@/lib/boards/topicView";

export function BoardTopicViewMenu({
  fields,
  prefs,
  onChange,
}: {
  fields: BoardField[];
  prefs: BoardTopicViewPrefs;
  onChange: (next: BoardTopicViewPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const choiceFields = fields.filter((f) => f.kind === "single" || f.kind === "multi");
  const filterCount = Object.values(prefs.filters).reduce((n, ids) => n + ids.length, 0);
  const active =
    prefs.columnIds.length > 0 || filterCount > 0 || prefs.sort.mode !== "manual";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  if (fields.length === 0) return null;

  const setSort = (sort: TopicViewSort) => onChange({ ...prefs, sort });

  const toggleColumn = (fieldId: string) => {
    const set = new Set(prefs.columnIds);
    if (set.has(fieldId)) set.delete(fieldId);
    else set.add(fieldId);
    onChange({ ...prefs, columnIds: fields.map((f) => f.id).filter((id) => set.has(id)) });
  };

  const toggleFilterOption = (fieldId: string, optionId: string) => {
    const filters: TopicFieldFilters = { ...prefs.filters };
    const cur = new Set(filters[fieldId] ?? []);
    if (cur.has(optionId)) cur.delete(optionId);
    else cur.add(optionId);
    if (cur.size === 0) delete filters[fieldId];
    else filters[fieldId] = [...cur];
    onChange({ ...prefs, filters });
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition hover:bg-surface-raised hover:text-ink-light ${
          active ? "text-accent" : "text-ink-faint"
        }`}
        aria-expanded={open}
        aria-label="Widok listy: kolumny, filtr, sortowanie"
        title="Kolumny, filtr i sortowanie według pól"
      >
        <ListFilter size={12} />
        <span>Widok</span>
        {(prefs.columnIds.length > 0 || filterCount > 0) && (
          <span className="rounded bg-accent/15 px-1 text-[9px] tabular-nums text-accent">
            {prefs.columnIds.length + filterCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 max-h-[70vh] overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-overlay p-2.5 shadow-panel">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            <Columns3 size={11} /> Kolumny
          </div>
          <div className="mb-3 space-y-0.5">
            {fields.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
              >
                <input
                  type="checkbox"
                  checked={prefs.columnIds.includes(f.id)}
                  onChange={() => toggleColumn(f.id)}
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1 truncate">
                  {f.name}
                  {f.visibility === "restricted" ? (
                    <span className="ml-1 text-[10px] text-ink-faint">ukryte</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>

          {choiceFields.length > 0 && (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                <Filter size={11} /> Filtr
              </div>
              <div className="mb-3 space-y-2">
                {choiceFields.map((f) => (
                  <div key={f.id}>
                    <div className="mb-0.5 px-1.5 text-[11px] font-medium text-ink-light">{f.name}</div>
                    <div className="space-y-0.5">
                      {f.options.map((o) => (
                        <label
                          key={o.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
                        >
                          <input
                            type="checkbox"
                            checked={(prefs.filters[f.id] ?? []).includes(o.id)}
                            onChange={() => toggleFilterOption(f.id, o.id)}
                            className="accent-accent"
                          />
                          <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Sortuj według
          </div>
          <div className="space-y-0.5">
            {(
              [
                { mode: "manual" as const, label: "Ręczne (przeciąganie)" },
                { mode: "code" as const, label: "Kod" },
              ] as const
            ).map((opt) => (
              <label
                key={opt.mode}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
              >
                <input
                  type="radio"
                  name="topic-view-sort"
                  checked={prefs.sort.mode === opt.mode}
                  onChange={() => setSort({ mode: opt.mode })}
                  className="accent-accent"
                />
                {opt.label}
              </label>
            ))}
            {fields.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
              >
                <input
                  type="radio"
                  name="topic-view-sort"
                  checked={prefs.sort.mode === "field" && prefs.sort.fieldId === f.id}
                  onChange={() => setSort({ mode: "field", fieldId: f.id })}
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
