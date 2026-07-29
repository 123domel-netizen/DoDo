import { useMemo, useState } from "react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { formatEventDate } from "@/lib/projectsPreview/projectLastEvent";
import { normalizeSearchText } from "@/lib/projectsPreview/normalize";
import {
  projectNextDeadline,
  projectStageLabel,
} from "@/lib/projectsPreview/projectMetrics";
import { PROJECT_STATUS_LABEL, type PreviewProject } from "@/lib/projectsPreview/types";
import { BulkImportDialog } from "./BulkImportDialog";
import { ProjectFormDialog } from "./ProjectFormDialog";

interface ProjectsListViewProps {
  /** Archiwum toggle lives in the module header. */
  showArchived: boolean;
  formOpen: boolean;
  bulkOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
  onBulkOpenChange: (open: boolean) => void;
}

const COLUMN_COUNT = 5;

/** Kolumnowa tabela budów: etap, termin, ostatnie zdarzenie. */
export function ProjectsListView({
  showArchived,
  formOpen,
  bulkOpen,
  onFormOpenChange,
  onBulkOpenChange,
}: ProjectsListViewProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const [filterNumber, setFilterNumber] = useState("");
  const [filterName, setFilterName] = useState("");
  const [editingProject, setEditingProject] = useState<PreviewProject | null>(
    null,
  );

  const projects = useMemo(() => {
    let list = repo.visibleProjectList({
      status: showArchived ? "all" : "active",
    });
    const numQ = filterNumber.trim();
    if (numQ) {
      list = list.filter((p) => String(p.number).includes(numQ));
    }
    const nameQ = normalizeSearchText(filterName);
    if (nameQ) {
      list = list.filter((p) => normalizeSearchText(p.name).includes(nameQ));
    }
    return list;
  }, [
    repo,
    state.projects,
    state.viewAsUserId,
    filterNumber,
    filterName,
    showArchived,
  ]);

  const filterInput =
    "w-full min-w-0 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-line-strong";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto thin-scrollbar">
        <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface-raised/95 backdrop-blur-sm">
            <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="w-[4rem] px-2 py-1">Numer</th>
              <th className="min-w-[10rem] px-1.5 py-1">Nazwa</th>
              <th className="w-[9rem] px-1.5 py-1">Etap</th>
              <th className="w-[6.5rem] px-1.5 py-1">Termin</th>
              <th className="min-w-[11rem] px-1.5 py-1">Ostatnie</th>
            </tr>
            <tr className="border-b border-line bg-surface">
              <th className="px-2 pb-1 pt-0">
                <input
                  value={filterNumber}
                  onChange={(e) => setFilterNumber(e.target.value)}
                  placeholder="#"
                  inputMode="numeric"
                  className={filterInput}
                  aria-label="Filtruj numer"
                />
              </th>
              <th className="px-1.5 pb-1 pt-0">
                <input
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="Szukaj nazwy…"
                  className={filterInput}
                  aria-label="Filtruj nazwę"
                />
              </th>
              <th className="px-1.5 pb-1 pt-0" />
              <th className="px-1.5 pb-1 pt-0" />
              <th className="px-1.5 pb-1 pt-0" />
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMN_COUNT}
                  className="px-4 py-8 text-center text-sm text-ink-faint"
                >
                  Brak budów spełniających kryteria.
                </td>
              </tr>
            ) : (
              projects.map((p) => {
                const last = repo.getProjectLastEvent(p.id);
                const stage = projectStageLabel(
                  p.id,
                  state.scheduleBlocks,
                  state.scheduleCatalog,
                );
                const deadline = projectNextDeadline(p.id, state.scheduleBlocks);
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-line/50 transition hover:bg-surface-raised/50"
                    onClick={() => setEditingProject(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditingProject(p);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    title="Edytuj budowę"
                  >
                    <td className="whitespace-nowrap px-2 py-1 font-semibold tabular-nums text-accent">
                      #{p.number}
                    </td>
                    <td className="max-w-[14rem] truncate px-1.5 py-1 font-medium text-ink sm:max-w-none">
                      {p.name}
                      {p.status === "archived" ? (
                        <span className="ml-1.5 text-[10px] font-normal text-ink-faint">
                          ({PROJECT_STATUS_LABEL.archived})
                        </span>
                      ) : null}
                    </td>
                    <td
                      className="max-w-[9rem] truncate px-1.5 py-1 text-ink-light"
                      title={stage ?? undefined}
                    >
                      {stage ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1 text-ink-light">
                      {deadline ? formatEventDate(deadline) : "—"}
                    </td>
                    <td className="max-w-[14rem] truncate px-1.5 py-1 text-ink">
                      {last ? (
                        <span title={`${last.label} · ${formatEventDate(last.at)}`}>
                          {last.label}
                          <span className="ml-1.5 text-[10px] text-ink-faint">
                            {formatEventDate(last.at)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ProjectFormDialog
        open={formOpen}
        onClose={() => onFormOpenChange(false)}
      />
      <ProjectFormDialog
        open={editingProject != null}
        project={editingProject}
        onClose={() => setEditingProject(null)}
      />
      <BulkImportDialog
        open={bulkOpen}
        onClose={() => onBulkOpenChange(false)}
      />
    </div>
  );
}
