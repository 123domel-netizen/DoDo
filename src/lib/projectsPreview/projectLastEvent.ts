import { scheduleEventLabel, type ScheduleBlock, type ScheduleEvent } from "./types";

export type ProjectLastEvent = {
  at: string;
  label: string;
};

type Candidate = ProjectLastEvent;

function pickLatest(candidates: Candidate[]): ProjectLastEvent | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (cur.at > best.at ? cur : best));
}

/** Most recent activity across schedule blocks and schedule events. */
export function projectLastEvent(
  projectId: string,
  scheduleBlocks: ScheduleBlock[],
  scheduleEvents: ScheduleEvent[],
): ProjectLastEvent | null {
  const candidates: Candidate[] = [];

  for (const block of scheduleBlocks) {
    if (block.projectId !== projectId) continue;
    if (block.role === "subcategory") continue;
    candidates.push({
      at: block.endDate,
      label: block.title || block.scope,
    });
  }

  for (const ev of scheduleEvents) {
    if (ev.projectId !== projectId) continue;
    if (!ev.date) continue;
    candidates.push({ at: ev.date, label: scheduleEventLabel(ev) });
  }

  return pickLatest(candidates);
}

export function formatEventDate(iso: string): string {
  return new Date(`${iso.length === 10 ? iso : iso.slice(0, 10)}T12:00:00`).toLocaleDateString(
    "pl-PL",
    { day: "numeric", month: "short", year: "numeric" },
  );
}

/** Compact date for tables: "28 lip", with year only outside the current one. */
export function formatDayShort(iso: string): string {
  try {
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(
      "pl-PL",
      sameYear
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "2-digit" },
    );
  } catch {
    return iso;
  }
}
