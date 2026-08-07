/**
 * Toolbar / MobileShell import ONLY this file.
 * The heavy preview module is lazy-loaded; visibility gated inside ProjectsPreviewEntry.
 */
import { lazy, Suspense, type ComponentType } from "react";

type EntryProps = {
  variant?: "toolbar" | "mobileTab";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which schedules section to open (mobile + desktop entry). */
  section?: "board" | "attendance";
};

const LiveEntry: ComponentType<EntryProps> = lazy(() =>
  import("./ProjectsPreviewEntry").then((m) => ({
    default: m.ProjectsPreviewEntry,
  })),
);

const LivePanel: ComponentType<{
  onClose: () => void;
  initialSection?: "board" | "attendance";
}> = lazy(() =>
  import("./ProjectsPreviewEntry").then((m) => ({
    default: m.ProjectsPreviewMobilePanel,
  })),
);

export function ProjectsPreviewNavButton(props: EntryProps) {
  return (
    <Suspense fallback={null}>
      <LiveEntry {...props} />
    </Suspense>
  );
}

/** Full Harmonogramy / Obecności UI in MobileShell main — bottom nav stays visible. */
export function ProjectsPreviewMobileHost({
  onClose,
  initialSection = "board",
}: {
  onClose: () => void;
  initialSection?: "board" | "attendance";
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-surface text-sm text-ink-faint">
          Ładowanie…
        </div>
      }
    >
      <LivePanel onClose={onClose} initialSection={initialSection} />
    </Suspense>
  );
}
