import type { CrewAttendance, PreviewCrew } from "./types";

/** Liczba dni z wpisem obecności per brygada. */
export function crewAttendanceUsageDays(
  attendance: CrewAttendance[],
): Map<string, number> {
  const daysByCrew = new Map<string, Set<string>>();
  for (const row of attendance) {
    if (!row.crewId) continue;
    let set = daysByCrew.get(row.crewId);
    if (!set) {
      set = new Set();
      daysByCrew.set(row.crewId, set);
    }
    set.add(row.workDate);
  }
  const out = new Map<string, number>();
  for (const [crewId, days] of daysByCrew) {
    out.set(crewId, days.size);
  }
  return out;
}

/** Brygady najczęściej używane w obecnościach — na górze list wyboru. */
export function sortCrewsByAttendanceUsage<
  T extends Pick<PreviewCrew, "id" | "name">,
>(crews: T[], attendance: CrewAttendance[]): T[] {
  const usage = crewAttendanceUsageDays(attendance);
  return crews.slice().sort((a, b) => {
    const diff = (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0);
    if (diff !== 0) return diff;
    return (a.name || "").localeCompare(b.name || "", "pl");
  });
}
