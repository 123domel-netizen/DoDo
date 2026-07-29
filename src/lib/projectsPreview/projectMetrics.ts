import type { ScheduleCatalogPreset } from "./scheduleCatalog";
import type { ScheduleBlock, ScheduleEvent } from "./types";

/** Local-time YYYY-MM-DD, matching how schedule dates are authored. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function projectBlocks(projectId: string, blocks: ScheduleBlock[]): ScheduleBlock[] {
  return blocks.filter((b) => b.projectId === projectId);
}

function sortOrderOf(
  categoryId: string,
  scheduleCatalog: ScheduleCatalogPreset,
): number {
  return (
    scheduleCatalog.categories.find((c) => c.id === categoryId)?.sortOrder ?? 0
  );
}

/**
 * Human label of the stage a project is currently in.
 * Prefers work in progress, then whatever spans today, then the next planned
 * window, and finally the most recently finished one.
 */
export function projectStageLabel(
  projectId: string,
  blocks: ScheduleBlock[],
  scheduleCatalog: ScheduleCatalogPreset,
  today: string = todayIso(),
): string | null {
  const mine = projectBlocks(projectId, blocks);
  if (mine.length === 0) return null;

  const byStage = (a: ScheduleBlock, b: ScheduleBlock) =>
    sortOrderOf(b.categoryId, scheduleCatalog) -
    sortOrderOf(a.categoryId, scheduleCatalog);

  const running = mine.filter((b) => b.status === "w_realizacji");
  const current = mine.filter(
    (b) =>
      b.status !== "zakonczone" && b.startDate <= today && today <= b.endDate,
  );
  const upcoming = mine
    .filter((b) => b.status !== "zakonczone" && b.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const finished = mine
    .slice()
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  const pick =
    running.slice().sort(byStage)[0] ??
    current.slice().sort(byStage)[0] ??
    upcoming[0] ??
    finished[0];
  if (!pick) return null;

  return (
    scheduleCatalog.categories.find((c) => c.id === pick.categoryId)?.title ??
    null
  );
}

/**
 * Nearest end date still ahead of us (unfinished work), as YYYY-MM-DD.
 * Falls back to the latest past deadline so a stale project still shows one.
 */
export function projectNextDeadline(
  projectId: string,
  blocks: ScheduleBlock[],
  today: string = todayIso(),
): string | null {
  const open = projectBlocks(projectId, blocks).filter(
    (b) => b.status !== "zakonczone",
  );
  if (open.length === 0) return null;

  const ahead = open
    .filter((b) => b.endDate >= today)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  if (ahead[0]) return ahead[0].endDate;

  const overdue = open
    .slice()
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
  return overdue[0]?.endDate ?? null;
}

/** Kolejka „do wpisania” dla jednej budowy (zdarzenia dokumentacyjne). */
export function countDoWpisania(
  projectId: string,
  events: ScheduleEvent[],
): number {
  return events.filter(
    (e) =>
      e.projectId === projectId &&
      e.kind === "dokumentacyjne" &&
      e.status === "do_wpisania",
  ).length;
}
