import type { CrewAttendanceSavePayload } from "@/components/projectsPreview/CrewAttendanceSheet";
import type { ScheduleRepository } from "@/lib/schedules/scheduleRepositoryPort";

/** Upsert per-budowa splits and delete leftover crew+day rows. */
export function applyCrewAttendanceSave(
  repo: Pick<
    ScheduleRepository,
    "upsertCrewAttendance" | "deleteCrewAttendance"
  >,
  data: CrewAttendanceSavePayload,
): void {
  const kept = new Set<string>();
  for (const split of data.splits) {
    const row = repo.upsertCrewAttendance({
      id: split.id,
      crewId: data.crewId,
      projectId: split.projectId,
      workDate: data.workDate,
      workers: split.workers,
      note: data.note,
      equipment: split.equipment,
    });
    kept.add(row.id);
  }
  for (const id of data.previousAttendanceIds) {
    if (!kept.has(id)) repo.deleteCrewAttendance(id);
  }
}
