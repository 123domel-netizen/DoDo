/**
 * Toolbar / MobileShell import ONLY this file.
 * When VITE_PROJECTS_PREVIEW !== "1", the heavy preview module is not pulled in.
 */
import { lazy, Suspense, type ComponentType } from "react";

type EntryProps = { variant?: "toolbar" | "mobileTab" };

const LiveEntry: ComponentType<EntryProps> | null =
  import.meta.env.VITE_PROJECTS_PREVIEW === "1"
    ? lazy(() =>
        import("./ProjectsPreviewEntry").then((m) => ({
          default: m.ProjectsPreviewEntry,
        })),
      )
    : null;

export function ProjectsPreviewNavButton(props: EntryProps) {
  if (!LiveEntry) return null;
  return (
    <Suspense fallback={null}>
      <LiveEntry {...props} />
    </Suspense>
  );
}
