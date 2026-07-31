import type { PreviewProject } from "./types";
import { isProjectVisibleTo } from "./search";

const STORAGE_PREFIX = "dodo-dashboard-schedules-collapsed-v1:";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

/** `null` = brak zapisu — stosuj domyślne. */
export function loadDashboardSchedulesCollapsed(
  userId: string | null | undefined,
): boolean | null {
  if (!userId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function saveDashboardSchedulesCollapsed(
  userId: string | null | undefined,
  collapsed: boolean,
): void {
  if (!userId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(userId), collapsed ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

/** Użytkownik należy do ≥1 aktywnej budowy. */
export function userBelongsToActiveProject(
  projects: PreviewProject[],
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return projects.some(
    (p) => p.status === "active" && isProjectVisibleTo(p, userId),
  );
}

/**
 * Domyślnie zwinięte, gdy użytkownik nie należy do żadnej budowy.
 * Jawny zapis w localStorage ma pierwszeństwo.
 */
export function resolveDashboardSchedulesCollapsed(opts: {
  userId: string | null | undefined;
  projects: PreviewProject[];
  stored: boolean | null;
}): boolean {
  if (opts.stored != null) return opts.stored;
  return !userBelongsToActiveProject(opts.projects, opts.userId);
}
