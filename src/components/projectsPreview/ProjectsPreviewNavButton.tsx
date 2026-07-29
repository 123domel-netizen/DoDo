/**
 * Toolbar / MobileShell import ONLY this file.
 * The heavy preview module is lazy-loaded; visibility gated inside ProjectsPreviewEntry.
 */
import { lazy, Suspense, type ComponentType } from "react";

type EntryProps = { variant?: "toolbar" | "mobileTab" };

const LiveEntry: ComponentType<EntryProps> = lazy(() =>
  import("./ProjectsPreviewEntry").then((m) => ({
    default: m.ProjectsPreviewEntry,
  })),
);

export function ProjectsPreviewNavButton(props: EntryProps) {
  return (
    <Suspense fallback={null}>
      <LiveEntry {...props} />
    </Suspense>
  );
}
