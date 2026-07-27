export type ProjectKind = "nadzor" | "budowa" | "projektowanie" | "inny";

export type ProjectStatus = "active" | "archived";

export type SupervisionItemStatus =
  | "brak"
  | "do_sprawdzenia"
  | "do_wpisania"
  | "wpisane"
  | "nie_dotyczy";

export type ScheduleBlockStatus =
  | "planowane"
  | "potwierdzone"
  | "w_realizacji"
  | "wstrzymane"
  | "zakonczone";

export interface PreviewUser {
  id: string;
  displayName: string;
}

export interface PreviewProject {
  id: string;
  orgId: string;
  number: number;
  name: string;
  kind: ProjectKind;
  adminUserId: string;
  memberIds: string[];
  createdAt: string;
  status: ProjectStatus;
}

export interface SupervisionCatalogCategory {
  id: string;
  title: string;
  sortOrder: number;
  activities: string[];
}

export interface SupervisionCatalogPreset {
  id: string;
  name: string;
  categories: SupervisionCatalogCategory[];
}

/** Per-project checklist instance row. */
export interface SupervisionItem {
  id: string;
  projectId: string;
  categoryId: string;
  activity: string;
  /** Custom description when activity is "Inny". */
  customLabel?: string;
  status: SupervisionItemStatus;
  noticedAt: string | null;
  note: string;
  reportedByUserId: string | null;
  writtenAt: string | null;
  writtenByUserId: string | null;
}

export interface ScheduleBlock {
  id: string;
  projectId: string;
  title: string;
  crewId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  status: ScheduleBlockStatus;
  color: string;
  note: string;
}

export interface PreviewCrew {
  id: string;
  name: string;
  color: string;
}

export interface ProjectRefEntity {
  entityType: "project";
  entityId: string;
  projectNumber: number;
  labelSnapshot: string;
}

export interface PreviewChatMessage {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  projectRefs: ProjectRefEntity[];
  /** Parsed mention display names for demo (@Jacek). */
  mentionNames: string[];
}

export interface ProjectsPreviewState {
  version: 1;
  orgId: string;
  users: PreviewUser[];
  /** Simulated "current user" for visibility checks. */
  viewAsUserId: string;
  projects: PreviewProject[];
  /** Highest number ever used in org — unused numbers are not reused automatically. */
  nextNumberHint: number;
  catalog: SupervisionCatalogPreset;
  supervisionItems: SupervisionItem[];
  crews: PreviewCrew[];
  scheduleBlocks: ScheduleBlock[];
  messages: PreviewChatMessage[];
}

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  nadzor: "Nadzór budowy",
  budowa: "Budowa",
  projektowanie: "Projektowanie",
  inny: "Inny",
};

export const SUPERVISION_STATUS_LABEL: Record<SupervisionItemStatus, string> = {
  brak: "Brak",
  do_sprawdzenia: "Do sprawdzenia",
  do_wpisania: "Do wpisania",
  wpisane: "Wpisane",
  nie_dotyczy: "Nie dotyczy",
};

export const SCHEDULE_STATUS_LABEL: Record<ScheduleBlockStatus, string> = {
  planowane: "Planowane",
  potwierdzone: "Potwierdzone",
  w_realizacji: "W realizacji",
  wstrzymane: "Wstrzymane",
  zakonczone: "Zakończone",
};

export function projectLabel(p: Pick<PreviewProject, "number" | "name">): string {
  return `#${p.number} ${p.name}`;
}

export function kindFromLabel(raw: string): ProjectKind | null {
  const n = raw.trim().toLowerCase();
  if (n === "nadzór budowy" || n === "nadzor budowy" || n === "nadzor") return "nadzor";
  if (n === "budowa") return "budowa";
  if (n === "projektowanie") return "projektowanie";
  if (n === "inny") return "inny";
  return null;
}
