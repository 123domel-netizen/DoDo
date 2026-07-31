/**
 * Toolbar / MobileShell import ONLY this file.
 * The heavy preview module is lazy-loaded; visibility gated inside ProjectsPreviewEntry.
 */
import { lazy, Suspense, type ComponentType } from "react";

type EntryProps = {
  variant?: "toolbar" | "mobileTab";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const LiveEntry: ComponentType<EntryProps> = lazy(() =>
  import("./ProjectsPreviewEntry").then((m) => ({
    default: m.ProjectsPreviewEntry,
  })),
);

const LivePanel: ComponentType<{ onClose: () => void }> = lazy(() =>
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

/** Full Harmonogramy UI in MobileShell main — bottom nav stays visible. */
export function ProjectsPreviewMobileHost({ onClose }: { onClose: () => void }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-surface text-sm text-ink-faint">
          Ładowanie harmonogramów…
        </div>
      }
    >
      <LivePanel onClose={onClose} />
    </Suspense>
  );
}
