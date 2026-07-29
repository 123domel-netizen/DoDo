import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import type { SupervisionCatalogCategory } from "@/lib/projectsPreview/types";

interface CatalogViewProps {
  onBack: () => void;
}

export function CatalogView({ onBack }: CatalogViewProps) {
  const repo = useProjectsPreviewRepo();
  const catalog = repo.getState().catalog;
  const [draftByCat, setDraftByCat] = useState<Record<string, string>>({});

  const setCategories = (categories: SupervisionCatalogCategory[]) => {
    repo.updateSupervisionCatalog(categories);
  };

  const addActivity = (catId: string) => {
    const raw = (draftByCat[catId] ?? "").trim();
    if (!raw) return;
    const categories = catalog.categories.map((c) => {
      if (c.id !== catId) return c;
      if (c.activities.some((a) => a.toLowerCase() === raw.toLowerCase())) return c;
      const withoutInny = c.activities.filter((a) => a !== "Inny");
      return { ...c, activities: [...withoutInny, raw, "Inny"] };
    });
    setCategories(categories);
    setDraftByCat((d) => ({ ...d, [catId]: "" }));
  };

  const moveActivity = (catId: string, index: number, dir: -1 | 1) => {
    const categories = catalog.categories.map((c) => {
      if (c.id !== catId) return c;
      const acts = c.activities.slice();
      const j = index + dir;
      if (j < 0 || j >= acts.length) return c;
      if (acts[index] === "Inny" || acts[j] === "Inny") return c;
      const tmp = acts[index]!;
      acts[index] = acts[j]!;
      acts[j] = tmp;
      return { ...c, activities: acts };
    });
    setCategories(categories);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Wróć"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{catalog.name}</h2>
          <p className="text-[11px] text-ink-faint">Czynności dokumentacyjne zespołu</p>
        </div>
        <button
          type="button"
          onClick={() => repo.resetCatalogPreset()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        >
          <RotateCcw size={13} />
          Resetuj do presetu
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto thin-scrollbar p-3 sm:p-4">
        {catalog.categories
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((cat) => (
            <section key={cat.id} className="rounded-xl border border-line">
              <h3 className="border-b border-line bg-surface-raised/40 px-3 py-2 text-sm font-semibold text-ink">
                {cat.title}
              </h3>
              <ul className="divide-y divide-line/60">
                {cat.activities.map((act, idx) => (
                  <li
                    key={`${cat.id}-${act}-${idx}`}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink"
                  >
                    <span className="min-w-0 flex-1 truncate">{act}</span>
                    {act !== "Inny" ? (
                      <span className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveActivity(cat.id, idx, -1)}
                          className="rounded p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
                          aria-label="W górę"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveActivity(cat.id, idx, 1)}
                          className="rounded p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
                          aria-label="W dół"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 border-t border-line p-2">
                <input
                  value={draftByCat[cat.id] ?? ""}
                  onChange={(e) =>
                    setDraftByCat((d) => ({ ...d, [cat.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addActivity(cat.id);
                  }}
                  placeholder="Dodaj lokalną czynność…"
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-line-strong"
                />
                <button
                  type="button"
                  onClick={() => addActivity(cat.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1.5 text-xs font-medium text-accent"
                >
                  <Plus size={13} />
                  Dodaj
                </button>
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
