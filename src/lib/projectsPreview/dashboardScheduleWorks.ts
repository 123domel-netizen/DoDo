import { addDaysIso } from "./scheduleZoom";
import { todayIso } from "./projectMetrics";
import { visibleProjects } from "./search";
import {
  projectLabel,
  scheduleEventLabel,
  type ProjectsPreviewState,
  type ScheduleBlockStatus,
  type ScheduleEventKind,
} from "./types";

export type ScheduleDashboardWork = {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  projectLabel: string;
  title: string;
  crewName: string;
  startDate: string;
  endDate: string;
  status: ScheduleBlockStatus;
  /** Trwa teraz (w realizacji / okno obejmuje dziś). */
  inProgress: boolean;
};

export type ScheduleDashboardEvent = {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  projectLabel: string;
  title: string;
  date: string;
  kind: ScheduleEventKind;
};

export type ScheduleDashboardFeedItem =
  | { type: "work"; sortDate: string; work: ScheduleDashboardWork }
  | { type: "event"; sortDate: string; event: ScheduleDashboardEvent };

const SKIP_STATUSES = new Set<ScheduleBlockStatus>(["zakonczone", "wstrzymane"]);

function crewLabel(
  crews: ProjectsPreviewState["crews"],
  crewId: string,
): string {
  if (!crewId) return "";
  return crews.find((c) => c.id === crewId)?.name?.trim() ?? "";
}

function compareFeed(
  a: ScheduleDashboardFeedItem,
  b: ScheduleDashboardFeedItem,
): number {
  const byDate = a.sortDate.localeCompare(b.sortDate);
  if (byDate) return byDate;
  // Prace przed zdarzeniami tego samego dnia — potem alfabetycznie.
  if (a.type !== b.type) return a.type === "work" ? -1 : 1;
  const aLabel =
    a.type === "work"
      ? formatScheduleWorkLine(a.work)
      : `${a.event.projectLabel} ${a.event.title}`;
  const bLabel =
    b.type === "work"
      ? formatScheduleWorkLine(b.work)
      : `${b.event.projectLabel} ${b.event.title}`;
  return aLabel.localeCompare(bLabel);
}

/**
 * Zakresy + zdarzenia (budowlane/dokumentacyjne) na Dashboard:
 * - aktualnie: prace w toku + zdarzenia na dziś
 * - startujące: prace i zdarzenia w ≤10 dni; jeśli < minUpcoming, dopełnij
 *   kolejnymi startami / datami
 */
export function collectScheduleDashboardFeed(
  state: ProjectsPreviewState,
  opts: {
    today?: string;
    soonDays?: number;
    minUpcoming?: number;
  } = {},
): {
  inProgress: ScheduleDashboardFeedItem[];
  startingSoon: ScheduleDashboardFeedItem[];
} {
  const today = opts.today ?? todayIso();
  const soonDays = opts.soonDays ?? 10;
  const minUpcoming = opts.minUpcoming ?? 5;
  const soonEnd = addDaysIso(today, soonDays);

  const visible = visibleProjects(state.projects, state.viewAsUserId).filter(
    (p) => p.status === "active",
  );
  const visibleIds = new Set(visible.map((p) => p.id));
  const projectById = new Map(visible.map((p) => [p.id, p]));

  const works: ScheduleDashboardWork[] = [];
  for (const b of state.scheduleBlocks) {
    if (b.role !== "work") continue;
    if (!visibleIds.has(b.projectId)) continue;
    if (SKIP_STATUSES.has(b.status)) continue;
    const p = projectById.get(b.projectId);
    if (!p) continue;
    const spansToday = b.startDate <= today && b.endDate >= today;
    const inProgress = b.status === "w_realizacji" || spansToday;
    works.push({
      id: b.id,
      projectId: b.projectId,
      projectNumber: p.number,
      projectName: p.name,
      projectLabel: projectLabel(p),
      title: (b.title || b.scope || "Zakres").trim(),
      crewName: crewLabel(state.crews, b.crewId),
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
      inProgress,
    });
  }

  const events: ScheduleDashboardEvent[] = [];
  for (const e of state.scheduleEvents) {
    if (!visibleIds.has(e.projectId)) continue;
    if (e.date < today) continue;
    const p = projectById.get(e.projectId);
    if (!p) continue;
    events.push({
      id: e.id,
      projectId: e.projectId,
      projectNumber: p.number,
      projectName: p.name,
      projectLabel: projectLabel(p),
      title: scheduleEventLabel(e),
      date: e.date,
      kind: e.kind,
    });
  }

  const inProgressWorks = works
    .filter((w) => w.inProgress)
    .map(
      (work): ScheduleDashboardFeedItem => ({
        type: "work",
        sortDate: today,
        work,
      }),
    );
  const todayEvents = events
    .filter((e) => e.date === today)
    .map(
      (event): ScheduleDashboardFeedItem => ({
        type: "event",
        sortDate: event.date,
        event,
      }),
    );
  const inProgress = [...inProgressWorks, ...todayEvents].sort(compareFeed);

  const inProgressWorkIds = new Set(
    inProgressWorks.map((i) => (i.type === "work" ? i.work.id : "")),
  );
  const futureWorkItems = works
    .filter((w) => !inProgressWorkIds.has(w.id) && w.startDate > today)
    .map(
      (work): ScheduleDashboardFeedItem => ({
        type: "work",
        sortDate: work.startDate,
        work,
      }),
    );
  const futureEventItems = events
    .filter((e) => e.date > today)
    .map(
      (event): ScheduleDashboardFeedItem => ({
        type: "event",
        sortDate: event.date,
        event,
      }),
    );

  const futureAll = [...futureWorkItems, ...futureEventItems].sort(compareFeed);
  const within10 = futureAll.filter((i) => i.sortDate <= soonEnd);
  let startingSoon = within10;
  if (startingSoon.length < minUpcoming) {
    const seen = new Set(
      startingSoon.map((i) =>
        i.type === "work" ? `w:${i.work.id}` : `e:${i.event.id}`,
      ),
    );
    for (const item of futureAll) {
      if (startingSoon.length >= minUpcoming) break;
      const key =
        item.type === "work" ? `w:${item.work.id}` : `e:${item.event.id}`;
      if (seen.has(key)) continue;
      startingSoon = [...startingSoon, item];
      seen.add(key);
    }
  }

  return { inProgress, startingSoon };
}

/** @deprecated prefer collectScheduleDashboardFeed */
export function collectScheduleDashboardWorks(
  state: ProjectsPreviewState,
  opts: {
    today?: string;
    soonDays?: number;
    minUpcoming?: number;
  } = {},
): {
  inProgress: ScheduleDashboardWork[];
  startingSoon: ScheduleDashboardWork[];
} {
  const feed = collectScheduleDashboardFeed(state, opts);
  return {
    inProgress: feed.inProgress
      .filter((i): i is Extract<ScheduleDashboardFeedItem, { type: "work" }> =>
        i.type === "work",
      )
      .map((i) => i.work),
    startingSoon: feed.startingSoon
      .filter((i): i is Extract<ScheduleDashboardFeedItem, { type: "work" }> =>
        i.type === "work",
      )
      .map((i) => i.work),
  };
}

export function formatScheduleWorkLine(work: ScheduleDashboardWork): string {
  const parts = [`#${work.projectNumber}`, work.title];
  if (work.crewName) parts.push(work.crewName);
  return parts.join(" ");
}
