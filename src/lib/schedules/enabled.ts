import { isProjectsPreviewEnabled } from "@/lib/projectsPreview/enabled";

/**
 * Harmonogramy są zawsze w UI (produkcja, DEV, sandbox).
 * Dane: LocalAdapter, albo cloud gdy org ma `schedules_enabled`
 * (patrz getScheduleRepository).
 */
export function isSchedulesModuleEnabled(_schedulesEnabled?: boolean): boolean {
  return true;
}

export function isSchedulesPreviewBuild(): boolean {
  return isProjectsPreviewEnabled();
}
