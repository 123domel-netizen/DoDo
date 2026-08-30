import { describe, expect, it } from "vitest";
import {
  crewAttendanceUsageDays,
  sortCrewsByAttendanceUsage,
} from "./crewUsage";
import type { CrewAttendance, PreviewCrew } from "./types";

function crew(id: string, name: string): Pick<PreviewCrew, "id" | "name"> {
  return { id, name };
}

function att(crewId: string, workDate: string): Pick<CrewAttendance, "crewId" | "workDate"> {
  return { crewId, workDate };
}

describe("crewUsage", () => {
  it("liczy unikalne dni obecności per brygada", () => {
    const usage = crewAttendanceUsageDays([
      att("a", "2026-08-01"),
      att("a", "2026-08-01"),
      att("a", "2026-08-02"),
      att("b", "2026-08-01"),
    ] as CrewAttendance[]);
    expect(usage.get("a")).toBe(2);
    expect(usage.get("b")).toBe(1);
  });

  it("sortuje brygady malejąco po liczbie dni z wpisem", () => {
    const crews = [crew("a", "Alfa"), crew("b", "Beta"), crew("c", "Charlie")];
    const sorted = sortCrewsByAttendanceUsage(crews, [
      att("b", "2026-08-01"),
      att("b", "2026-08-02"),
      att("b", "2026-08-03"),
      att("a", "2026-08-01"),
      att("c", "2026-08-01"),
    ] as CrewAttendance[]);
    expect(sorted.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
});
