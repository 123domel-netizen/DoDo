import type { ScheduleCatalogPreset } from "./scheduleCatalog";

export type ProjectStatus = "active" | "archived";

/**
 * Two kinds of point-in-time events on a harmonogram:
 * `budowlane` — logistyka/plac budowy (⚡ dźwig, dostawa),
 * `dokumentacyjne` — wpisy do dziennika / nadzór (kropka ze stanem).
 */
export type ScheduleEventKind = "budowlane" | "dokumentacyjne";

/** Stan zdarzenia dokumentacyjnego. `do_wpisania` napędza kolejkę w nagłówku. */
export type DocEventStatus =
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

export type { ScheduleCatalogPreset };

export interface PreviewUser {
  id: string;
  displayName: string;
}

/** Every project in preview is a Budowa — 1:1 with its harmonogram. */
export interface PreviewProject {
  id: string;
  orgId: string;
  /**
   * Identyfikator budowy w zespole (cyfry, kod, skrót…), unikalny.
   * Historycznie „numer” — nie musi być liczbą.
   */
  number: string;
  name: string;
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

/** Katalog czynności dokumentacyjnych (wspólne id etapów z harmonogramem). */
export interface SupervisionCatalogPreset {
  id: string;
  name: string;
  categories: SupervisionCatalogCategory[];
}

export type ScheduleBlockRole = "work" | "subcategory";

/**
 * Nadpisanie wiersza kategorii na konkretnej budowie
 * (własna nazwa zamiast proponowanej z katalogu + notatka).
 */
export interface ScheduleCategoryMeta {
  projectId: string;
  categoryId: string;
  /** Puste = tytuł z katalogu. */
  title: string;
  note: string;
  /**
   * Przewidywane okno na tablicy. Puste = wyliczane z pozycji w kategorii.
   * Szary „spill” = zakresy/podkategorie wystające poza to okno.
   */
  startDate: string;
  endDate: string;
}

export interface ScheduleBlock {
  id: string;
  projectId: string;
  /** Display title (often same as scope, can be more specific). */
  title: string;
  /** Schedule category id from budowa catalog. */
  categoryId: string;
  /** Główny element / zakres — from catalog or custom. */
  scope: string;
  /**
   * `work` — leaf task/bar.
   * `subcategory` — container with a planned date window; children hang under it.
   */
  role: ScheduleBlockRole;
  /** Parent subcategory id (only for work). null = top-level under category. */
  parentId: string | null;
  /** Brygada assigned to the work. Empty string = jeszcze nieprzypisana. */
  crewId: string;
  /** For subcategory = planned window; for work = actual dates. */
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
  /** Headcount on site (optional). */
  headcount: number | null;
  /** Person overseeing the crew. */
  supervisor: string;
  /** Company / contractor name. */
  company: string;
  /** Contact phone. */
  phone: string;
}

/**
 * Punktowe zdarzenie na harmonogramie. Nie jest robotą (nie ma czasu trwania)
 * ani zadaniem w kalendarzu.
 *
 * Umieszczenie na osi: `categoryId` (wymagane) → wiersz kategorii;
 * opcjonalnie `blockId` podkategorii/roboty → wiersz tego bloku.
 */
export interface ScheduleEvent {
  id: string;
  projectId: string;
  /**
   * Opcjonalne powiązanie z podkategorią lub robotą.
   * null = tylko kategoria (domyślne).
   */
  blockId: string | null;
  kind: ScheduleEventKind;
  title: string;
  date: string; // YYYY-MM-DD
  note: string;
  /** Kategoria z katalogu budów — główne miejsce na osi. */
  categoryId?: string;
  /** Only for `dokumentacyjne`. */
  status?: DocEventStatus;
  activity?: string;
  /** Custom description when activity is "Inny". */
  customLabel?: string;
  writtenAt?: string | null;
  reportedByUserId?: string | null;
  writtenByUserId?: string | null;
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
  /** Budowa: kategorie + główne elementy (zakresy). */
  scheduleCatalog: ScheduleCatalogPreset;
  crews: PreviewCrew[];
  scheduleBlocks: ScheduleBlock[];
  /** Zdarzenia budowlane + dokumentacyjne na osi harmonogramu. */
  scheduleEvents: ScheduleEvent[];
  /** Własne nazwy / notatki wierszy kategorii na budowach. */
  categoryMeta: ScheduleCategoryMeta[];
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Aktywny",
  archived: "Archiwum",
};

export const SCHEDULE_EVENT_KIND_LABEL: Record<ScheduleEventKind, string> = {
  budowlane: "Budowlane",
  dokumentacyjne: "Dokumentacyjne",
};

/**
 * Sentinel `categoryId` for budowlane events pinned to the investment row
 * (not a schedule category lane).
 */
export const PROJECT_LEVEL_EVENT_CATEGORY = "__project__";

export function isProjectLevelEventCategory(
  categoryId: string | null | undefined,
): boolean {
  return !categoryId || categoryId === PROJECT_LEVEL_EVENT_CATEGORY;
}

export const DOC_EVENT_STATUS_LABEL: Record<DocEventStatus, string> = {
  do_sprawdzenia: "Do sprawdzenia",
  do_wpisania: "Do wpisania",
  wpisane: "Wpisane",
  nie_dotyczy: "Nie dotyczy",
};

export const DOC_EVENT_STATUSES = Object.keys(
  DOC_EVENT_STATUS_LABEL,
) as DocEventStatus[];

export const SCHEDULE_STATUS_LABEL: Record<ScheduleBlockStatus, string> = {
  planowane: "Planowane",
  potwierdzone: "Potwierdzone",
  w_realizacji: "W realizacji",
  wstrzymane: "Wstrzymane",
  zakonczone: "Zakończone",
};

/** Human label of an event, whatever its kind. */
export function scheduleEventLabel(e: ScheduleEvent): string {
  return e.customLabel?.trim() || e.title.trim() || e.activity || "Zdarzenie";
}

export function isDocEvent(e: ScheduleEvent): boolean {
  return e.kind === "dokumentacyjne";
}

export function isToWrite(e: ScheduleEvent): boolean {
  return e.kind === "dokumentacyjne" && e.status === "do_wpisania";
}

export function projectLabel(p: Pick<PreviewProject, "number" | "name">): string {
  return `#${p.number} ${p.name}`;
}

/** Sort / search: cyfry naturalnie, reszta alfabetycznie. */
export function compareProjectCodes(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function normalizeProjectCode(raw: string): string {
  return raw.trim();
}
