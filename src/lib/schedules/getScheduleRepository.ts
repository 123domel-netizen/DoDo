import { isProjectsPreviewEnabled } from "@/lib/projectsPreview/enabled";
import {
  getProjectsPreviewRepo,
  LocalPreviewAdapter,
  type ProjectsPreviewRepository,
} from "@/lib/projectsPreview/repository";
import type { ScheduleRepository } from "./scheduleRepositoryPort";
import {
  getSupabaseScheduleRepo,
  resetSupabaseScheduleRepo,
} from "./supabaseScheduleRepository";

/**
 * Active schedule repository.
 * - Cloud when org has schedules_enabled + auth session
 * - Otherwise LocalAdapter (empty + catalogs) for DEV / preview sandbox
 */
export function getScheduleRepository(opts?: {
  orgId?: string | null;
  schedulesEnabled?: boolean;
  userId?: string | null;
}): ScheduleRepository {
  if (
    opts?.schedulesEnabled &&
    opts.orgId &&
    opts.userId &&
    !isProjectsPreviewEnabled()
  ) {
    return getSupabaseScheduleRepo(opts.orgId, opts.userId);
  }
  return getProjectsPreviewRepo();
}

export function resetScheduleRepositoryForTests(
  local?: Parameters<
    typeof import("@/lib/projectsPreview/repository").resetProjectsPreviewRepoForTests
  >[0],
): ScheduleRepository {
  resetSupabaseScheduleRepo();
  return new LocalPreviewAdapter(local);
}

export type { ScheduleRepository, ProjectsPreviewRepository };
