import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, PenLine } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  SUPERVISION_STATUS_LABEL,
  type SupervisionItem,
  type SupervisionItemStatus,
} from "@/lib/projectsPreview/types";

interface SupervisionTabProps {
  projectId: string;
}

const STATUSES = Object.keys(SUPERVISION_STATUS_LABEL) as SupervisionItemStatus[];

export function SupervisionTab({ projectId }: SupervisionTabProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const items = repo.listSupervision(projectId);
  const categories = state.catalog.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const [openCats, setOpenCats] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, true])),
  );

  const byKey = useMemo(() => {
    const map = new Map<string, SupervisionItem>();
    for (const it of items) {
      map.set(`${it.categoryId}::${it.activity}`, it);
    }
    return map;
  }, [items]);

  const toggleCat = (id: string) =>
    setOpenCats((prev) => ({ ...prev, [id]: !prev[id] }));

  const ensureItem = (
    categoryId: string,
    activity: string,
    existing?: SupervisionItem,
  ): SupervisionItem => {
    if (existing) return existing;
    return repo.upsertSupervisionItem({
      projectId,
      categoryId,
      activity,
      status: "brak",
      noticedAt: null,
      note: "",
      reportedByUserId: null,
      writtenAt: null,
      writtenByUserId: null,
    });
  };

  return (
    <div className="space-y-2 p-3 sm:p-4">
      <p className="text-xs text-ink-faint">
        Lista kontrolna nadzoru — nie jest cyfrowym dziennikiem budowy.
      </p>
      {categories.map((cat) => {
        const open = openCats[cat.id] !== false;
        return (
          <section
            key={cat.id}
            className="overflow-hidden rounded-xl border border-line"
          >
            <button
              type="button"
              onClick={() => toggleCat(cat.id)}
              className="flex w-full items-center gap-2 bg-surface-raised/50 px-3 py-2.5 text-left text-sm font-semibold text-ink"
            >
              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span className="min-w-0 flex-1 truncate">{cat.title}</span>
              <span className="text-[10px] font-normal text-ink-faint">
                {cat.activities.length}
              </span>
            </button>
            {open ? (
              <ul className="divide-y divide-line/60">
                {cat.activities.map((activity) => {
                  const existing = byKey.get(`${cat.id}::${activity}`);
                  const status = existing?.status ?? "brak";
                  const isInny = activity === "Inny";
                  return (
                    <li key={activity} className="px-3 py-2.5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink">
                            {activity}
                          </div>
                          {isInny ? (
                            <input
                              value={existing?.customLabel ?? ""}
                              onChange={(e) => {
                                const item = ensureItem(cat.id, activity, existing);
                                repo.upsertSupervisionItem({
                                  ...item,
                                  customLabel: e.target.value,
                                });
                              }}
                              placeholder="Własny opis czynności…"
                              className="mt-1.5 w-full rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-line-strong"
                            />
                          ) : null}
                          {existing?.note ? (
                            <p className="mt-1 text-[11px] text-ink-faint">
                              {existing.note}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            value={status}
                            onChange={(e) => {
                              const next = e.target.value as SupervisionItemStatus;
                              const item = ensureItem(cat.id, activity, existing);
                              repo.setSupervisionStatus(item.id, next);
                            }}
                            className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-line-strong"
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {SUPERVISION_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                          {status === "do_wpisania" ? (
                            <button
                              type="button"
                              onClick={() => {
                                const item = ensureItem(cat.id, activity, existing);
                                repo.setSupervisionStatus(item.id, "wpisane");
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1.5 text-[11px] font-medium text-accent transition hover:bg-accent/25"
                            >
                              <PenLine size={12} />
                              Oznacz wpisane
                            </button>
                          ) : null}
                          {status === "wpisane" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                              <Check size={12} />
                              {existing?.writtenAt ?? ""}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
