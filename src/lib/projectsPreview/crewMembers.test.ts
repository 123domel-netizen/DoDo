import { describe, expect, it } from "vitest";
import {
  normalizeCrewMembers,
  pinnedAttendanceMembers,
} from "./crewMembers";

describe("normalizeCrewMembers", () => {
  it("keeps named members and pin flags", () => {
    const out = normalizeCrewMembers([
      { id: "a", name: " Jan Nowak ", pinAttendance: true },
      { id: "b", name: "Marek", pin_attendance: 1 },
      { name: "  ", pinAttendance: true },
      { id: "c", name: "Bez pinu", pinAttendance: false },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      id: "a",
      name: "Jan Nowak",
      pinAttendance: true,
    });
    expect(out[1]!.pinAttendance).toBe(true);
    expect(out[1]!.name).toBe("Marek");
    expect(out[2]!.pinAttendance).toBe(false);
  });

  it("filters pinned for attendance quick-picks", () => {
    const pinned = pinnedAttendanceMembers([
      { id: "1", name: "A", pinAttendance: true },
      { id: "2", name: "B", pinAttendance: false },
      { id: "3", name: "", pinAttendance: true },
    ]);
    expect(pinned.map((m) => m.name)).toEqual(["A"]);
  });

  it("caps roster size", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      name: `P${i}`,
      pinAttendance: false,
    }));
    expect(normalizeCrewMembers(many)).toHaveLength(40);
  });
});

describe("pinned add helpers", () => {
  it("detects when pinned name already used as worker label", () => {
    const pinned = pinnedAttendanceMembers([
      { id: "1", name: "Jan Nowak", pinAttendance: true },
      { id: "2", name: "Marek Rogala", pinAttendance: true },
    ]);
    const labels = ["jan nowak", "Majster"];
    const missing = pinned.filter(
      (m) =>
        !labels.some(
          (l) =>
            l.trim().toLocaleLowerCase("pl") ===
            m.name.trim().toLocaleLowerCase("pl"),
        ),
    );
    expect(missing.map((m) => m.name)).toEqual(["Marek Rogala"]);
  });
});
