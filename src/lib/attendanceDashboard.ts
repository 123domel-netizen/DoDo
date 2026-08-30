import {
  aggregateAttendanceByCrew,
  type CrewAttendanceBoardRow,
} from "@/lib/projectsPreview/attendanceAggregate";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import { addDaysIso, startOfWeekIso } from "@/lib/projectsPreview/scheduleZoom";
import type {
  CrewAttendance,
  CrewEquipmentLog,
  PreviewCrew,
} from "@/lib/projectsPreview/types";

export type AttendanceDashboardCompanyRow = {
  companyKey: string;
  companyLabel: string;
  headcount: number;
  laborHours: number;
  equipmentQty: number;
  equipmentHours: number;
};

export type AttendanceDashboardDaySection = {
  date: string;
  dateObj: Date;
  rows: AttendanceDashboardCompanyRow[];
  totalHeadcount: number;
  totalEquipmentQty: number;
};

/** @deprecated Użyj AttendanceDashboardCompanyRow */
export type AttendanceDashboardCrewRow = AttendanceDashboardCompanyRow & {
  crewId: string;
  crewLabel: string;
  company: string;
};

export function weekIsoDays(anchorIso: string = todayIso()): string[] {
  const start = startOfWeekIso(anchorIso);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function companyKeyFromCrewRow(row: CrewAttendanceBoardRow): string {
  return companyKeyForCrew(row);
}

export function companyKeyForCrew(
  crew: PreviewCrew | CrewAttendanceBoardRow,
): string {
  const company = crew.company.trim();
  if (company) return company;
  const name =
    "crewLabel" in crew ? crew.crewLabel.trim() : crew.name.trim();
  return name || "Bez firmy";
}

export function attendanceRecordsForCompanyDay(
  state: {
    crewAttendance: CrewAttendance[];
    crewEquipmentLogs: CrewEquipmentLog[];
    crews: PreviewCrew[];
  },
  date: string,
  companyKey: string,
): {
  rows: CrewAttendance[];
  equipment: CrewEquipmentLog[];
  crewLabels: string[];
} {
  const crewIds = new Set(
    state.crews
      .filter((crew) => companyKeyForCrew(crew) === companyKey)
      .map((crew) => crew.id),
  );
  const rows = state.crewAttendance.filter(
    (row) => row.workDate === date && crewIds.has(row.crewId),
  );
  const attendanceIds = new Set(rows.map((row) => row.id));
  const equipment = state.crewEquipmentLogs.filter((log) =>
    attendanceIds.has(log.attendanceId),
  );
  const crewLabels = [
    ...new Set(
      rows.map((row) => {
        const crew = state.crews.find((c) => c.id === row.crewId);
        return crew?.name?.trim() || "Bez nazwy";
      }),
    ),
  ].sort((a, b) => a.localeCompare(b, "pl"));
  return { rows, equipment, crewLabels };
}

export function companyRowsForDay(
  board: CrewAttendanceBoardRow[],
  date: string,
): AttendanceDashboardCompanyRow[] {
  const byCompany = new Map<string, AttendanceDashboardCompanyRow>();

  for (const row of board) {
    const cell = row.days[date];
    if (!cell || cell.attendanceIds.length === 0) continue;

    const key = companyKeyFromCrewRow(row);
    const existing = byCompany.get(key);
    if (existing) {
      existing.headcount += cell.headcount;
      existing.laborHours += cell.laborHours;
      existing.equipmentQty += cell.equipmentQty;
      existing.equipmentHours += cell.equipmentHours;
    } else {
      byCompany.set(key, {
        companyKey: key,
        companyLabel: key,
        headcount: cell.headcount,
        laborHours: cell.laborHours,
        equipmentQty: cell.equipmentQty,
        equipmentHours: cell.equipmentHours,
      });
    }
  }

  return [...byCompany.values()].sort(
    (a, b) =>
      b.headcount - a.headcount ||
      a.companyLabel.localeCompare(b.companyLabel, "pl"),
  );
}

export function attendanceDayActivityCount(
  date: string,
  board: CrewAttendanceBoardRow[],
): number {
  return companyRowsForDay(board, date).length;
}

export function attendanceDaySection(
  date: string,
  board: CrewAttendanceBoardRow[],
): AttendanceDashboardDaySection {
  const rows = companyRowsForDay(board, date);
  return {
    date,
    dateObj: isoToLocalDate(date),
    rows,
    totalHeadcount: rows.reduce((sum, row) => sum + row.headcount, 0),
    totalEquipmentQty: rows.reduce((sum, row) => sum + row.equipmentQty, 0),
  };
}

export function attendanceWeekSections(
  weekDays: string[],
  board: CrewAttendanceBoardRow[],
): AttendanceDashboardDaySection[] {
  return weekDays
    .map((date) => attendanceDaySection(date, board))
    .filter((section) => section.rows.length > 0);
}

export function buildAttendanceDashboardBoard(
  state: {
    crewAttendance: Parameters<typeof aggregateAttendanceByCrew>[0];
    crewEquipmentLogs: Parameters<typeof aggregateAttendanceByCrew>[1];
    crews: Parameters<typeof aggregateAttendanceByCrew>[2];
  },
  weekDays: string[],
): CrewAttendanceBoardRow[] {
  return aggregateAttendanceByCrew(
    state.crewAttendance,
    state.crewEquipmentLogs,
    state.crews,
    weekDays,
  );
}

export function formatEquipmentSummary(row: AttendanceDashboardCompanyRow): string | null {
  const parts: string[] = [];
  if (row.equipmentQty > 0) {
    parts.push(`${row.equipmentQty} szt.`);
  }
  if (row.equipmentHours > 0) {
    const hours = Number.isInteger(row.equipmentHours)
      ? String(row.equipmentHours)
      : row.equipmentHours.toFixed(1);
    parts.push(`${hours} h`);
  }
  return parts.length ? parts.join(" · ") : null;
}
