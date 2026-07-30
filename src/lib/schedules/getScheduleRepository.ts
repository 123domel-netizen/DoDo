import { isProjectsPreviewEnabled } from "@/lib/projectsPreview/enabled";
import {
  getProjectsPreviewRepo,
  LocalPreviewAdapter,
  type ProjectsPreviewRepository,
} from "@/lib/projectsPreview/repository";
import { cloudEnabled } from "@/lib/supabase";
import type { ScheduleRepository } from "./scheduleRepositoryPort";
import {
  getSupabaseScheduleRepo,
  resetSupabaseScheduleRepo,
} from "./supabaseScheduleRepository";

/**
 * Active schedule repository.
 * - Cloud when logged in to an org (shared team data via Supabase)
 * - LocalAdapter for DEV without session / preview sandbox / no cloud config
 */
export function getScheduleRepository(opts?: {
  orgId?: string | null;
  /** @deprecated Ignored — cloud is used whenever org + user session exist. */
  schedulesEnabled?: boolean;
  userId?: string | null;
}): ScheduleRepository {
  if (
    cloudEnabled &&
    opts?.orgId &&
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
