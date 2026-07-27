import { Suspense, useState, type ComponentType } from "react";
import { FolderKanban } from "lucide-react";
import { isProjectsPreviewEnabled } from "@/lib/projectsPreview/enabled";

type AppProps = { onClose: () => void };

/**
 * Flag-gated entry. When VITE_PROJECTS_PREVIEW !== "1", Rollup DCE drops the
 * dynamic import of ProjectsPreviewApp so production alias stays clean.
 */
export function ProjectsPreviewEntry({
  variant = "toolbar",
}: {
  variant?: "toolbar" | "mobileTab";
}) {
  // Build-time constant — must stay as import.meta.env comparison for DCE.
  if (import.meta.env.VITE_PROJECTS_PREVIEW !== "1") {
    return null;
  }
  return <ProjectsPreviewEntryLive variant={variant} />;
}

function ProjectsPreviewEntryLive({
  variant,
}: {
  variant: "toolbar" | "mobileTab";
}) {
  const [open, setOpen] = useState(false);
  const [App, setApp] = useState<ComponentType<AppProps> | null>(null);

  const ensureApp = () => {
    setOpen(true);
    if (!App) {
      void import("./ProjectsPreviewApp").then((m) => {
        setApp(() => m.ProjectsPreviewApp);
      });
    }
  };

  const overlay =
    open && App ? (
      <Suspense fallback={null}>
        <App onClose={() => setOpen(false)} />
      </Suspense>
    ) : open ? (
      <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-surface text-sm text-ink-faint">
        Ładowanie preview…
      </div>
    ) : null;

  if (variant === "mobileTab") {
    return (
      <>
        <button
          type="button"
          onClick={ensureApp}
          className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] text-ink-faint transition hover:text-ink"
          aria-label="Projekty"
        >
          <FolderKanban size={20} strokeWidth={1.75} />
          Projekty
        </button>
        {overlay}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={ensureApp}
        className="rounded-lg px-2 py-1.5 text-xs font-medium text-ink-light transition hover:bg-surface-overlay hover:text-ink"
        aria-label="Projekty (preview)"
        title="Projekty — preview"
      >
        <span className="inline-flex items-center gap-1.5">
          <FolderKanban size={16} />
          Projekty
        </span>
      </button>
      {overlay}
    </>
  );
}

/** For tests: menu visible only with preview flag. */
export function projectsPreviewMenuVisible(): boolean {
  return isProjectsPreviewEnabled();
}
