import { todayIso } from "./projectMetrics";
import { visibleProjects } from "./search";
import {
  projectLabel,
  scheduleEventLabel,
  type ProjectsPreviewState,
  type ScheduleEventKind,
} from "./types";

export type ScheduleDashboardHint = {
  id: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  projectLabel: string;
  title: string;
  date: string;
  kind: ScheduleEventKind;
};

export function collectScheduleDashboardHints(
  state: ProjectsPreviewState,
  opts: {
    today?: string;
    maxToday?: number;
    maxUpcoming?: number;
  } = {},
): { today: ScheduleDashboardHint[]; upcoming: ScheduleDashboardHint[] } {
  const today = opts.today ?? todayIso();
  const visible = visibleProjects(state.projects, state.viewAsUserId).filter(
    (p) => p.status === "active",
  );
  const visibleIds = new Set(visible.map((p) => p.id));
  const projectById = new Map(visible.map((p) => [p.id, p]));

  const hints: ScheduleDashboardHint[] = [];
  for (const e of state.scheduleEvents) {
    if (!visibleIds.has(e.projectId)) continue;
    if (e.date < today) continue;
    const p = projectById.get(e.projectId);
    if (!p) continue;
    hints.push({
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

  hints.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.projectLabel.localeCompare(b.projectLabel) ||
      a.title.localeCompare(b.title),
  );

  const todayAll = hints.filter((h) => h.date === today);
  const upcomingAll = hints.filter((h) => h.date > today);

  return {
    today:
      opts.maxToday != null ? todayAll.slice(0, opts.maxToday) : todayAll,
    upcoming:
      opts.maxUpcoming != null
        ? upcomingAll.slice(0, opts.maxUpcoming)
        : upcomingAll,
  };
}
