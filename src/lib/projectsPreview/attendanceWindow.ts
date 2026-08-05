import { addDaysIso, startOfWeekIso } from "./scheduleZoom";

export type AttendanceRangeMode = "day" | "days5" | "days11" | "month";

export const ATTENDANCE_RANGE_MODES: AttendanceRangeMode[] = [
  "day",
  "days5",
  "days11",
  "month",
];

export const ATTENDANCE_RANGE_LABEL: Record<AttendanceRangeMode, string> = {
  day: "1",
  days5: "5",
  days11: "11",
  month: "M",
};

export const ATTENDANCE_RANGE_TITLE: Record<AttendanceRangeMode, string> = {
  day: "Jeden dzień",
  days5: "5 dni (pn–pt)",
  days11: "11 dni",
  month: "Miesiąc",
};

/**
 * 11-day attendance window: Friday before the week Monday → next Monday.
 * Anchor = Monday of the "middle" work week.
 */
export function attendanceWindowFromAnchor(weekMonday: string): {
  start: string;
  end: string;
  days: string[];
} {
  const start = addDaysIso(weekMonday, -3);
  const end = addDaysIso(weekMonday, 7);
  const days: string[] = [];
  for (let i = 0; i < 11; i++) days.push(addDaysIso(start, i));
  return { start, end, days };
}

/** Days visible for the selected range mode around `focusDate`. */
export function attendanceDaysForMode(
  focusDate: string,
  mode: AttendanceRangeMode,
): { start: string; end: string; days: string[] } {
  if (mode === "day") {
    return { start: focusDate, end: focusDate, days: [focusDate] };
  }
  if (mode === "days5") {
    const monday = startOfWeekIso(focusDate);
    const days = Array.from({ length: 5 }, (_, i) => addDaysIso(monday, i));
    return { start: days[0]!, end: days[4]!, days };
  }
  if (mode === "days11") {
    return attendanceWindowFromAnchor(startOfWeekIso(focusDate));
  }
  // month
  const [y, m] = focusDate.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextMonth =
    m === 12
      ? `${y! + 1}-01-01`
      : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
  const end = addDaysIso(nextMonth, -1);
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return { start, end, days };
}

/** Monday of the week containing `today`, used as default table anchor. */
export function attendanceAnchorForToday(today: string): string {
  return startOfWeekIso(today);
}

export function shiftAttendanceAnchor(weekMonday: string, weeks: number): string {
  return addDaysIso(weekMonday, weeks * 7);
}

/** Shift focus date by one step for the given range mode. */
export function shiftAttendanceFocus(
  focusDate: string,
  mode: AttendanceRangeMode,
  dir: -1 | 1,
): string {
  if (mode === "day") return addDaysIso(focusDate, dir);
  if (mode === "days5" || mode === "days11") {
    return addDaysIso(focusDate, dir * 7);
  }
  // month
  const [y, m, d] = focusDate.split("-").map(Number);
  let ny = y!;
  let nm = m! + dir;
  if (nm < 1) {
    nm = 12;
    ny -= 1;
  } else if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  const start = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const next =
    nm === 12
      ? `${ny + 1}-01-01`
      : `${ny}-${String(nm + 1).padStart(2, "0")}-01`;
  const last = addDaysIso(next, -1);
  const day = Math.min(d!, Number(last.slice(8)));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
