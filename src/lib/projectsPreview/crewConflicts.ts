import type { ScheduleBlock } from "./types";

export type CrewConflict = {
  crewId: string;
  a: ScheduleBlock;
  b: ScheduleBlock;
};

function overlaps(a: ScheduleBlock, b: ScheduleBlock): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** Same crew scheduled on overlapping dates across (possibly different) projects. */
export function findCrewConflicts(blocks: ScheduleBlock[]): CrewConflict[] {
  const out: CrewConflict[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.crewId !== b.crewId) continue;
      if (a.id === b.id) continue;
      if (overlaps(a, b)) out.push({ crewId: a.crewId, a, b });
    }
  }
  return out;
}
