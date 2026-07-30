import { isProjectsPreviewEnabled } from "@/lib/projectsPreview/enabled";

/**
 * Harmonogramy są zawsze w UI.
 * Dane: Supabase gdy jest sesja + org (patrz getScheduleRepository),
 * inaczej LocalAdapter.
 */
export function isSchedulesModuleEnabled(_schedulesEnabled?: boolean): boolean {
  return true;
}

export function isSchedulesPreviewBuild(): boolean {
  return isProjectsPreviewEnabled();
}
