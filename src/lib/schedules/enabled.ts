import { isProjectsPreviewEnabled } from "@/lib/projectsPreview/enabled";

/**
 * Harmonogramy widoczne gdy:
 * - flaga org `schedules_enabled`, lub
 * - lokalny DEV (`import.meta.env.DEV`), lub
 * - build sandbox `VITE_PROJECTS_PREVIEW=1`.
 *
 * Produkcyjny build bez flagi org = brak zakładki.
 */
export function isSchedulesModuleEnabled(schedulesEnabled?: boolean): boolean {
  return (
    Boolean(schedulesEnabled) ||
    import.meta.env.DEV ||
    isProjectsPreviewEnabled()
  );
}

export function isSchedulesPreviewBuild(): boolean {
  return isProjectsPreviewEnabled();
}
