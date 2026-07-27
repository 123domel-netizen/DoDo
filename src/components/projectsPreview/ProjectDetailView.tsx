import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  CalendarRange,
  ClipboardCheck,
  MessagesSquare,
  Pencil,
  Users,
} from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  PROJECT_KIND_LABEL,
  projectLabel,
  type PreviewProject,
} from "@/lib/projectsPreview/types";
import { ProjectChip } from "./ProjectChip";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { ScheduleTab } from "./ScheduleTab";
import { SupervisionTab } from "./SupervisionTab";

type DetailTab = "overview" | "messages" | "supervision" | "schedule";

interface ProjectDetailViewProps {
  projectId: string;
  onBack: () => void;
  onOpenSandboxFiltered: (projectId: string) => void;
  onOpenCatalog: () => void;
}

export function ProjectDetailView({
  projectId,
  onBack,
  onOpenSandboxFiltered,
  onOpenCatalog,
}: ProjectDetailViewProps) {
  const repo = useProjectsPreviewRepo();
  const project = repo.getProjectIfVisible(projectId);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [editOpen, setEditOpen] = useState(false);

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-ink-faint">
          Projekt niedostępny lub ukryty dla bieżącego użytkownika.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-accent hover:underline"
        >
          Wróć do listy
        </button>
      </div>
    );
  }

  const tabs = tabsForKind(project);
  const active = tabs.some((t) => t.id === tab) ? tab : "overview";
  const isAdmin = project.adminUserId === repo.getState().viewAsUserId;
  const messages = repo.listMessages(project.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2.5 sm:px-4">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            className="mt-0.5 rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            aria-label="Wróć"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-ink">
              {projectLabel(project)}
            </h2>
            <p className="text-[12px] text-ink-faint">
              {PROJECT_KIND_LABEL[project.kind]}
              {project.status === "archived" ? " · archiwum" : ""}
            </p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="rounded-md p-1.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
              aria-label="Edytuj"
            >
              <Pencil size={16} />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex gap-1 overflow-x-auto thin-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition ${
                active === t.id
                  ? "bg-accent/15 text-accent"
                  : "text-ink-faint hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {active === "overview" ? (
          <OverviewTab
            project={project}
            isAdmin={isAdmin}
            onArchive={() =>
              repo.updateProject(project.id, {
                status: project.status === "active" ? "archived" : "active",
              })
            }
            onOpenCatalog={
              project.kind === "nadzor" ? onOpenCatalog : undefined
            }
          />
        ) : null}
        {active === "messages" ? (
          <div className="space-y-3 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-ink-faint">
                Wiadomości oznaczone tym projektem (sandbox).
              </p>
              <button
                type="button"
                onClick={() => onOpenSandboxFiltered(project.id)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Otwórz czat demo
              </button>
            </div>
            {messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-faint">
                Brak oznaczonych wiadomości.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-line/70 px-3 py-2"
                >
                  <div className="mb-1 text-[11px] text-ink-faint">
                    {repo.userName(m.authorUserId)} ·{" "}
                    {new Date(m.createdAt).toLocaleString("pl-PL", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </div>
                  <p className="text-sm text-ink">{m.body}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.projectRefs.map((r) => (
                      <ProjectChip key={r.entityId} refEntity={r} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
        {active === "supervision" ? (
          <SupervisionTab projectId={project.id} />
        ) : null}
        {active === "schedule" ? (
          <ScheduleTab projectId={project.id} />
        ) : null}
      </div>

      <ProjectFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project}
      />
    </div>
  );
}

function OverviewTab({
  project,
  isAdmin,
  onArchive,
  onOpenCatalog,
}: {
  project: PreviewProject;
  isAdmin: boolean;
  onArchive: () => void;
  onOpenCatalog?: () => void;
}) {
  const repo = useProjectsPreviewRepo();
  return (
    <div className="space-y-4 p-3 sm:p-4">
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <Users size={13} />
          Uczestnicy
        </h3>
        <ul className="space-y-1">
          {project.memberIds.map((id) => (
            <li
              key={id}
              className="flex items-center justify-between rounded-lg border border-line/60 px-3 py-2 text-sm text-ink"
            >
              <span>{repo.userName(id)}</span>
              {id === project.adminUserId ? (
                <span className="text-[10px] text-ink-faint">admin</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="text-[12px] text-ink-faint">
        Utworzono:{" "}
        {new Date(project.createdAt).toLocaleDateString("pl-PL")}
      </section>

      {onOpenCatalog ? (
        <button
          type="button"
          onClick={onOpenCatalog}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        >
          <BookOpen size={13} />
          Katalog czynności nadzoru
        </button>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          onClick={onArchive}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        >
          <Archive size={13} />
          {project.status === "active"
            ? "Archiwizuj projekt"
            : "Przywróć z archiwum"}
        </button>
      ) : null}
    </div>
  );
}

function tabsForKind(project: PreviewProject): Array<{
  id: DetailTab;
  label: string;
  icon: React.ReactNode;
}> {
  const base: Array<{ id: DetailTab; label: string; icon: React.ReactNode }> = [
    { id: "overview", label: "Przegląd", icon: <Users size={13} /> },
    {
      id: "messages",
      label: "Wiadomości",
      icon: <MessagesSquare size={13} />,
    },
  ];
  if (project.kind === "nadzor") {
    base.push({
      id: "supervision",
      label: "Czynności",
      icon: <ClipboardCheck size={13} />,
    });
  }
  if (project.kind === "budowa") {
    base.push({
      id: "schedule",
      label: "Plan prac",
      icon: <CalendarRange size={13} />,
    });
  }
  return base;
}
