import type {
  CrewAttendance,
  CrewAttendanceStatus,
  CrewEquipmentLog,
  PreviewCrew,
} from "./types";

export type AttendanceDayCell = {
  headcount: number;
  laborHours: number;
  equipmentHours: number;
  equipmentQty: number;
  attendanceIds: string[];
  /** All rows for the day are confirmed (and there is at least one). */
  allConfirmed: boolean;
  /** At least one declared (not confirmed) row. */
  hasDeclared: boolean;
};

/** @deprecated Use AttendanceDayCell */
export type CompanyDayCell = AttendanceDayCell;

export type CrewAttendanceBoardRow = {
  crewId: string;
  crewLabel: string;
  company: string;
  days: Record<string, AttendanceDayCell>;
};

/** @deprecated Use CrewAttendanceBoardRow */
export type CompanyAttendanceRow = {
  companyKey: string;
  companyLabel: string;
  crewIds: string[];
  days: Record<string, AttendanceDayCell>;
};

function emptyCell(): AttendanceDayCell {
  return {
    headcount: 0,
    laborHours: 0,
    equipmentHours: 0,
    equipmentQty: 0,
    attendanceIds: [],
    allConfirmed: false,
    hasDeclared: false,
  };
}

/**
 * Aggregate attendance into brigade (crew) × day cells for the board.
 */
export function aggregateAttendanceByCrew(
  attendance: CrewAttendance[],
  equipment: CrewEquipmentLog[],
  crews: PreviewCrew[],
  days: string[],
  opts?: {
    projectIds?: string[] | "all";
  },
): CrewAttendanceBoardRow[] {
  const daySet = new Set(days);
  const projectFilter =
    opts?.projectIds && opts.projectIds !== "all"
      ? new Set(opts.projectIds)
      : null;

  const equipByAttendance = new Map<string, CrewEquipmentLog[]>();
  for (const e of equipment) {
    const list = equipByAttendance.get(e.attendanceId) ?? [];
    list.push(e);
    equipByAttendance.set(e.attendanceId, list);
  }

  const byCrew = new Map<
    string,
    {
      label: string;
      company: string;
      days: Map<string, AttendanceDayCell>;
    }
  >();

  for (const crew of crews) {
    byCrew.set(crew.id, {
      label: crew.name || "Bez nazwy",
      company: crew.company.trim(),
      days: new Map(),
    });
  }

  for (const row of attendance) {
    if (!daySet.has(row.workDate)) continue;
    if (projectFilter && !projectFilter.has(row.projectId)) continue;
    const g = byCrew.get(row.crewId);
    if (!g) continue;
    let cell = g.days.get(row.workDate);
    if (!cell) {
      cell = {
        headcount: 0,
        laborHours: 0,
        equipmentHours: 0,
        equipmentQty: 0,
        attendanceIds: [],
        allConfirmed: true,
        hasDeclared: false,
      };
      g.days.set(row.workDate, cell);
    }
    cell.headcount += row.headcount;
    cell.laborHours += row.laborHours;
    cell.attendanceIds.push(row.id);
    const status: CrewAttendanceStatus = row.status;
    if (status === "declared") {
      cell.hasDeclared = true;
      cell.allConfirmed = false;
    }
    const logs = equipByAttendance.get(row.id) ?? [];
    for (const log of logs) {
      cell.equipmentHours += log.hours;
      cell.equipmentQty += log.quantity;
    }
  }

  return [...byCrew.entries()]
    .map(([crewId, g]) => {
      const dayMap: Record<string, AttendanceDayCell> = {};
      for (const d of days) {
        const cell = g.days.get(d);
        if (!cell || cell.attendanceIds.length === 0) {
          dayMap[d] = emptyCell();
        } else {
          dayMap[d] = {
            ...cell,
            allConfirmed: cell.allConfirmed && !cell.hasDeclared,
          };
        }
      }
      return {
        crewId,
        crewLabel: g.label,
        company: g.company,
        days: dayMap,
      };
    })
    .sort((a, b) => a.crewLabel.localeCompare(b.crewLabel, "pl"));
}

/** @deprecated Prefer aggregateAttendanceByCrew */
export function aggregateAttendanceByCompany(
  attendance: CrewAttendance[],
  equipment: CrewEquipmentLog[],
  crews: PreviewCrew[],
  days: string[],
  opts?: {
    projectIds?: string[] | "all";
  },
): CompanyAttendanceRow[] {
  return aggregateAttendanceByCrew(
    attendance,
    equipment,
    crews,
    days,
    opts,
  ).map((row) => ({
    companyKey: row.crewId,
    companyLabel: row.crewLabel,
    crewIds: [row.crewId],
    days: row.days,
  }));
}
