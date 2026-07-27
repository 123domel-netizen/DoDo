import { ArrowLeft, ClipboardList } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { projectLabel } from "@/lib/projectsPreview/types";

interface ToWriteQueueViewProps {
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
}

export function ToWriteQueueView({ onBack, onOpenProject }: ToWriteQueueViewProps) {
  const repo = useProjectsPreviewRepo();
  const items = repo.listToWrite();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Wróć"
        >
          <ArrowLeft size={18} />
        </button>
        <ClipboardList size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-ink">Do wpisania</h2>
        <span className="rounded-md bg-surface-raised px-1.5 py-0.5 text-[10px] text-ink-faint">
          {items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-faint">
            Brak pozycji do wpisania w widocznych projektach nadzoru.
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {items.map((it) => {
              const label = it.customLabel?.trim() || it.activity;
              const note = it.note?.trim();
              const title = note || label;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProject(it.projectId)}
                    className="flex w-full flex-col gap-0.5 px-3 py-3 text-left transition hover:bg-surface-raised/60 sm:px-4"
                  >
                    <span className="text-sm text-ink">
                      {it.project ? (
                        <span className="font-semibold text-accent">
                          #{it.project.number}
                        </span>
                      ) : (
                        <span className="font-semibold text-ink-faint">#?</span>
                      )}
                      {" · "}
                      {title}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {it.project ? projectLabel(it.project) : "Projekt"}
                      {it.noticedAt ? ` · zauważono ${it.noticedAt}` : ""}
                      {it.reportedByUserId
                        ? ` · ${repo.userName(it.reportedByUserId)}`
                        : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
