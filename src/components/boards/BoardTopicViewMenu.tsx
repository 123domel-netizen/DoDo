import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, Filter, ListFilter } from "lucide-react";
import type { BoardField } from "@/lib/boards/types";
import type { BoardTopicViewPrefs, TopicFieldFilters, TopicViewSort } from "@/lib/boards/topicView";

const PANEL_W = 288; // w-72

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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const choiceFields = fields.filter((f) => f.kind === "single" || f.kind === "multi");
  const filterCount = Object.values(prefs.filters).reduce((n, ids) => n + ids.length, 0);
  /** null = wszystkie kolumny (domyślne). */
  const selectedColumns = new Set(prefs.columnIds ?? fields.map((f) => f.id));
  const columnCount = selectedColumns.size;
  const active =
    prefs.columnIds != null || filterCount > 0 || prefs.sort.mode !== "manual";

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 4;
      let left = r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8));
      let top = r.bottom + gap;
      const maxH = Math.min(window.innerHeight * 0.7, window.innerHeight - top - 8);
      if (maxH < 160 && r.top > 200) {
        top = Math.max(8, r.top - gap);
        setPos({ top, left });
        return;
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
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

  if (fields.length === 0) return null;

  const setSort = (sort: TopicViewSort) => onChange({ ...prefs, sort });

  const toggleColumn = (fieldId: string) => {
    const set = new Set(selectedColumns);
    if (set.has(fieldId)) set.delete(fieldId);
    else set.add(fieldId);
    // 0 albo wszystkie → null (domyślne „pokaż wszystkie”).
    if (set.size === 0 || set.size === fields.length) {
      onChange({ ...prefs, columnIds: null });
      return;
    }
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

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
            className="fixed z-[80] max-h-[min(70vh,calc(100vh-1rem))] overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-overlay p-2.5 shadow-panel"
          >
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
                    checked={selectedColumns.has(f.id)}
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
          </div>,
          document.body,
        )
      : null;

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
        {(columnCount > 0 || filterCount > 0) && (
          <span className="rounded bg-accent/15 px-1 text-[9px] tabular-nums text-accent">
            {columnCount + filterCount}
          </span>
        )}
      </button>
      {panel}
    </div>
  );
}
