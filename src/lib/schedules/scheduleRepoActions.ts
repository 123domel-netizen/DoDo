import type { ScheduleRepository } from "./scheduleRepositoryPort";
import {
  SupabaseScheduleRepository,
} from "./supabaseScheduleRepository";

export async function scheduleCreateProject(
  repo: ScheduleRepository,
  input: Parameters<ScheduleRepository["createProject"]>[0],
): Promise<{ ok: true; project: import("@/lib/projectsPreview/types").PreviewProject } | { ok: false; error: string }> {
  if (repo.mode === "cloud") {
    return (repo as SupabaseScheduleRepository).createProjectSync(input);
  }
  return repo.createProject(input);
}

export async function scheduleImportProjects(
  repo: ScheduleRepository,
  rows: { number: string; name: string }[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (repo.mode === "cloud") {
    return (repo as SupabaseScheduleRepository).importProjectsSync(rows);
  }
  return repo.importProjects(rows);
}

export async function scheduleUpdateProject(
  repo: ScheduleRepository,
  id: string,
  patch: Parameters<ScheduleRepository["updateProject"]>[1],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (repo.mode === "cloud") {
    return (repo as SupabaseScheduleRepository).updateProjectSync(id, patch);
  }
  return repo.updateProject(id, patch);
}
