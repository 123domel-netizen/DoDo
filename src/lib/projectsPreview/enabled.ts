/**
 * Build-time gate for PROJECTS PREVIEW.
 * Production builds without VITE_PROJECTS_PREVIEW=1 must tree-shake this module away.
 */
export function isProjectsPreviewEnabled(): boolean {
  return import.meta.env.VITE_PROJECTS_PREVIEW === "1";
}
