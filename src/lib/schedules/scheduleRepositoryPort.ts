import type { ProjectFeedFilter, OrgFeedEntry } from "@/lib/projectsPreview/projectFeed";
import type { ProjectLastEvent } from "@/lib/projectsPreview/projectLastEvent";
import type {
  DocEventStatus,
  PreviewCrew,
  PreviewProject,
  ProjectsPreviewState,
  ProjectStatus,
  ScheduleBlock,
  ScheduleCategoryMeta,
  ScheduleEvent,
  ScheduleEventKind,
  SupervisionCatalogCategory,
} from "@/lib/projectsPreview/types";

export type ScheduleEventQuery = {
  kind?: ScheduleEventKind;
  status?: DocEventStatus;
  toWriteOnly?: boolean;
};

export type ScheduleEventInput = Omit<ScheduleEvent, "id" | "note"> & {
  id?: string;
  note?: string;
};

/** Repository port for Harmonogramy — shared by local preview and cloud adapters. */
export interface ScheduleRepository {
  readonly mode: "local" | "cloud";

  getState(): ProjectsPreviewState;
  subscribe(fn: () => void): () => void;

  /** Current user id (viewAs in preview, auth.uid in cloud). */
  currentUserId(): string;

  /** Local-only: sync auth user + org roster (no-op on cloud). */
  setIdentity?(input: {
    userId: string;
    displayName?: string;
    orgId?: string | null;
    users?: import("@/lib/projectsPreview/types").PreviewUser[];
  }): void;

  visibleProjectList(opts?: {
    status?: ProjectStatus | "all";
    query?: string;
  }): PreviewProject[];

  getProjectLastEvent(projectId: string): ProjectLastEvent | null;
  getProjectIfVisible(id: string): PreviewProject | null;
  numberExists(number: string, excludeId?: string): boolean;
  suggestNextNumber(): string;

  createProject(input: {
    number: string;
    name: string;
    memberIds: string[];
    schedulePreset?: { startDate: string; endDate: string } | null;
  }): { ok: true; project: PreviewProject } | { ok: false; error: string };

  importProjects(
    rows: { number: string; name: string }[],
  ): { ok: true; count: number } | { ok: false; error: string };

  updateProject(
    id: string,
    patch: Partial<
      Pick<PreviewProject, "number" | "name" | "memberIds" | "status">
    >,
  ): { ok: true } | { ok: false; error: string };

  resetCatalogPreset(): void;
  updateSupervisionCatalog(categories: SupervisionCatalogCategory[]): void;

  reclassifyProjectCategory(
    projectId: string,
    fromCategoryId: string,
    toCategoryId: string,
  ): void;

  upsertCategoryMeta(input: {
    projectId: string;
    categoryId: string;
    title: string;
    note: string;
    startDate?: string;
    endDate?: string;
  }): ScheduleCategoryMeta;

  moveCategoryWindow(
    projectId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ): void;

  getCategoryMeta(
    projectId: string,
    categoryId: string,
  ): ScheduleCategoryMeta | null;

  listSchedule(projectId?: string): ScheduleBlock[];
  crewConflicts(projectIds?: string[]): ReturnType<
    typeof import("@/lib/projectsPreview/crewConflicts").findCrewConflicts
  >;
  crewWorkCount(crewId: string): number;
  seedScheduleTemplate(projectId: string): ScheduleBlock[];

  upsertCrew(crew: Omit<PreviewCrew, "id"> & { id?: string }): PreviewCrew;
  deleteCrew(id: string): { ok: true } | { ok: false; error: string };

  upsertScheduleBlock(
    block: Omit<ScheduleBlock, "id"> & { id?: string },
  ): ScheduleBlock;

  promoteToSubcategory(blockId: string): ScheduleBlock | null;
  demoteSubcategory(
    id: string,
    opts?: { keepAsWork?: boolean },
  ): { ok: true } | { ok: false; error: string };

  deleteScheduleBlock(id: string): void;
  moveScheduleBlock(
    id: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ): void;

  listScheduleEvents(
    projectId?: string,
    blockId?: string,
    opts?: ScheduleEventQuery,
  ): ScheduleEvent[];

  listEventsForBlock(blockId: string, opts?: ScheduleEventQuery): ScheduleEvent[];
  upsertScheduleEvent(event: ScheduleEventInput): ScheduleEvent;
  deleteScheduleEvent(id: string): void;
  setDocEventStatus(id: string, status: DocEventStatus): void;

  listToWrite(): Array<ScheduleEvent & { project?: PreviewProject }>;
  countToWrite(projectId?: string): number;

  listProjectFeed(
    projectId: string,
    filter?: ProjectFeedFilter,
  ): ReturnType<
    typeof import("@/lib/projectsPreview/projectFeed").buildProjectFeed
  >;

  listOrgFeed(filter?: ProjectFeedFilter, limit?: number): OrgFeedEntry[];

  userName(id: string): string;
  projectDisplay(id: string): string;

  /** Preview-only helpers — no-ops in cloud production. */
  resetDemo?(): void;
  loadDemoProjects?(): void;
  exportJson?(): string;
  setViewAs?(userId: string): void;
  assertNoCloud?(): {
    supabase: false;
    edge: false;
    graph: false;
    r2: false;
  };
}
