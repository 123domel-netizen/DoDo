import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarRange,
  Download,
  MoreVertical,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { CatalogView } from "./CatalogView";
import { PreviewAsSwitcher } from "./PreviewAsSwitcher";
import { ProjectDetailView } from "./ProjectDetailView";
import { ProjectsListView } from "./ProjectsListView";
import { ProjectsPreviewBanner } from "./ProjectsPreviewBanner";
import { SandboxChat } from "./SandboxChat";
import { ScheduleTab } from "./ScheduleTab";
import { ToWriteQueueView } from "./ToWriteQueueView";

export type ProjectsPreviewView =
  | { name: "list" }
  | { name: "detail"; projectId: string }
  | { name: "toWrite" }
  | { name: "catalog" }
  | { name: "scheduleAll" }
  | { name: "sandboxChat"; filterProjectId?: string | null };

interface ProjectsPreviewAppProps {
  onClose: () => void;
}

/**
 * Fullscreen overlay shell for DoDo PROJECTS PREVIEW.
 * Main entry — parent wires open/close; no production store writes.
 */
export function ProjectsPreviewApp({ onClose }: ProjectsPreviewAppProps) {
  const repo = useProjectsPreviewRepo();
  const [view, setView] = useState<ProjectsPreviewView>({ name: "list" });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        else if (view.name !== "list") setView({ name: "list" });
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, view.name, onClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const downloadExport = () => {
    const json = repo.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dodo-projects-preview-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  const showListChrome = view.name === "list";

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex flex-col bg-surface text-ink"
      role="dialog"
      aria-modal="true"
      aria-label="Projekty — preview"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-raised/50 px-2 py-2 sm:px-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
          aria-label="Zamknij"
        >
          <X size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-ink sm:text-base">
            Projekty
          </h1>
          <p className="truncate text-[10px] text-ink-faint">
            Preview · dane lokalne
            {!showListChrome ? ` · ${viewLabel(view)}` : ""}
          </p>
        </div>

        <PreviewAsSwitcher />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            aria-label="Narzędzia preview"
            aria-expanded={menuOpen}
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface-overlay py-1 shadow-pop">
              <MenuItem
                icon={<RotateCcw size={14} />}
                label="Resetuj dane demonstracyjne"
                onClick={() => {
                  if (
                    confirm(
                      "Przywrócić dane demonstracyjne? Lokalne zmiany preview zostaną nadpisane.",
                    )
                  ) {
                    repo.resetDemo();
                    setView({ name: "list" });
                  }
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                icon={<Sparkles size={14} />}
                label="Wczytaj przykładowe projekty"
                onClick={() => {
                  repo.loadDemoProjects();
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                icon={<Download size={14} />}
                label="Eksportuj JSON"
                onClick={downloadExport}
              />
              <div className="my-1 border-t border-line" />
              <MenuItem
                icon={<BookOpen size={14} />}
                label="Katalog czynności"
                onClick={() => {
                  setView({ name: "catalog" });
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                icon={<CalendarRange size={14} />}
                label="Plan wszystkich budów"
                onClick={() => {
                  setView({ name: "scheduleAll" });
                  setMenuOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {view.name === "list" ? (
          <ProjectsListView
            onOpenProject={(id) => setView({ name: "detail", projectId: id })}
            onOpenToWrite={() => setView({ name: "toWrite" })}
            onOpenScheduleAll={() => setView({ name: "scheduleAll" })}
            onOpenSandboxChat={() => setView({ name: "sandboxChat" })}
          />
        ) : null}
        {view.name === "detail" ? (
          <ProjectDetailView
            projectId={view.projectId}
            onBack={() => setView({ name: "list" })}
            onOpenSandboxFiltered={(id) =>
              setView({ name: "sandboxChat", filterProjectId: id })
            }
            onOpenCatalog={() => setView({ name: "catalog" })}
          />
        ) : null}
        {view.name === "toWrite" ? (
          <ToWriteQueueView
            onBack={() => setView({ name: "list" })}
            onOpenProject={(id) => setView({ name: "detail", projectId: id })}
          />
        ) : null}
        {view.name === "catalog" ? (
          <CatalogView onBack={() => setView({ name: "list" })} />
        ) : null}
        {view.name === "scheduleAll" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
              <button
                type="button"
                onClick={() => setView({ name: "list" })}
                className="rounded-md p-1.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
                aria-label="Wróć"
              >
                <ArrowLeft size={18} />
              </button>
              <CalendarRange size={15} className="text-accent" />
              <h2 className="text-sm font-semibold text-ink">
                Plan wszystkich budów
              </h2>
            </div>
            <div className="min-h-0 flex-1">
              <ScheduleTab showViewSwitcher />
            </div>
          </div>
        ) : null}
        {view.name === "sandboxChat" ? (
          <SandboxChat
            onBack={() => setView({ name: "list" })}
            onOpenProject={(id) => setView({ name: "detail", projectId: id })}
            initialFilterProjectId={view.filterProjectId ?? null}
          />
        ) : null}
      </main>

      <ProjectsPreviewBanner />
    </div>,
    document.body,
  );
}

function MenuItem({
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
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition hover:bg-surface-raised"
    >
      <span className="text-ink-faint">{icon}</span>
      {label}
    </button>
  );
}

function viewLabel(view: ProjectsPreviewView): string {
  switch (view.name) {
    case "detail":
      return "szczegóły";
    case "toWrite":
      return "do wpisania";
    case "catalog":
      return "katalog";
    case "scheduleAll":
      return "plan budów";
    case "sandboxChat":
      return "czat demo";
    default:
      return "lista";
  }
}

export { ProjectsPreviewBanner } from "./ProjectsPreviewBanner";
