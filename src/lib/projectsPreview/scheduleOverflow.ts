import type { ScheduleBlock } from "./types";

export type ScheduleOverflow = {
  /** Days the child starts before the parent window (0 if inside). */
  before: number;
  /** Days the child ends after the parent window (0 if inside). */
  after: number;
  outside: boolean;
};

/** How far a child work block spills outside its subcategory window. */
export function scheduleOverflow(
  child: Pick<ScheduleBlock, "startDate" | "endDate">,
  parent: Pick<ScheduleBlock, "startDate" | "endDate">,
): ScheduleOverflow {
  const before = Math.max(0, dayOffset(child.startDate, parent.startDate));
  const after = Math.max(0, dayOffset(parent.endDate, child.endDate));
  return { before, after, outside: before > 0 || after > 0 };
}

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function dayOffset(from: string, to: string) {
  return Math.round((parseDay(to) - parseDay(from)) / 86400000);
}
