/** Half-hour clock options HH:mm (00:00 … 23:30). */
export const HALF_HOUR_TIMES: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

export const DEFAULT_WORK_START = "07:00";
export const DEFAULT_WORK_END = "15:00";

export type WorkerShiftDraft = {
  id: string;
  startTime: string;
  endTime: string;
  /** Empty = default budowa from the form. */
  projectId: string;
};

export function isHalfHourTime(value: string): boolean {
  return HALF_HOUR_TIMES.includes(value);
}

export function snapToHalfHour(value: string): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return DEFAULT_WORK_START;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Number(m[2]);
  const snapped = min < 15 ? 0 : min < 45 ? 30 : 0;
  const hour = min >= 45 ? Math.min(23, h + 1) : h;
  const out = `${String(hour).padStart(2, "0")}:${snapped === 0 ? "00" : "30"}`;
  return isHalfHourTime(out) ? out : DEFAULT_WORK_START;
}

/** Hours between start and end on the same day (0 if invalid / end ≤ start). */
export function shiftHours(startTime: string, endTime: string): number {
  const a = toMinutes(startTime);
  const b = toMinutes(endTime);
  if (a == null || b == null || b <= a) return 0;
  return (b - a) / 60;
}

export function totalLaborHours(
  workers: Array<{ startTime: string; endTime: string }>,
): number {
  return workers.reduce((sum, w) => sum + shiftHours(w.startTime, w.endTime), 0);
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

export function newWorkerShift(
  startTime = DEFAULT_WORK_START,
  endTime = DEFAULT_WORK_END,
  projectId = "",
): WorkerShiftDraft {
  return {
    id: `w-${Math.random().toString(36).slice(2, 9)}`,
    startTime: snapToHalfHour(startTime),
    endTime: snapToHalfHour(endTime),
    projectId,
  };
}

export function cloneWorkersAsDrafts(
  workers: Array<{
    startTime: string;
    endTime: string;
    projectId?: string | null;
  }>,
  defaultProjectId?: string,
): WorkerShiftDraft[] {
  return workers.map((w) => {
    const raw = (w.projectId ?? "").trim();
    const projectId =
      !raw || (defaultProjectId && raw === defaultProjectId) ? "" : raw;
    return newWorkerShift(w.startTime, w.endTime, projectId);
  });
}

export function workersFromHeadcount(
  count: number,
  startTime = DEFAULT_WORK_START,
  endTime = DEFAULT_WORK_END,
): WorkerShiftDraft[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, () => newWorkerShift(startTime, endTime));
}

function companyKeyOf(company: string, crewId: string): string {
  const c = company.trim();
  return c ? c.toLocaleLowerCase("pl") : `__crew:${crewId}`;
}

/**
 * Ostatni wpis obecności tej samej firmy przed `beforeDate` (wykluczając `excludeId`).
 */
export function findPreviousCompanyAttendance(
  attendance: import("./types").CrewAttendance[],
  crews: import("./types").PreviewCrew[],
  crew: import("./types").PreviewCrew,
  beforeDate: string,
  excludeId?: string,
): import("./types").CrewAttendance | null {
  const key = companyKeyOf(crew.company, crew.id);
  const crewIds = new Set(
    crews
      .filter((c) => companyKeyOf(c.company, c.id) === key)
      .map((c) => c.id),
  );
  let best: import("./types").CrewAttendance | null = null;
  for (const row of attendance) {
    if (excludeId && row.id === excludeId) continue;
    if (!crewIds.has(row.crewId)) continue;
    if (row.workDate >= beforeDate) continue;
    if (!best || row.workDate > best.workDate) best = row;
  }
  return best;
}

/** Start / koniec z poprzedniego wpisu firmy albo 07:00–15:00. */
export function defaultShiftTimesFromPrevious(
  previous: import("./types").CrewAttendance | null,
): { startTime: string; endTime: string } {
  const w = previous?.workers?.[0];
  if (w) {
    return {
      startTime: snapToHalfHour(w.startTime),
      endTime: snapToHalfHour(w.endTime),
    };
  }
  return { startTime: DEFAULT_WORK_START, endTime: DEFAULT_WORK_END };
}

/**
 * Wiersze na start formularza: istniejący wpis → poprzednia firma → headcount brygady × 7–15.
 */
export function resolveInitialWorkers(opts: {
  existing?: import("./types").CrewAttendance | null;
  /** All attendances for this crew+day when editing a split day. */
  existingBatch?: import("./types").CrewAttendance[];
  defaultProjectId?: string;
  crew: import("./types").PreviewCrew;
  crews: import("./types").PreviewCrew[];
  attendance: import("./types").CrewAttendance[];
  workDate: string;
}): WorkerShiftDraft[] {
  const {
    existing,
    existingBatch,
    defaultProjectId,
    crew,
    crews,
    attendance,
    workDate,
  } = opts;

  const batch =
    existingBatch && existingBatch.length > 0
      ? existingBatch
      : existing
        ? [existing]
        : [];

  if (batch.length > 0) {
    const def =
      defaultProjectId ||
      existing?.projectId ||
      batch[0]!.projectId;
    const drafts: WorkerShiftDraft[] = [];
    for (const row of batch) {
      if (row.workers?.length) {
        drafts.push(
          ...row.workers.map((w) => {
            const override =
              row.projectId === def ? "" : row.projectId;
            return newWorkerShift(w.startTime, w.endTime, override);
          }),
        );
      } else if (row.headcount > 0) {
        const times = defaultShiftTimesFromPrevious(
          findPreviousCompanyAttendance(
            attendance,
            crews,
            crew,
            row.workDate,
            row.id,
          ),
        );
        const override = row.projectId === def ? "" : row.projectId;
        drafts.push(
          ...workersFromHeadcount(
            row.headcount,
            times.startTime,
            times.endTime,
          ).map((w) => ({ ...w, projectId: override })),
        );
      }
    }
    if (drafts.length) return drafts;
  }

  const previous = findPreviousCompanyAttendance(
    attendance,
    crews,
    crew,
    workDate,
  );
  if (previous?.workers?.length) {
    return cloneWorkersAsDrafts(previous.workers, defaultProjectId);
  }
  if (previous && previous.headcount > 0) {
    const times = defaultShiftTimesFromPrevious(previous);
    return workersFromHeadcount(
      previous.headcount,
      times.startTime,
      times.endTime,
    );
  }
  if (crew.headcount != null && crew.headcount > 0) {
    return workersFromHeadcount(crew.headcount);
  }
  return [];
}

export function normalizeWorkerList(
  raw: unknown,
): import("./types").CrewWorkerShift[] {
  if (!Array.isArray(raw)) return [];
  const out: import("./types").CrewWorkerShift[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const startTime = snapToHalfHour(String(rec.startTime ?? rec.start_time ?? ""));
    const endTime = snapToHalfHour(String(rec.endTime ?? rec.end_time ?? ""));
    const id =
      typeof rec.id === "string" && rec.id
        ? rec.id
        : `w-${Math.random().toString(36).slice(2, 9)}`;
    const projectRaw = rec.projectId ?? rec.project_id;
    const projectId =
      typeof projectRaw === "string" && projectRaw.trim()
        ? projectRaw.trim()
        : null;
    out.push({ id, startTime, endTime, projectId });
  }
  return out;
}
