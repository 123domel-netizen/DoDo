import type { CrewMember } from "./types";

export const MAX_CREW_MEMBERS = 40;

/** Normalize roster from form / DB jsonb. Drops empty names; caps length. */
export function normalizeCrewMembers(raw: unknown): CrewMember[] {
  if (!Array.isArray(raw)) return [];
  const out: CrewMember[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CREW_MEMBERS) break;
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name =
      typeof rec.name === "string" ? rec.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const id =
      typeof rec.id === "string" && rec.id.trim()
        ? rec.id.trim()
        : `cm-${Math.random().toString(36).slice(2, 9)}`;
    const pinRaw = rec.pinAttendance ?? rec.pin_attendance;
    const pinAttendance = pinRaw === true || pinRaw === 1 || pinRaw === "1";
    out.push({ id, name, pinAttendance });
  }
  return out;
}

export function pinnedAttendanceMembers(
  members: CrewMember[] | null | undefined,
): CrewMember[] {
  return (members ?? []).filter((m) => m.pinAttendance && m.name.trim());
}

export function newCrewMember(
  name = "",
  pinAttendance = false,
): CrewMember {
  return {
    id: `cm-${Math.random().toString(36).slice(2, 9)}`,
    name,
    pinAttendance,
  };
}
