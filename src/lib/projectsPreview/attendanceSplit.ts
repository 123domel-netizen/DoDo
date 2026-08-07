import { totalLaborHours } from "./workerShifts";
import type { CrewWorkerShift } from "./types";

export type AttendanceWorkerLine = {
  id?: string;
  startTime: string;
  endTime: string;
  /** Opis osoby (Majster / Uczeń / własne). */
  label?: string | null;
  /** Empty / null = use defaultProjectId. */
  projectId?: string | null;
};

export type AttendanceEquipmentLine = {
  id?: string;
  equipmentKey: string;
  equipmentLabel: string;
  quantity: number;
  hours: number;
  /** Empty / null = use defaultProjectId. */
  projectId?: string | null;
};

export type AttendanceProjectSplit = {
  id?: string;
  projectId: string;
  workers: CrewWorkerShift[];
  equipment: Array<{
    id?: string;
    equipmentKey: string;
    equipmentLabel: string;
    quantity: number;
    hours: number;
  }>;
  headcount: number;
  laborHours: number;
};

export function effectiveProjectId(
  override: string | null | undefined,
  defaultProjectId: string,
): string {
  const t = (override ?? "").trim();
  return t || defaultProjectId;
}

/**
 * Group people + equipment by effective budowa for multi-row upsert.
 * Workers stored without projectId (row already scoped to project).
 */
export function splitAttendanceByProject(opts: {
  defaultProjectId: string;
  workers: AttendanceWorkerLine[];
  equipment: AttendanceEquipmentLine[];
  /** Existing attendance id per projectId for this crew+day. */
  existingIdByProject?: Record<string, string>;
}): AttendanceProjectSplit[] {
  const { defaultProjectId, workers, equipment, existingIdByProject = {} } =
    opts;
  const map = new Map<
    string,
    {
      workers: CrewWorkerShift[];
      equipment: AttendanceProjectSplit["equipment"];
    }
  >();

  const ensure = (projectId: string) => {
    let g = map.get(projectId);
    if (!g) {
      g = { workers: [], equipment: [] };
      map.set(projectId, g);
    }
    return g;
  };

  // Always keep the default project row if anything references it or it's the form default
  // (even empty — caller may skip empty groups).
  for (const w of workers) {
    const pid = effectiveProjectId(w.projectId, defaultProjectId);
    const label = (w.label ?? "").trim();
    ensure(pid).workers.push({
      id: w.id ?? `w-${Math.random().toString(36).slice(2, 9)}`,
      startTime: w.startTime,
      endTime: w.endTime,
      label: label || null,
    });
  }
  for (const e of equipment) {
    const pid = effectiveProjectId(e.projectId, defaultProjectId);
    ensure(pid).equipment.push({
      id: e.id,
      equipmentKey: e.equipmentKey,
      equipmentLabel: e.equipmentLabel,
      quantity: e.quantity,
      hours: e.hours,
    });
  }

  // If nothing was added, still produce default empty split for "clear day" callers.
  if (map.size === 0) {
    ensure(defaultProjectId);
  }

  return [...map.entries()]
    .filter(
      ([, g]) => g.workers.length > 0 || g.equipment.length > 0,
    )
    .map(([projectId, g]) => ({
      id: existingIdByProject[projectId],
      projectId,
      workers: g.workers,
      equipment: g.equipment,
      headcount: g.workers.length,
      laborHours: totalLaborHours(g.workers),
    }));
}
