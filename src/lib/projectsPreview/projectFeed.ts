import type { DocEventStatus, ScheduleBlock, ScheduleEvent } from "./types";

export type ProjectFeedFilter =
  | "all"
  | "budowlane"
  | "dokumentacyjne"
  | "do_wpisania"
  | "do_sprawdzenia"
  | "wpisane";

export type ProjectFeedEntry = {
  at: string;
  event: ScheduleEvent;
  /** Owning block when the event is pinned to one. */
  block: ScheduleBlock | null;
};

export type OrgFeedEntry = ProjectFeedEntry & { projectId: string };

export const FEED_FILTERS: Array<{ id: ProjectFeedFilter; label: string }> = [
  { id: "all", label: "Wszystkie" },
  { id: "budowlane", label: "Budowlane" },
  { id: "dokumentacyjne", label: "Dokumentacyjne" },
  { id: "do_wpisania", label: "Do wpisania" },
  { id: "do_sprawdzenia", label: "Do sprawdzenia" },
  { id: "wpisane", label: "Wpisane" },
];

export const EMPTY_FEED_TEXT: Record<ProjectFeedFilter, string> = {
  all: "Brak zdarzeń na harmonogramie.",
  budowlane: "Brak zdarzeń budowlanych.",
  dokumentacyjne: "Brak zdarzeń dokumentacyjnych.",
  do_wpisania: "Nic nie czeka na wpisanie.",
  do_sprawdzenia: "Nic nie czeka na sprawdzenie.",
  wpisane: "Brak wpisanych pozycji.",
};

const DOC_STATUS_FILTERS = new Set<ProjectFeedFilter>([
  "do_wpisania",
  "do_sprawdzenia",
  "wpisane",
]);

/** True when the event belongs in the given filter. */
export function matchesFeedFilter(
  event: ScheduleEvent,
  filter: ProjectFeedFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "budowlane") return event.kind === "budowlane";
  if (filter === "dokumentacyjne") return event.kind === "dokumentacyjne";
  if (DOC_STATUS_FILTERS.has(filter)) {
    return (
      event.kind === "dokumentacyjne" &&
      event.status === (filter as DocEventStatus)
    );
  }
  return true;
}

function blockMap(blocks: ScheduleBlock[]): Map<string, ScheduleBlock> {
  return new Map(blocks.map((b) => [b.id, b]));
}

function collectFeed(
  accept: (projectId: string) => boolean,
  scheduleEvents: ScheduleEvent[],
  scheduleBlocks: ScheduleBlock[],
  filter: ProjectFeedFilter,
): OrgFeedEntry[] {
  const byId = blockMap(scheduleBlocks.filter((b) => accept(b.projectId)));
  const entries: OrgFeedEntry[] = [];

  for (const event of scheduleEvents) {
    if (!accept(event.projectId)) continue;
    if (!matchesFeedFilter(event, filter)) continue;
    if (!event.date) continue;
    entries.push({
      at: event.date,
      event,
      block: event.blockId ? (byId.get(event.blockId) ?? null) : null,
      projectId: event.projectId,
    });
  }

  entries.sort(
    (a, b) => b.at.localeCompare(a.at) || a.event.kind.localeCompare(b.event.kind),
  );
  return entries;
}

/** Chronologia jednej budowy, najnowsze na górze. */
export function buildProjectFeed(
  projectId: string,
  scheduleEvents: ScheduleEvent[],
  scheduleBlocks: ScheduleBlock[],
  opts?: { filter?: ProjectFeedFilter },
): ProjectFeedEntry[] {
  return collectFeed(
    (id) => id === projectId,
    scheduleEvents,
    scheduleBlocks,
    opts?.filter ?? "all",
  ).map(({ projectId: _pid, ...rest }) => rest);
}

/** Chronologia wielu budów (tylko widoczne dla bieżącego użytkownika). */
export function buildOrgFeed(
  projectIds: string[],
  scheduleEvents: ScheduleEvent[],
  scheduleBlocks: ScheduleBlock[],
  opts?: { filter?: ProjectFeedFilter; limit?: number },
): OrgFeedEntry[] {
  const scope = new Set(projectIds);
  const all = collectFeed(
    (id) => scope.has(id),
    scheduleEvents,
    scheduleBlocks,
    opts?.filter ?? "all",
  );
  return opts?.limit ? all.slice(0, opts.limit) : all;
}

/** Partition feed into planned (at >= today) and history (at < today). */
export function partitionProjectFeed<T extends { at: string }>(
  entries: T[],
  today: string,
): { planned: T[]; history: T[] } {
  const planned: T[] = [];
  const history: T[] = [];
  for (const e of entries) {
    if (e.at >= today) planned.push(e);
    else history.push(e);
  }
  planned.sort((a, b) => a.at.localeCompare(b.at));
  return { planned, history };
}
