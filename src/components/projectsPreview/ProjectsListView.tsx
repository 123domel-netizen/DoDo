import { useState } from "react";
import {
  Archive,
  CalendarRange,
  ClipboardList,
  MessagesSquare,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  PROJECT_KIND_LABEL,
  projectLabel,
  type ProjectKind,
  type ProjectStatus,
} from "@/lib/projectsPreview/types";
import { BulkImportDialog } from "./BulkImportDialog";
import { ProjectFormDialog } from "./ProjectFormDialog";

interface ProjectsListViewProps {
  onOpenProject: (projectId: string) => void;
  onOpenToWrite: () => void;
  onOpenScheduleAll: () => void;
  onOpenSandboxChat: () => void;
}

const KIND_FILTERS: Array<{ id: ProjectKind | "all"; label: string }> = [
  { id: "all", label: "Wszystkie" },
  { id: "nadzor", label: "Nadzór" },
  { id: "budowa", label: "Budowa" },
  { id: "projektowanie", label: "Projektowanie" },
  { id: "inny", label: "Inny" },
];

export function ProjectsListView({
  onOpenProject,
  onOpenToWrite,
  onOpenScheduleAll,
  onOpenSandboxChat,
}: ProjectsListViewProps) {
  const repo = useProjectsPreviewRepo();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ProjectKind | "all">("all");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const projects = repo.visibleProjectList({ kind, status, query });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-line px-3 py-3 sm:px-4">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj po numerze lub nazwie…"
            className="w-full rounded-lg border border-line bg-surface-raised py-2 pl-8 pr-3 text-sm text-ink outline-none focus:border-line-strong"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setKind(f.id)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                kind === f.id
                  ? "bg-accent/15 text-accent"
                  : "text-ink-faint hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="mx-1 self-center text-line">|</span>
          <button
            type="button"
            onClick={() => setStatus("active")}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
              status === "active"
                ? "bg-accent/15 text-accent"
                : "text-ink-faint hover:bg-surface-raised hover:text-ink"
            }`}
          >
            Aktywne
          </button>
          <button
            type="button"
            onClick={() => setStatus("archived")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
              status === "archived"
                ? "bg-accent/15 text-accent"
                : "text-ink-faint hover:bg-surface-raised hover:text-ink"
            }`}
          >
            <Archive size={11} />
            Archiwalne
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <Plus size={15} />
            Dodaj projekt
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink transition hover:border-line-strong"
          >
            <Upload size={14} />
            Dodaj zbiorczo
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <QuickLink
            icon={<ClipboardList size={13} />}
            label="Do wpisania"
            onClick={onOpenToWrite}
          />
          <QuickLink
            icon={<CalendarRange size={13} />}
            label="Plan wszystkich budów"
            onClick={onOpenScheduleAll}
          />
          <QuickLink
            icon={<MessagesSquare size={13} />}
            label="Czat demo"
            onClick={onOpenSandboxChat}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {projects.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-faint">
            Brak projektów spełniających kryteria.
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-surface-raised/60 sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">
                      {projectLabel(p)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-faint">
                      {PROJECT_KIND_LABEL[p.kind]}
                      {" · "}
                      {p.memberIds.length}{" "}
                      {p.memberIds.length === 1
                        ? "uczestnik"
                        : p.memberIds.length < 5
                          ? "uczestników"
                          : "uczestników"}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProjectFormDialog open={formOpen} onClose={() => setFormOpen(false)} />
      <BulkImportDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

function QuickLink({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-line/80 px-2 py-1 font-medium text-ink-light transition hover:border-accent/40 hover:text-accent"
    >
      {icon}
      {label}
    </button>
  );
}
