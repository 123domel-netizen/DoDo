import { describe, expect, it } from "vitest";
import {
  attendanceDayActivityCount,
  attendanceDaySection,
  attendanceRecordsForCompanyDay,
  attendanceWeekSections,
  companyRowsForDay,
  formatEquipmentSummary,
  weekIsoDays,
} from "@/lib/attendanceDashboard";
import type { CrewAttendanceBoardRow } from "@/lib/projectsPreview/attendanceAggregate";
import type {
  CrewAttendance,
  CrewEquipmentLog,
  PreviewCrew,
} from "@/lib/projectsPreview/types";

function boardRow(
  crewId: string,
  label: string,
  company: string,
  days: Record<
    string,
    {
      headcount: number;
      ids: string[];
      equipmentQty?: number;
      equipmentHours?: number;
    }
  >,
): CrewAttendanceBoardRow {
  const dayMap: CrewAttendanceBoardRow["days"] = {};
  for (const [date, info] of Object.entries(days)) {
    dayMap[date] = {
      headcount: info.headcount,
      laborHours: info.headcount * 8,
      equipmentHours: info.equipmentHours ?? 0,
      equipmentQty: info.equipmentQty ?? 0,
      attendanceIds: info.ids,
      allConfirmed: true,
      hasDeclared: false,
    };
  }
  return {
    crewId,
    crewLabel: label,
    company,
    days: dayMap,
  };
}

describe("attendanceDashboard", () => {
  it("weekIsoDays zwraca 7 dni od poniedziałku", () => {
    expect(weekIsoDays("2026-08-30")).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("agreguje brygady w firmy i sumuje sprzęt", () => {
    const board = [
      boardRow("c1", "Brygada A", "GERMAPOL", {
        "2026-08-25": {
          headcount: 5,
          ids: ["a1"],
          equipmentQty: 2,
          equipmentHours: 8,
        },
      }),
      boardRow("c2", "Brygada B", "GERMAPOL", {
        "2026-08-25": {
          headcount: 3,
          ids: ["b1"],
          equipmentQty: 1,
          equipmentHours: 4,
        },
      }),
      boardRow("c3", "Brygada C", "SAND", {
        "2026-08-25": { headcount: 4, ids: ["c1"] },
      }),
    ];

    const rows = companyRowsForDay(board, "2026-08-25");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      companyLabel: "GERMAPOL",
      headcount: 8,
      equipmentQty: 3,
      equipmentHours: 12,
    });
    expect(formatEquipmentSummary(rows[0]!)).toBe("3 szt. · 12 h");

    const week = weekIsoDays("2026-08-30");
    expect(attendanceWeekSections(week, board).map((s) => s.date)).toEqual([
      "2026-08-25",
    ]);
    expect(attendanceDayActivityCount("2026-08-25", board)).toBe(2);
    expect(attendanceDaySection("2026-08-30", board).rows).toEqual([]);
  });

  it("attendanceRecordsForCompanyDay zbiera wpisy wszystkich brygad firmy", () => {
    const crews: PreviewCrew[] = [
      {
        id: "c1",
        name: "Brygada A",
        company: "GERMAPOL",
        color: "#f00",
        headcount: 5,
        supervisor: "",
        phone: "",
        members: [],
        viewerUserIds: [],
        createdByUserId: null,
      },
      {
        id: "c2",
        name: "Brygada B",
        company: "GERMAPOL",
        color: "#0f0",
        headcount: 3,
        supervisor: "",
        phone: "",
        members: [],
        viewerUserIds: [],
        createdByUserId: null,
      },
      {
        id: "c3",
        name: "Brygada C",
        company: "SAND",
        color: "#00f",
        headcount: 4,
        supervisor: "",
        phone: "",
        members: [],
        viewerUserIds: [],
        createdByUserId: null,
      },
    ];
    const crewAttendance: CrewAttendance[] = [
      {
        id: "a1",
        orgId: "o",
        crewId: "c1",
        projectId: "p1",
        workDate: "2026-08-25",
        headcount: 5,
        laborHours: 40,
        workers: [],
        status: "confirmed",
        note: "",
        createdByUserId: null,
        confirmedByUserId: null,
        confirmedAt: null,
      },
      {
        id: "a2",
        orgId: "o",
        crewId: "c2",
        projectId: "p1",
        workDate: "2026-08-25",
        headcount: 3,
        laborHours: 24,
        workers: [],
        status: "declared",
        note: "",
        createdByUserId: null,
        confirmedByUserId: null,
        confirmedAt: null,
      },
      {
        id: "a3",
        orgId: "o",
        crewId: "c3",
        projectId: "p2",
        workDate: "2026-08-25",
        headcount: 4,
        laborHours: 32,
        workers: [],
        status: "confirmed",
        note: "",
        createdByUserId: null,
        confirmedByUserId: null,
        confirmedAt: null,
      },
    ];
    const crewEquipmentLogs: CrewEquipmentLog[] = [
      {
        id: "e1",
        attendanceId: "a1",
        equipmentKey: "koparka",
        equipmentLabel: "Koparka",
        quantity: 2,
        hours: 8,
      },
      {
        id: "e2",
        attendanceId: "a3",
        equipmentKey: "wal",
        equipmentLabel: "Walec",
        quantity: 1,
        hours: 4,
      },
    ];

    const result = attendanceRecordsForCompanyDay(
      { crewAttendance, crewEquipmentLogs, crews },
      "2026-08-25",
      "GERMAPOL",
    );

    expect(result.rows.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(result.equipment.map((e) => e.id)).toEqual(["e1"]);
    expect(result.crewLabels).toEqual(["Brygada A", "Brygada B"]);
  });
});
