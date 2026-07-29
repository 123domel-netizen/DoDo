import { findCrewConflicts } from "./crewConflicts";
import {
  buildDemoState,
  buildEmptyScheduleState,
  PREVIEW_ORG_ID,
  PREVIEW_STORAGE_KEY,
  uid,
} from "./demoSeed";
import { buildNadzorPodstawowyPreset } from "./catalogPreset";
import { projectLastEvent, type ProjectLastEvent } from "./projectLastEvent";
import {
  buildOrgFeed,
  buildProjectFeed,
  type OrgFeedEntry,
  type ProjectFeedFilter,
} from "./projectFeed";
import { todayIso } from "./projectMetrics";
import { buildBudowaScheduleCatalog } from "./scheduleCatalog";
import {
  buildProjectSchedulePreset,
  PRESET_SKIP_CATEGORY_IDS,
} from "./schedulePresetSeed";
import { addDaysIso } from "./scheduleZoom";
import { isProjectVisibleTo, searchProjects, visibleProjects } from "./search";
import { normalizeStageId } from "./stageIds";
import type {
  DocEventStatus,
  PreviewCrew,
  PreviewProject,
  PreviewUser,
  ProjectsPreviewState,
  ProjectStatus,
  ScheduleBlock,
  ScheduleBlockRole,
  ScheduleCategoryMeta,
  ScheduleEvent,
  ScheduleEventKind,
} from "./types";
import {
  compareProjectCodes,
  normalizeProjectCode,
  projectLabel,
  type SupervisionCatalogCategory,
} from "./types";
import type { ScheduleRepository, ScheduleEventInput, ScheduleEventQuery } from "@/lib/schedules/scheduleRepositoryPort";

export type {
  ScheduleEventQuery,
  ScheduleEventInput,
} from "@/lib/schedules/scheduleRepositoryPort";

type Listener = () => void;

export type LocalPreviewAdapterOptions = {
  /** When set, skips localStorage and uses this persist hook instead. */
  persist?: (state: ProjectsPreviewState) => void;
  /** Skip loading from localStorage (cloud adapter provides initial state). */
  skipStorage?: boolean;
};

const TEMPLATE_WINDOW_DAYS = 14;
const TEMPLATE_COLORS = [
  "#6b8ab8",
  "#c4a35a",
  "#5a9e84",
  "#c47a7a",
  "#8f7eb8",
  "#5a9eab",
  "#c48a5c",
];

/**
 * In-memory + localStorage adapter. NEVER calls Supabase / Graph / R2 / sync.
 */
export class ProjectsPreviewRepository implements ScheduleRepository {
  readonly mode = "local" as const;
  private state: ProjectsPreviewState;
  private listeners = new Set<Listener>();
  private persistHook: ((state: ProjectsPreviewState) => void) | null;
  private useStorage: boolean;

  constructor(
    initial?: ProjectsPreviewState,
    opts?: LocalPreviewAdapterOptions,
  ) {
    this.persistHook = opts?.persist ?? null;
    this.useStorage = !opts?.skipStorage && !opts?.persist;
    if (initial) {
      this.state = migrateState(initial);
      return;
    }
    if (!this.useStorage) {
      this.state = migrateState(buildEmptyScheduleState());
      return;
    }
    const loaded = loadFromStorage();
    if (!loaded) {
      this.state = migrateState(buildEmptyScheduleState());
      this.saveState(this.state);
      return;
    }
    this.state = loaded.state;
    if (loaded.needsSave) this.saveState(loaded.state);
  }

  currentUserId(): string {
    return this.state.viewAsUserId;
  }

  /**
   * Sync logged-in user + org roster into local state (no demo personas).
   */
  setIdentity(input: {
    userId: string;
    displayName?: string;
    orgId?: string | null;
    users?: PreviewUser[];
  }) {
    const userId = input.userId.trim();
    if (!userId) return;
    const displayName = input.displayName?.trim() || "Ty";
    const fromRoster = (input.users ?? []).filter((u) => u.id);
    const users =
      fromRoster.length > 0
        ? ensureUserInList(fromRoster, userId, displayName)
        : ensureUserInList(this.state.users, userId, displayName);
    const orgId = input.orgId?.trim() || this.state.orgId;
    const sameUsers =
      users.length === this.state.users.length &&
      users.every(
        (u, i) =>
          u.id === this.state.users[i]?.id &&
          u.displayName === this.state.users[i]?.displayName,
      );
    if (
      sameUsers &&
      this.state.viewAsUserId === userId &&
      this.state.orgId === orgId
    ) {
      return;
    }
    this.commit({
      ...this.state,
      orgId,
      viewAsUserId: userId,
      users,
    });
  }

  /** Replace in-memory state (cloud adapter hydration). */
  hydrate(state: ProjectsPreviewState) {
    this.state = migrateState(state);
    for (const fn of this.listeners) fn();
  }

  getState(): ProjectsPreviewState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(next: ProjectsPreviewState) {
    this.state = next;
    this.saveState(next);
    for (const fn of this.listeners) fn();
  }

  private saveState(state: ProjectsPreviewState) {
    if (this.persistHook) {
      this.persistHook(state);
      return;
    }
    if (this.useStorage) saveToStorage(state);
  }

  updateSupervisionCatalog(categories: SupervisionCatalogCategory[]) {
    this.commit({
      ...this.state,
      catalog: { ...this.state.catalog, categories },
    });
  }

  resetDemo() {
    this.commit(buildDemoState(this.state.viewAsUserId));
  }

  loadDemoProjects() {
    const demo = buildDemoState(this.state.viewAsUserId);
    this.commit({
      ...this.state,
      projects: demo.projects,
      nextNumberHint: Math.max(this.state.nextNumberHint, demo.nextNumberHint),
      scheduleBlocks: demo.scheduleBlocks,
      scheduleEvents: demo.scheduleEvents,
      crews: demo.crews,
      catalog: demo.catalog,
      scheduleCatalog: demo.scheduleCatalog,
      users: demo.users,
    });
  }

  exportJson(): string {
    return JSON.stringify(
      {
        _meta: {
          kind: "dodo-projects-preview-export",
          demo: true,
          noProductionSync: true,
          exportedAt: new Date().toISOString(),
        },
        state: this.state,
      },
      null,
      2,
    );
  }

  setViewAs(userId: string) {
    if (!this.state.users.some((u) => u.id === userId)) return;
    this.commit({ ...this.state, viewAsUserId: userId });
  }

  assertNoCloud(): { supabase: false; edge: false; graph: false; r2: false } {
    return { supabase: false, edge: false, graph: false, r2: false };
  }

  visibleProjectList(opts?: {
    status?: ProjectStatus | "all";
    query?: string;
  }): PreviewProject[] {
    const me = this.state.viewAsUserId;
    let list = visibleProjects(this.state.projects, me);
    if (opts?.status && opts.status !== "all") {
      list = list.filter((p) => p.status === opts.status);
    }
    if (opts?.query?.trim()) {
      list = searchProjects(list, opts.query).map((h) => h.project);
    } else {
      list = list.slice().sort((a, b) => compareProjectCodes(a.number, b.number));
    }
    return list;
  }

  getProjectLastEvent(projectId: string): ProjectLastEvent | null {
    return projectLastEvent(
      projectId,
      this.state.scheduleBlocks,
      this.state.scheduleEvents,
    );
  }

  getProjectIfVisible(id: string): PreviewProject | null {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) return null;
    if (!isProjectVisibleTo(p, this.state.viewAsUserId)) return null;
    return p;
  }

  numberExists(number: string, excludeId?: string): boolean {
    const key = normalizeProjectCode(number).toLowerCase();
    if (!key) return false;
    return this.state.projects.some(
      (p) =>
        p.number.toLowerCase() === key &&
        p.id !== excludeId &&
        p.orgId === this.state.orgId,
    );
  }

  suggestNextNumber(): string {
    return String(this.state.nextNumberHint);
  }

  createProject(input: {
    number: string;
    name: string;
    memberIds: string[];
    /**
     * Opcjonalny szkielet harmonogramu: kategorie + podkategorie z katalogu,
     * bez zakresów, rozłożone między startDate a endDate.
     */
    schedulePreset?: { startDate: string; endDate: string } | null;
  }): { ok: true; project: PreviewProject } | { ok: false; error: string } {
    const code = normalizeProjectCode(input.number);
    if (!code) {
      return { ok: false, error: "Podaj numer lub ID budowy." };
    }
    if (!input.name.trim()) return { ok: false, error: "Nazwa jest wymagana." };
    if (this.numberExists(code)) {
      return { ok: false, error: "Numer już istnieje w zespole." };
    }
    const admin = this.state.viewAsUserId;
    const members = Array.from(new Set([admin, ...input.memberIds]));
    const project: PreviewProject = {
      id: uid("p"),
      orgId: this.state.orgId,
      number: code,
      name: input.name.trim(),
      adminUserId: admin,
      memberIds: members,
      createdAt: new Date().toISOString(),
      status: "active",
    };

    let scheduleBlocks = this.state.scheduleBlocks;
    let categoryMeta = this.state.categoryMeta;
    if (input.schedulePreset?.startDate && input.schedulePreset.endDate) {
      const seeded = buildProjectSchedulePreset({
        projectId: project.id,
        startDate: input.schedulePreset.startDate,
        endDate: input.schedulePreset.endDate,
        catalog: this.state.scheduleCatalog,
        uid: () => uid("sb"),
      });
      scheduleBlocks = [...scheduleBlocks, ...seeded.blocks];
      categoryMeta = [...categoryMeta, ...seeded.categoryMeta];
    }

    this.commit({
      ...this.state,
      projects: [...this.state.projects, project],
      scheduleBlocks,
      categoryMeta,
      nextNumberHint: bumpHint(this.state.nextNumberHint, code),
    });
    return { ok: true, project };
  }

  importProjects(
    rows: { number: string; name: string }[],
  ): { ok: true; count: number } | { ok: false; error: string } {
    for (const r of rows) {
      const code = normalizeProjectCode(r.number);
      if (!code) {
        return { ok: false, error: "Pusty numer / ID w imporcie." };
      }
      if (this.numberExists(code)) {
        return { ok: false, error: `Numer ${code} już istnieje.` };
      }
    }
    const admin = this.state.viewAsUserId;
    const created: PreviewProject[] = rows.map((r) => ({
      id: uid("p"),
      orgId: this.state.orgId,
      number: normalizeProjectCode(r.number),
      name: r.name.trim(),
      adminUserId: admin,
      memberIds: [admin],
      createdAt: new Date().toISOString(),
      status: "active" as const,
    }));
    let hint = this.state.nextNumberHint;
    for (const p of created) hint = bumpHint(hint, p.number);
    this.commit({
      ...this.state,
      projects: [...this.state.projects, ...created],
      nextNumberHint: hint,
    });
    return { ok: true, count: created.length };
  }

  updateProject(
    id: string,
    patch: Partial<
      Pick<PreviewProject, "number" | "name" | "memberIds" | "status">
    >,
  ): { ok: true } | { ok: false; error: string } {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) return { ok: false, error: "Brak budowy." };
    if (p.adminUserId !== this.state.viewAsUserId) {
      return { ok: false, error: "Tylko administrator może edytować." };
    }
    let nextHint = this.state.nextNumberHint;
    if (patch.number !== undefined) {
      const code = normalizeProjectCode(patch.number);
      if (!code) {
        return { ok: false, error: "Podaj numer lub ID budowy." };
      }
      if (this.numberExists(code, id)) {
        return { ok: false, error: "Numer już istnieje w zespole." };
      }
      patch = { ...patch, number: code };
      nextHint = bumpHint(nextHint, code);
    }
    const next = this.state.projects.map((x) =>
      x.id === id
        ? {
            ...x,
            ...patch,
            memberIds: patch.memberIds
              ? Array.from(new Set([x.adminUserId, ...patch.memberIds]))
              : x.memberIds,
          }
        : x,
    );
    this.commit({ ...this.state, projects: next, nextNumberHint: nextHint });
    return { ok: true };
  }

  resetCatalogPreset() {
    this.commit({ ...this.state, catalog: buildNadzorPodstawowyPreset() });
  }

  /**
   * Przenieś wszystkie bloki i zdarzenia budowy z jednej kategorii katalogu
   * do innej (reklasyfikacja wiersza kategorii na tablicy).
   */
  reclassifyProjectCategory(
    projectId: string,
    fromCategoryId: string,
    toCategoryId: string,
  ) {
    if (fromCategoryId === toCategoryId) return;
    const to = normalizeStageId(toCategoryId);
    const scheduleBlocks = this.state.scheduleBlocks.map((b) =>
      b.projectId === projectId && b.categoryId === fromCategoryId
        ? { ...b, categoryId: to }
        : b,
    );
    const scheduleEvents = this.state.scheduleEvents.map((e) =>
      e.projectId === projectId && e.categoryId === fromCategoryId
        ? { ...e, categoryId: to }
        : e,
    );
    const categoryMeta = this.state.categoryMeta.map((m) =>
      m.projectId === projectId && m.categoryId === fromCategoryId
        ? { ...m, categoryId: to }
        : m,
    );
    this.commit({ ...this.state, scheduleBlocks, scheduleEvents, categoryMeta });
  }

  /** Własna nazwa / notatka / okno wiersza kategorii na budowie. */
  upsertCategoryMeta(input: {
    projectId: string;
    categoryId: string;
    title: string;
    note: string;
    /** Pominięte = zachowaj poprzednie. */
    startDate?: string;
    endDate?: string;
  }): ScheduleCategoryMeta {
    const categoryId = normalizeStageId(input.categoryId);
    const prev = this.state.categoryMeta.find(
      (m) => m.projectId === input.projectId && m.categoryId === categoryId,
    );
    const startDate =
      input.startDate !== undefined
        ? input.startDate.trim()
        : (prev?.startDate ?? "");
    const endDate =
      input.endDate !== undefined
        ? input.endDate.trim()
        : (prev?.endDate ?? "");
    const row: ScheduleCategoryMeta = {
      projectId: input.projectId,
      categoryId,
      title: input.title.trim(),
      note: input.note.trim(),
      startDate,
      endDate:
        startDate && endDate && endDate < startDate ? startDate : endDate,
    };
    const others = this.state.categoryMeta.filter(
      (m) =>
        !(m.projectId === row.projectId && m.categoryId === row.categoryId),
    );
    this.commit({
      ...this.state,
      categoryMeta: [...others, row],
    });
    return row;
  }

  moveCategoryWindow(
    projectId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ) {
    const categoryIdNorm = normalizeStageId(categoryId);
    const prev = this.getCategoryMeta(projectId, categoryIdNorm);
    const start = startDate.trim();
    let end = endDate.trim();
    if (start && end && end < start) end = start;
    const row: ScheduleCategoryMeta = {
      projectId,
      categoryId: categoryIdNorm,
      title: prev?.title ?? "",
      note: prev?.note ?? "",
      startDate: start,
      endDate: end,
    };
    const categoryMeta = [
      ...this.state.categoryMeta.filter(
        (m) =>
          !(m.projectId === projectId && m.categoryId === categoryIdNorm),
      ),
      row,
    ];
    const delta = opts?.shiftChildrenByDays ?? 0;
    const scheduleBlocks =
      delta === 0
        ? this.state.scheduleBlocks
        : this.state.scheduleBlocks.map((b) => {
            if (b.projectId !== projectId || b.categoryId !== categoryIdNorm) {
              return b;
            }
            return {
              ...b,
              startDate: addDaysIso(b.startDate, delta),
              endDate: addDaysIso(b.endDate, delta),
            };
          });
    this.commit({ ...this.state, categoryMeta, scheduleBlocks });
  }

  getCategoryMeta(
    projectId: string,
    categoryId: string,
  ): ScheduleCategoryMeta | null {
    return (
      this.state.categoryMeta.find(
        (m) => m.projectId === projectId && m.categoryId === categoryId,
      ) ?? null
    );
  }

  // --- Schedule ---

  listSchedule(projectId?: string): ScheduleBlock[] {
    if (!projectId) return this.state.scheduleBlocks;
    return this.state.scheduleBlocks.filter((b) => b.projectId === projectId);
  }

  /**
   * Overlapping crew assignments. Scoped to `projectIds` when given, otherwise
   * to the projects the current "view as" user can actually see — a conflict on
   * a hidden project is not actionable and would leak its existence.
   */
  crewConflicts(projectIds?: string[]) {
    const scope = new Set(
      projectIds ??
        visibleProjects(this.state.projects, this.state.viewAsUserId).map(
          (p) => p.id,
        ),
    );
    return findCrewConflicts(
      this.state.scheduleBlocks.filter((b) => scope.has(b.projectId)),
    );
  }

  /** How many works a crew is booked on (used by the Brygady view). */
  crewWorkCount(crewId: string): number {
    return this.state.scheduleBlocks.filter(
      (b) => b.role === "work" && b.crewId === crewId,
    ).length;
  }

  /**
   * Cold start: lay out one subcategory window per catalog stage, 14 days each,
   * back to back from today. Stages that already have a window are skipped, so
   * calling it twice does not duplicate anything.
   */
  seedScheduleTemplate(projectId: string): ScheduleBlock[] {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return [];

    const taken = new Set(
      this.state.scheduleBlocks
        .filter((b) => b.projectId === projectId && b.role === "subcategory")
        .map((b) => b.categoryId),
    );
    const categories = this.state.scheduleCatalog.categories
      .filter(
        (c) => !PRESET_SKIP_CATEGORY_IDS.has(c.id) && !taken.has(c.id),
      )
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (categories.length === 0) return [];

    const start = todayIso();
    const created: ScheduleBlock[] = categories.map((c, i) => ({
      id: uid("sb"),
      projectId,
      title: c.title,
      categoryId: c.id,
      scope: c.scopes.find((s) => s !== "Inny") ?? c.title,
      role: "subcategory",
      parentId: null,
      crewId: "",
      startDate: addDays(start, i * TEMPLATE_WINDOW_DAYS),
      endDate: addDays(start, (i + 1) * TEMPLATE_WINDOW_DAYS - 1),
      status: "planowane",
      color: TEMPLATE_COLORS[i % TEMPLATE_COLORS.length]!,
      note: "",
    }));

    this.commit({
      ...this.state,
      scheduleBlocks: [...this.state.scheduleBlocks, ...created],
    });
    return created;
  }

  upsertCrew(crew: Omit<PreviewCrew, "id"> & { id?: string }): PreviewCrew {
    const id = crew.id ?? uid("crew");
    const headcount =
      crew.headcount == null || Number.isNaN(Number(crew.headcount))
        ? null
        : Math.max(0, Math.floor(Number(crew.headcount)));
    const row: PreviewCrew = {
      id,
      name: crew.name.trim() || "Nowa brygada",
      color: crew.color || "#64748b",
      headcount,
      supervisor: crew.supervisor?.trim() ?? "",
      company: crew.company?.trim() ?? "",
      phone: crew.phone?.trim() ?? "",
    };
    const exists = this.state.crews.some((c) => c.id === id);
    const crews = exists
      ? this.state.crews.map((c) => (c.id === id ? row : c))
      : [...this.state.crews, row];
    this.commit({ ...this.state, crews });
    return row;
  }

  deleteCrew(id: string): { ok: true } | { ok: false; error: string } {
    const inUse = this.state.scheduleBlocks.some(
      (b) => b.role === "work" && b.crewId === id,
    );
    if (inUse) {
      return {
        ok: false,
        error: "Brygada jest przypisana do robót — najpierw zmień brygadę w blokach.",
      };
    }
    this.commit({
      ...this.state,
      crews: this.state.crews.filter((c) => c.id !== id),
    });
    return { ok: true };
  }

  upsertScheduleBlock(
    block: Omit<ScheduleBlock, "id"> & { id?: string },
  ): ScheduleBlock {
    const id = block.id ?? uid("sb");
    const role: ScheduleBlockRole = block.role ?? "work";
    let parentId = role === "subcategory" ? null : (block.parentId ?? null);

    if (parentId) {
      const parent = this.state.scheduleBlocks.find((x) => x.id === parentId);
      if (!parent || parent.role !== "subcategory") {
        parentId = null;
      } else if (parent.projectId !== block.projectId) {
        parentId = null;
      }
    }

    const row: ScheduleBlock = {
      ...block,
      id,
      role,
      parentId,
      categoryId: block.categoryId || "stan-0",
      scope: block.scope?.trim() || block.title.trim() || "Inny",
      title: block.title.trim() || block.scope?.trim() || "Robota",
      crewId: role === "subcategory" ? "" : (block.crewId ?? ""),
    };
    const exists = this.state.scheduleBlocks.some((x) => x.id === id);
    const scheduleBlocks = exists
      ? this.state.scheduleBlocks.map((x) => (x.id === id ? row : x))
      : [...this.state.scheduleBlocks, row];
    this.commit({ ...this.state, scheduleBlocks });
    return row;
  }

  /**
   * Turns a top-level work into a subcategory window and keeps the old
   * schedule as the first child work (so nothing disappears).
   */
  promoteToSubcategory(blockId: string): ScheduleBlock | null {
    const src = this.state.scheduleBlocks.find((b) => b.id === blockId);
    if (!src || src.role !== "work" || src.parentId) return null;
    const childId = uid("sb");
    const parent: ScheduleBlock = {
      ...src,
      role: "subcategory",
      parentId: null,
      crewId: "",
      status: "planowane",
      note: src.note,
    };
    const child: ScheduleBlock = {
      ...src,
      id: childId,
      role: "work",
      parentId: src.id,
      title: src.title,
    };
    this.commit({
      ...this.state,
      scheduleBlocks: this.state.scheduleBlocks.map((b) =>
        b.id === blockId ? parent : b,
      ).concat(child),
    });
    return parent;
  }

  /**
   * Removes subcategory container. Children become top-level works.
   * When `keepAsWork`, container becomes a work again (dates/window kept).
   * Otherwise container is deleted.
   */
  demoteSubcategory(
    id: string,
    opts?: { keepAsWork?: boolean },
  ): { ok: true } | { ok: false; error: string } {
    const src = this.state.scheduleBlocks.find((b) => b.id === id);
    if (!src || src.role !== "subcategory") {
      return { ok: false, error: "To nie jest podkategoria." };
    }
    const keepAsWork = opts?.keepAsWork ?? true;
    const scheduleBlocks = this.state.scheduleBlocks
      .map((b) => {
        if (b.parentId === id) return { ...b, parentId: null };
        if (b.id === id) {
          if (!keepAsWork) return null;
          return {
            ...b,
            role: "work" as const,
            parentId: null,
            crewId: b.crewId || this.state.crews[0]?.id || "",
          };
        }
        return b;
      })
      .filter((b): b is ScheduleBlock => b != null);
    const scheduleEvents = keepAsWork
      ? this.state.scheduleEvents
      : detachEventsFromBlocks(this.state.scheduleEvents, new Set([id]));
    this.commit({ ...this.state, scheduleBlocks, scheduleEvents });
    return { ok: true };
  }

  deleteScheduleBlock(id: string) {
    const target = this.state.scheduleBlocks.find((b) => b.id === id);
    let scheduleBlocks = this.state.scheduleBlocks.filter((b) => b.id !== id);
    if (target?.role === "subcategory") {
      scheduleBlocks = scheduleBlocks.map((b) =>
        b.parentId === id ? { ...b, parentId: null } : b,
      );
    }
    const orphanIds = new Set<string>([id]);
    // Children of a deleted subcategory also become orphans for events
    if (target?.role === "subcategory") {
      for (const b of this.state.scheduleBlocks) {
        if (b.parentId === id) orphanIds.add(b.id);
      }
    }
    this.commit({
      ...this.state,
      scheduleBlocks,
      scheduleEvents: detachEventsFromBlocks(
        this.state.scheduleEvents,
        orphanIds,
      ),
    });
  }

  moveScheduleBlock(
    id: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ) {
    const delta = opts?.shiftChildrenByDays ?? 0;
    this.commit({
      ...this.state,
      scheduleBlocks: this.state.scheduleBlocks.map((b) => {
        if (b.id === id) return { ...b, startDate, endDate };
        if (delta !== 0 && b.parentId === id) {
          return {
            ...b,
            startDate: addDaysIso(b.startDate, delta),
            endDate: addDaysIso(b.endDate, delta),
          };
        }
        return b;
      }),
    });
  }

  // --- Schedule events (budowlane + dokumentacyjne) ---

  listScheduleEvents(
    projectId?: string,
    blockId?: string,
    opts?: ScheduleEventQuery,
  ): ScheduleEvent[] {
    let list = this.state.scheduleEvents;
    if (projectId) list = list.filter((e) => e.projectId === projectId);
    if (blockId) list = list.filter((e) => e.blockId === blockId);
    if (opts?.kind) list = list.filter((e) => e.kind === opts.kind);
    if (opts?.status) list = list.filter((e) => e.status === opts.status);
    if (opts?.toWriteOnly) {
      list = list.filter(
        (e) => e.kind === "dokumentacyjne" && e.status === "do_wpisania",
      );
    }
    return list.slice().sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Events pinned to a schedule block (work or subcategory). */
  listEventsForBlock(blockId: string, opts?: ScheduleEventQuery): ScheduleEvent[] {
    return this.listScheduleEvents(undefined, blockId, opts);
  }

  upsertScheduleEvent(event: ScheduleEventInput): ScheduleEvent {
    const block = event.blockId
      ? this.state.scheduleBlocks.find((b) => b.id === event.blockId)
      : undefined;
    const projectId = event.projectId || block?.projectId || "";
    if (!projectId) throw new Error("Brak budowy dla zdarzenia.");

    const id = event.id ?? uid(event.kind === "dokumentacyjne" ? "de" : "se");
    const me = this.state.viewAsUserId;
    const previous = this.state.scheduleEvents.find((x) => x.id === id);
    const row = normalizeEvent(
      {
        ...event,
        id,
        projectId,
        // A stale blockId (deleted block) must not resurrect a broken link.
        blockId: block ? block.id : null,
        categoryId:
          event.categoryId ||
          block?.categoryId ||
          previous?.categoryId ||
          "stan-0",
        note: event.note ?? "",
      },
      { me, previous },
    );

    const scheduleEvents = previous
      ? this.state.scheduleEvents.map((x) => (x.id === id ? row : x))
      : [...this.state.scheduleEvents, row];
    this.commit({ ...this.state, scheduleEvents });
    return row;
  }

  deleteScheduleEvent(id: string) {
    this.commit({
      ...this.state,
      scheduleEvents: this.state.scheduleEvents.filter((e) => e.id !== id),
    });
  }

  /** Sets the stan of a documentary event, stamping who wrote it. */
  setDocEventStatus(id: string, status: DocEventStatus) {
    const me = this.state.viewAsUserId;
    const scheduleEvents = this.state.scheduleEvents.map((e) => {
      if (e.id !== id || e.kind !== "dokumentacyjne") return e;
      if (status === "wpisane") {
        return {
          ...e,
          status,
          writtenAt: e.writtenAt ?? todayIso(),
          writtenByUserId: e.writtenByUserId ?? me,
        };
      }
      return { ...e, status, writtenAt: null, writtenByUserId: null };
    });
    this.commit({ ...this.state, scheduleEvents });
  }

  /** Whole visible queue of documentary events waiting to be written down. */
  listToWrite(): Array<ScheduleEvent & { project?: PreviewProject }> {
    return this.state.scheduleEvents
      .filter((e) => e.kind === "dokumentacyjne" && e.status === "do_wpisania")
      .map((e) => ({
        ...e,
        project: this.getProjectIfVisible(e.projectId) ?? undefined,
      }))
      .filter((e) => Boolean(e.project))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Badge counter: one budowa, or the whole visible queue. */
  countToWrite(projectId?: string): number {
    if (!projectId) return this.listToWrite().length;
    return this.state.scheduleEvents.filter(
      (e) =>
        e.projectId === projectId &&
        e.kind === "dokumentacyjne" &&
        e.status === "do_wpisania",
    ).length;
  }

  listProjectFeed(projectId: string, filter?: ProjectFeedFilter) {
    return buildProjectFeed(
      projectId,
      this.state.scheduleEvents,
      this.state.scheduleBlocks,
      { filter },
    );
  }

  /** Cross-project history, scoped to what the current viewer can see. */
  listOrgFeed(filter: ProjectFeedFilter = "all", limit = 200): OrgFeedEntry[] {
    const ids = visibleProjects(
      this.state.projects,
      this.state.viewAsUserId,
    ).map((p) => p.id);
    return buildOrgFeed(ids, this.state.scheduleEvents, this.state.scheduleBlocks, {
      filter,
      limit,
    });
  }

  userName(id: string): string {
    return this.state.users.find((u) => u.id === id)?.displayName ?? "Ktoś";
  }

  projectDisplay(id: string): string {
    const p = this.state.projects.find((x) => x.id === id);
    return p ? projectLabel(p) : "Budowa";
  }
}

/**
 * Budowlane events die with their block (they describe the work itself);
 * dokumentacyjne keep their history and only lose the soft link.
 */
function detachEventsFromBlocks(
  events: ScheduleEvent[],
  blockIds: Set<string>,
): ScheduleEvent[] {
  return events
    .filter(
      (e) =>
        !(e.kind === "budowlane" && e.blockId && blockIds.has(e.blockId)),
    )
    .map((e) =>
      e.blockId && blockIds.has(e.blockId) ? { ...e, blockId: null } : e,
    );
}

/** Legacy nadzór statuses; `brak` no longer exists in the model. */
type LegacyStatus = DocEventStatus | "brak";

type LegacySupervisionItem = {
  id?: string;
  projectId?: string;
  categoryId?: string;
  activity?: string;
  customLabel?: string;
  status?: LegacyStatus;
  noticedAt?: string | null;
  note?: string;
  reportedByUserId?: string | null;
  writtenAt?: string | null;
  writtenByUserId?: string | null;
  blockId?: string | null;
};

/** Anything that may sit in localStorage from an older build. */
type LooseProject = Omit<Partial<PreviewProject>, "number"> & {
  number?: string | number;
  kind?: string;
};
type LooseEvent = Partial<ScheduleEvent> & { kind?: ScheduleEventKind };
type LooseState = Partial<
  Omit<ProjectsPreviewState, "projects" | "scheduleEvents">
> & {
  projects?: LooseProject[];
  scheduleEvents?: LooseEvent[];
  /** v6 nadzór list — folded into dokumentacyjne events. */
  supervisionItems?: LegacySupervisionItem[];
  /** v5 sandbox chat — dropped. */
  messages?: unknown;
};

/**
 * Brings any older shape up to v7: no `kind` on projects, no `messages`, no
 * separate `supervisionItems`, one `scheduleEvents` list with explicit kinds.
 */
function migrateState(raw: LooseState): ProjectsPreviewState {
  const fallbackUser: PreviewUser = {
    id: "local-user",
    displayName: "Ty",
  };
  const users =
    raw.users?.length
      ? raw.users
      : raw.viewAsUserId
        ? [{ id: raw.viewAsUserId, displayName: "Ty" }]
        : [fallbackUser];
  const viewAsUserId =
    raw.viewAsUserId && users.some((u) => u.id === raw.viewAsUserId)
      ? raw.viewAsUserId
      : (users[0]?.id ?? fallbackUser.id);

  const projects = (raw.projects ?? [])
    .map((p) => normalizeProject(p, viewAsUserId))
    .filter((p): p is PreviewProject => p != null);

  const events = (raw.scheduleEvents ?? [])
    .map((e) => coerceStoredEvent(e))
    .filter((e): e is ScheduleEvent => e != null);
  const converted = (raw.supervisionItems ?? [])
    .map((i) => supervisionItemToEvent(i))
    .filter((e): e is ScheduleEvent => e != null);

  const highestNumber = projects.reduce(
    (max, p) => Math.max(max, numericCodeValue(p.number)),
    0,
  );

  const scheduleBlocks = (raw.scheduleBlocks ?? []).map((b) =>
    normalizeScheduleBlock(b),
  );
  const blockCat = new Map(
    scheduleBlocks.map((b) => [b.id, b.categoryId] as const),
  );

  const withCategory = (e: ScheduleEvent): ScheduleEvent => {
    if (e.categoryId) return e;
    const fromBlock = e.blockId ? blockCat.get(e.blockId) : undefined;
    if (fromBlock) return { ...e, categoryId: normalizeStageId(fromBlock) };
    return { ...e, categoryId: "stan-0" };
  };

  return {
    version: 1,
    orgId: raw.orgId ?? PREVIEW_ORG_ID,
    users,
    viewAsUserId,
    projects,
    nextNumberHint: Math.max(raw.nextNumberHint ?? 1, highestNumber + 1),
    catalog: raw.catalog ?? buildNadzorPodstawowyPreset(),
    scheduleCatalog: raw.scheduleCatalog ?? buildBudowaScheduleCatalog(),
    crews: (raw.crews ?? []).map((c) => normalizeCrew(c)),
    scheduleBlocks,
    scheduleEvents: [...events, ...converted].map(withCategory),
    categoryMeta: (raw.categoryMeta ?? [])
      .map((m) => normalizeCategoryMeta(m))
      .filter((m): m is ScheduleCategoryMeta => m != null),
  };
}

/** True when the stored blob still carries fields v7 no longer understands. */
function hasLegacyShape(raw: LooseState): boolean {
  if (raw.messages != null) return true;
  if (raw.supervisionItems != null) return true;
  if ((raw.projects ?? []).some((p) => p.kind !== undefined)) return true;
  return (raw.scheduleEvents ?? []).some(
    (e) =>
      e.kind !== "budowlane" && e.kind !== "dokumentacyjne",
  );
}

function normalizeProject(
  p: LooseProject,
  fallbackAdminId: string,
): PreviewProject | null {
  if (!p?.id) return null;
  const adminUserId = p.adminUserId ?? fallbackAdminId;
  const number = normalizeProjectCode(String(p.number ?? ""));
  if (!number) return null;
  return {
    id: p.id,
    orgId: p.orgId ?? PREVIEW_ORG_ID,
    number,
    name: p.name ?? "Budowa",
    adminUserId,
    memberIds: Array.from(new Set([adminUserId, ...(p.memberIds ?? [])])),
    createdAt: p.createdAt ?? new Date().toISOString(),
    status: p.status === "archived" ? "archived" : "active",
  };
}

function numericCodeValue(code: string): number {
  const n = Number(code);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function bumpHint(hint: number, code: string): number {
  const n = numericCodeValue(code);
  return n > 0 ? Math.max(hint, n + 1) : hint;
}

/** v6 nadzór entry → dokumentacyjne event. `brak` lands as „do sprawdzenia”. */
function supervisionItemToEvent(
  i: LegacySupervisionItem,
): ScheduleEvent | null {
  if (!i?.id || !i.projectId) return null;
  const status: DocEventStatus =
    i.status && i.status !== "brak" ? i.status : "do_sprawdzenia";
  const activity = i.activity ?? "";
  const title = i.customLabel?.trim() || activity || "Zdarzenie dokumentacyjne";
  return {
    id: i.id,
    projectId: i.projectId,
    blockId: i.blockId ?? null,
    kind: "dokumentacyjne",
    title,
    date: i.noticedAt ?? i.writtenAt ?? todayIso(),
    note: i.note ?? "",
    status,
    categoryId: normalizeStageId(i.categoryId || "stan-0"),
    activity,
    customLabel: i.customLabel,
    reportedByUserId: i.reportedByUserId ?? null,
    writtenAt: i.writtenAt ?? null,
    writtenByUserId: i.writtenByUserId ?? null,
  };
}

/** Stored event, possibly from v6 where every event was logistics. */
function coerceStoredEvent(e: LooseEvent): ScheduleEvent | null {
  if (!e?.id || !e.projectId) return null;
  const kind: ScheduleEventKind =
    e.kind === "dokumentacyjne" ? "dokumentacyjne" : "budowlane";
  return normalizeEvent({
    ...e,
    id: e.id,
    projectId: e.projectId,
    kind,
    blockId: e.blockId ?? null,
    title: e.title ?? "",
    date: e.date ?? todayIso(),
    note: e.note ?? "",
  });
}

function normalizeEvent(
  e: Omit<ScheduleEvent, "note"> & { note?: string },
  ctx?: { me?: string; previous?: ScheduleEvent },
): ScheduleEvent {
  const base = {
    id: e.id,
    projectId: e.projectId,
    blockId: e.blockId ?? null,
    kind: e.kind,
    date: e.date,
    note: e.note?.trim() ?? "",
  };

  if (e.kind !== "dokumentacyjne") {
    return {
      ...base,
      kind: "budowlane",
      title: e.title?.trim() || "Zdarzenie budowlane",
      categoryId: e.categoryId
        ? normalizeStageId(e.categoryId)
        : undefined,
    };
  }

  const customLabel = e.customLabel?.trim() || undefined;
  const activity = e.activity?.trim() ?? "";
  const status: DocEventStatus = e.status ?? "do_wpisania";
  const me = ctx?.me ?? null;
  const previous = ctx?.previous;
  const written = status === "wpisane";
  return {
    ...base,
    kind: "dokumentacyjne",
    title: customLabel || e.title?.trim() || activity || "Zdarzenie dokumentacyjne",
    status,
    categoryId: normalizeStageId(e.categoryId || "stan-0"),
    activity,
    customLabel,
    reportedByUserId: e.reportedByUserId ?? previous?.reportedByUserId ?? me,
    writtenAt: written ? (e.writtenAt ?? previous?.writtenAt ?? e.date) : null,
    writtenByUserId: written
      ? (e.writtenByUserId ?? previous?.writtenByUserId ?? me)
      : null,
  };
}

function normalizeCategoryMeta(
  m: Partial<ScheduleCategoryMeta> | null | undefined,
): ScheduleCategoryMeta | null {
  if (!m?.projectId || !m.categoryId) return null;
  const startDate = (m.startDate ?? "").trim();
  let endDate = (m.endDate ?? "").trim();
  if (startDate && endDate && endDate < startDate) endDate = startDate;
  return {
    projectId: m.projectId,
    categoryId: normalizeStageId(m.categoryId),
    title: (m.title ?? "").trim(),
    note: (m.note ?? "").trim(),
    startDate,
    endDate,
  };
}

function normalizeCrew(
  c: Partial<PreviewCrew> & Pick<PreviewCrew, "id" | "name">,
): PreviewCrew {
  const headcountRaw = c.headcount;
  const headcount =
    headcountRaw == null || Number.isNaN(Number(headcountRaw))
      ? null
      : Math.max(0, Math.floor(Number(headcountRaw)));
  return {
    id: c.id,
    name: c.name || "Brygada",
    color: c.color || "#64748b",
    headcount,
    supervisor: c.supervisor ?? "",
    company: c.company ?? "",
    phone: c.phone ?? "",
  };
}

function normalizeScheduleBlock(
  b: Partial<ScheduleBlock> &
    Pick<ScheduleBlock, "id" | "projectId" | "title" | "startDate" | "endDate">,
): ScheduleBlock {
  const role: ScheduleBlockRole =
    b.role === "subcategory" ? "subcategory" : "work";
  return {
    id: b.id,
    projectId: b.projectId,
    title: b.title || b.scope || "Robota",
    categoryId: normalizeStageId(b.categoryId || "stan-0"),
    scope: b.scope || b.title || "Inny",
    role,
    parentId: role === "subcategory" ? null : (b.parentId ?? null),
    crewId: b.crewId ?? "",
    startDate: b.startDate,
    endDate: b.endDate,
    status: b.status ?? "planowane",
    color: b.color ?? "#64748b",
    note: b.note ?? "",
  };
}

type LoadedState = { state: ProjectsPreviewState; needsSave: boolean };

function readStorageKey(key: string): LooseState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LooseState;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Local module storage only — never adopt legacy demo preview keys. */
function loadFromStorage(): LoadedState | null {
  if (typeof localStorage === "undefined") return null;

  const current = readStorageKey(PREVIEW_STORAGE_KEY);
  if (current) {
    return { state: migrateState(current), needsSave: hasLegacyShape(current) };
  }

  return null;
}

function ensureUserInList(
  users: PreviewUser[],
  userId: string,
  displayName: string,
): PreviewUser[] {
  const map = new Map(users.map((u) => [u.id, u]));
  const prev = map.get(userId);
  map.set(userId, {
    id: userId,
    displayName: displayName || prev?.displayName || "Ty",
  });
  return Array.from(map.values());
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function saveToStorage(state: ProjectsPreviewState) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

/** Alias for the local preview adapter (localStorage / demo). */
export const LocalPreviewAdapter = ProjectsPreviewRepository;

let singleton: ProjectsPreviewRepository | null = null;

export function getProjectsPreviewRepo(): ProjectsPreviewRepository {
  if (!singleton) singleton = new ProjectsPreviewRepository();
  return singleton;
}

export function resetProjectsPreviewRepoForTests(state?: ProjectsPreviewState) {
  singleton = new ProjectsPreviewRepository(state ?? buildDemoState());
  return singleton;
}
