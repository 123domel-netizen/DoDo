import { FolderOpen, MessagesSquare, X } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { PROJECT_KIND_LABEL, projectLabel } from "@/lib/projectsPreview/types";

interface ProjectChipPanelProps {
  projectId: string;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  onFilterMessages: (projectId: string) => void;
}

export function ProjectChipPanel({
  projectId,
  onClose,
  onOpenProject,
  onFilterMessages,
}: ProjectChipPanelProps) {
  const repo = useProjectsPreviewRepo();
  const project = repo.getProjectIfVisible(projectId);

  if (!project) {
    return (
      <div className="rounded-xl border border-line bg-surface-overlay p-3 shadow-pop">
        <p className="text-sm text-ink-faint">Projekt niedostępny lub ukryty.</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 text-xs text-accent hover:underline"
        >
          Zamknij
        </button>
      </div>
    );
  }

  const members = project.memberIds
    .map((id) => repo.userName(id))
    .filter(Boolean)
    .join(", ");

  return (
    <div className="w-full max-w-sm rounded-xl border border-line bg-surface-overlay p-3 shadow-pop">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">
            {projectLabel(project)}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">
            Rodzaj: {PROJECT_KIND_LABEL[project.kind]}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-light">
            Uczestnicy: {members || "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-faint hover:text-ink"
          aria-label="Zamknij panel"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <button
          type="button"
          onClick={() => onOpenProject(project.id)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-line-strong"
        >
          <FolderOpen size={13} />
          Otwórz projekt
        </button>
        <button
          type="button"
          onClick={() => onFilterMessages(project.id)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/25"
        >
          <MessagesSquare size={13} />
          Pokaż wiadomości
        </button>
      </div>
    </div>
  );
}
