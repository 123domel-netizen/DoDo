import { describe, expect, it } from "vitest";
import { aggregateAttendanceByCrew } from "./attendanceAggregate";
import {
  attendanceAnchorForToday,
  attendanceWindowFromAnchor,
  shiftAttendanceAnchor,
} from "./attendanceWindow";
import { startOfWeekIso } from "./scheduleZoom";
import type {
  CrewAttendance,
  CrewEquipmentLog,
  PreviewCrew,
} from "./types";

describe("attendanceWindow", () => {
  it("builds 11 days from Friday to next Monday", () => {
    // Monday 2026-08-03 → Fri 07-31 … Mon 08-10
    const { start, end, days } = attendanceWindowFromAnchor("2026-08-03");
    expect(start).toBe("2026-07-31");
    expect(end).toBe("2026-08-10");
    expect(days).toHaveLength(11);
    expect(days[0]).toBe(start);
    expect(days[10]).toBe(end);
  });

  it("anchors today to week Monday", () => {
    expect(attendanceAnchorForToday("2026-08-05")).toBe(
      startOfWeekIso("2026-08-05"),
    );
    expect(attendanceAnchorForToday("2026-08-05")).toBe("2026-08-03");
  });

  it("shifts by weeks", () => {
    expect(shiftAttendanceAnchor("2026-08-03", 1)).toBe("2026-08-10");
    expect(shiftAttendanceAnchor("2026-08-03", -1)).toBe("2026-07-27");
  });

  it("builds day / 5 / month ranges", async () => {
    const { attendanceDaysForMode, shiftAttendanceFocus } = await import(
      "./attendanceWindow"
    );
    expect(attendanceDaysForMode("2026-08-05", "day").days).toEqual([
      "2026-08-05",
    ]);
    const five = attendanceDaysForMode("2026-08-05", "days5");
    expect(five.days).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    const month = attendanceDaysForMode("2026-08-05", "month");
    expect(month.start).toBe("2026-08-01");
    expect(month.end).toBe("2026-08-31");
    expect(month.days).toHaveLength(31);
    expect(shiftAttendanceFocus("2026-08-05", "day", 1)).toBe("2026-08-06");
    expect(shiftAttendanceFocus("2026-08-05", "month", 1)).toBe("2026-09-05");
  });
});

describe("aggregateAttendanceByCrew", () => {
  const crews: PreviewCrew[] = [
    {
      id: "c1",
      name: "A",
      color: "#111",
      headcount: 3,
      supervisor: "",
      company: "Firma X",
      phone: "",
      members: [],
      viewerUserIds: [],
    },
    {
      id: "c2",
      name: "B",
      color: "#222",
      headcount: 2,
      supervisor: "",
      company: "Firma X",
      phone: "",
      members: [],
      viewerUserIds: [],
    },
    {
      id: "c3",
      name: "Solo",
      color: "#333",
      headcount: 1,
      supervisor: "",
      company: "",
      phone: "",
      members: [],
      viewerUserIds: [],
    },
  ];

  const attendance: CrewAttendance[] = [
    {
      id: "a1",
      orgId: "o",
      crewId: "c1",
      projectId: "p1",
      workDate: "2026-08-03",
      headcount: 4,
      laborHours: 32,
      workers: [],
      status: "declared",
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
      workDate: "2026-08-03",
      headcount: 2,
      laborHours: 16,
      workers: [],
      status: "confirmed",
      note: "",
      createdByUserId: null,
      confirmedByUserId: "u1",
      confirmedAt: "2026-08-03T10:00:00Z",
    },
  ];

  const equipment: CrewEquipmentLog[] = [
    {
      id: "e1",
      attendanceId: "a1",
      equipmentKey: "koparka",
      equipmentLabel: "Koparka",
      quantity: 1,
      hours: 8,
    },
  ];

  it("keeps people and equipment per brigade", () => {
    const rows = aggregateAttendanceByCrew(
      attendance,
      equipment,
      crews,
      ["2026-08-03", "2026-08-04"],
    );
    const a = rows.find((r) => r.crewId === "c1");
    const b = rows.find((r) => r.crewId === "c2");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.crewLabel).toBe("A");
    expect(a!.company).toBe("Firma X");
    const cellA = a!.days["2026-08-03"]!;
    expect(cellA.headcount).toBe(4);
    expect(cellA.laborHours).toBe(32);
    expect(cellA.equipmentHours).toBe(8);
    expect(cellA.hasDeclared).toBe(true);
    expect(cellA.allConfirmed).toBe(false);
    expect(b!.days["2026-08-03"]!.headcount).toBe(2);
    expect(b!.days["2026-08-03"]!.allConfirmed).toBe(true);
    expect(a!.days["2026-08-04"]!.attendanceIds).toHaveLength(0);
  });

  it("sorts by control frequency then newest crew first", () => {
    const more: CrewAttendance[] = [
      ...attendance,
      {
        id: "a3",
        orgId: "o",
        crewId: "c1",
        projectId: "p1",
        workDate: "2026-08-01",
        headcount: 1,
        laborHours: 8,
        workers: [],
        status: "declared",
        note: "",
        createdByUserId: null,
        confirmedByUserId: null,
        confirmedAt: null,
      },
    ];
    const rows = aggregateAttendanceByCrew(more, [], crews, [
      "2026-08-03",
      "2026-08-04",
    ]);
    // c1 has 2 control days, c2 has 1, c3 has 0 → c1, c2, then c3 (newest of zeros)
    expect(rows.map((r) => r.crewId)).toEqual(["c1", "c2", "c3"]);
  });

  it("lists crews with empty cells", () => {
    const rows = aggregateAttendanceByCrew([], [], crews, ["2026-08-03"]);
    const solo = rows.find((r) => r.crewLabel === "Solo");
    expect(solo).toBeTruthy();
    expect(solo!.crewId).toBe("c3");
    expect(solo!.days["2026-08-03"]!.attendanceIds).toHaveLength(0);
  });

  it("filters by projectIds", () => {
    const rows = aggregateAttendanceByCrew(
      attendance,
      equipment,
      crews,
      ["2026-08-03"],
      { projectIds: ["p-other"] },
    );
    const a = rows.find((r) => r.crewId === "c1");
    expect(a!.days["2026-08-03"]!.headcount).toBe(0);
  });
});

describe("workerShifts", () => {
  it("defaults to 07:00–15:00 and sums RH", async () => {
    const {
      DEFAULT_WORK_END,
      DEFAULT_WORK_START,
      resolveInitialWorkers,
      shiftHours,
      totalLaborHours,
      workersFromHeadcount,
    } = await import("./workerShifts");
    expect(DEFAULT_WORK_START).toBe("07:00");
    expect(DEFAULT_WORK_END).toBe("15:00");
    expect(shiftHours("07:00", "15:00")).toBe(8);
    const three = workersFromHeadcount(3);
    expect(three).toHaveLength(3);
    expect(totalLaborHours(three)).toBe(24);

    const crew: PreviewCrew = {
      id: "c1",
      name: "A",
      color: "#000",
      headcount: 2,
      supervisor: "",
      company: "Firma X",
      phone: "",
      members: [],
      viewerUserIds: [],
    };
    const initial = resolveInitialWorkers({
      existing: null,
      crew,
      crews: [crew],
      attendance: [],
      workDate: "2026-08-05",
    });
    expect(initial).toHaveLength(2);
    expect(initial[0]!.startTime).toBe("07:00");
  });

  it("counts 0 RH for absence codes and normalizes them", async () => {
    const {
      normalizeWorkerList,
      totalLaborHours,
      workerLaborHours,
      WORKER_ABSENCE_LABEL,
    } = await import("./workerShifts");
    expect(WORKER_ABSENCE_LABEL.U).toBe("Urlop");
    const withLeave = {
      startTime: "07:00",
      endTime: "15:00",
      absence: "U" as const,
    };
    expect(workerLaborHours(withLeave)).toBe(0);
    expect(
      totalLaborHours([
        withLeave,
        { startTime: "07:00", endTime: "15:00" },
      ]),
    ).toBe(8);
    const parsed = normalizeWorkerList([
      {
        id: "a",
        startTime: "07:00",
        endTime: "15:00",
        absence: "NU",
        label: "Jan",
      },
      { id: "b", start_time: "08:00", end_time: "16:00", absence_code: "W" },
      { id: "c", startTime: "07:00", endTime: "15:00", absence: "nope" },
    ]);
    expect(parsed[0]!.absence).toBe("NU");
    expect(parsed[1]!.absence).toBe("W");
    expect(parsed[2]!.absence).toBeNull();
    expect(totalLaborHours(parsed)).toBe(8);
  });

  it("clones previous company workers", async () => {
    const { resolveInitialWorkers } = await import("./workerShifts");
    const crews: PreviewCrew[] = [
      {
        id: "c1",
        name: "A",
        color: "#000",
        headcount: null,
        supervisor: "",
        company: "Firma X",
        phone: "",
        members: [],
        viewerUserIds: [],
      },
      {
        id: "c2",
        name: "B",
        color: "#000",
        headcount: null,
        supervisor: "",
        company: "Firma X",
        phone: "",
        members: [],
        viewerUserIds: [],
      },
    ];
    const attendance: CrewAttendance[] = [
      {
        id: "a1",
        orgId: "o",
        crewId: "c1",
        projectId: "p1",
        workDate: "2026-08-03",
        headcount: 2,
        laborHours: 14,
        workers: [
          { id: "w1", startTime: "06:30", endTime: "14:00", label: "Majster" },
          { id: "w2", startTime: "06:30", endTime: "14:00", label: "Uczeń" },
        ],
        status: "declared",
        note: "",
        createdByUserId: null,
        confirmedByUserId: null,
        confirmedAt: null,
      },
    ];
    const next = resolveInitialWorkers({
      existing: null,
      crew: crews[1]!,
      crews,
      attendance,
      workDate: "2026-08-05",
    });
    expect(next).toHaveLength(2);
    expect(next[0]!.startTime).toBe("06:30");
    expect(next[0]!.endTime).toBe("14:00");
    expect(next[0]!.label).toBe("Majster");
    expect(next[1]!.label).toBe("Uczeń");
    expect(next[0]!.id).not.toBe("w1");
  });
});
