import { findCrewConflicts } from "./crewConflicts";
import { buildDemoState, emptyishState, PREVIEW_STORAGE_KEY, uid } from "./demoSeed";
import { buildNadzorPodstawowyPreset } from "./catalogPreset";
import { isProjectVisibleTo, searchProjects, visibleProjects } from "./search";
import type {
  PreviewChatMessage,
  PreviewProject,
  ProjectKind,
  ProjectRefEntity,
  ProjectsPreviewState,
  ProjectStatus,
  ScheduleBlock,
  ScheduleBlockStatus,
  SupervisionItem,
  SupervisionItemStatus,
} from "./types";
import { projectLabel } from "./types";

type Listener = () => void;

/**
 * In-memory + localStorage adapter. NEVER calls Supabase / Graph / R2 / sync.
 */
export class ProjectsPreviewRepository {
  private state: ProjectsPreviewState;
  private listeners = new Set<Listener>();

  constructor(initial?: ProjectsPreviewState) {
    this.state = initial ?? loadFromStorage() ?? buildDemoState();
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
    saveToStorage(next);
    for (const fn of this.listeners) fn();
  }

  resetDemo() {
    this.commit(buildDemoState(this.state.viewAsUserId));
  }

  clearAll() {
    this.commit(emptyishState());
  }

  loadDemoProjects() {
    const demo = buildDemoState(this.state.viewAsUserId);
    this.commit({
      ...this.state,
      projects: demo.projects,
      nextNumberHint: Math.max(this.state.nextNumberHint, demo.nextNumberHint),
      supervisionItems: demo.supervisionItems,
      scheduleBlocks: demo.scheduleBlocks,
      messages: demo.messages,
      crews: demo.crews,
      catalog: demo.catalog,
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
    kind?: ProjectKind | "all";
    status?: ProjectStatus | "all";
    query?: string;
  }): PreviewProject[] {
    const me = this.state.viewAsUserId;
    let list = visibleProjects(this.state.projects, me);
    if (opts?.kind && opts.kind !== "all") {
      list = list.filter((p) => p.kind === opts.kind);
    }
    if (opts?.status && opts.status !== "all") {
      list = list.filter((p) => p.status === opts.status);
    }
    if (opts?.query?.trim()) {
      list = searchProjects(list, opts.query).map((h) => h.project);
    } else {
      list = list.slice().sort((a, b) => a.number - b.number);
    }
    return list;
  }

  getProjectIfVisible(id: string): PreviewProject | null {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) return null;
    if (!isProjectVisibleTo(p, this.state.viewAsUserId)) return null;
    return p;
  }

  numberExists(number: number, excludeId?: string): boolean {
    return this.state.projects.some(
      (p) => p.number === number && p.id !== excludeId && p.orgId === this.state.orgId,
    );
  }

  suggestNextNumber(): number {
    return this.state.nextNumberHint;
  }

  createProject(input: {
    number: number;
    name: string;
    kind: ProjectKind;
    memberIds: string[];
  }): { ok: true; project: PreviewProject } | { ok: false; error: string } {
    if (!Number.isInteger(input.number) || input.number <= 0) {
      return { ok: false, error: "Nieprawidłowy numer." };
    }
    if (!input.name.trim()) return { ok: false, error: "Nazwa jest wymagana." };
    if (this.numberExists(input.number)) {
      return { ok: false, error: "Numer już istnieje w zespole." };
    }
    const admin = this.state.viewAsUserId;
    const members = Array.from(new Set([admin, ...input.memberIds]));
    const project: PreviewProject = {
      id: uid("p"),
      orgId: this.state.orgId,
      number: input.number,
      name: input.name.trim(),
      kind: input.kind,
      adminUserId: admin,
      memberIds: members,
      createdAt: new Date().toISOString(),
      status: "active",
    };
    this.commit({
      ...this.state,
      projects: [...this.state.projects, project],
      nextNumberHint: Math.max(this.state.nextNumberHint, input.number + 1),
    });
    return { ok: true, project };
  }

  importProjects(
    rows: { number: number; name: string; kind: ProjectKind }[],
  ): { ok: true; count: number } | { ok: false; error: string } {
    for (const r of rows) {
      if (this.numberExists(r.number)) {
        return { ok: false, error: `Numer ${r.number} już istnieje.` };
      }
    }
    const admin = this.state.viewAsUserId;
    const created: PreviewProject[] = rows.map((r) => ({
      id: uid("p"),
      orgId: this.state.orgId,
      number: r.number,
      name: r.name.trim(),
      kind: r.kind,
      adminUserId: admin,
      memberIds: [admin],
      createdAt: new Date().toISOString(),
      status: "active" as const,
    }));
    const maxNum = Math.max(this.state.nextNumberHint - 1, ...rows.map((r) => r.number));
    this.commit({
      ...this.state,
      projects: [...this.state.projects, ...created],
      nextNumberHint: maxNum + 1,
    });
    return { ok: true, count: created.length };
  }

  updateProject(
    id: string,
    patch: Partial<Pick<PreviewProject, "name" | "kind" | "memberIds" | "status">>,
  ): { ok: true } | { ok: false; error: string } {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) return { ok: false, error: "Brak projektu." };
    if (p.adminUserId !== this.state.viewAsUserId) {
      return { ok: false, error: "Tylko administrator może edytować." };
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
    this.commit({ ...this.state, projects: next });
    return { ok: true };
  }

  // --- Supervision ---

  listSupervision(projectId: string): SupervisionItem[] {
    return this.state.supervisionItems.filter((i) => i.projectId === projectId);
  }

  listToWrite(): Array<SupervisionItem & { project?: PreviewProject }> {
    return this.state.supervisionItems
      .filter((i) => i.status === "do_wpisania")
      .map((i) => ({
        ...i,
        project: this.getProjectIfVisible(i.projectId) ?? undefined,
      }))
      .filter((i) => i.project && i.project.kind === "nadzor");
  }

  upsertSupervisionItem(
    item: Omit<SupervisionItem, "id"> & { id?: string },
  ): SupervisionItem {
    const id = item.id ?? uid("si");
    const row: SupervisionItem = { ...item, id };
    const exists = this.state.supervisionItems.some((x) => x.id === id);
    const supervisionItems = exists
      ? this.state.supervisionItems.map((x) => (x.id === id ? row : x))
      : [...this.state.supervisionItems, row];
    this.commit({ ...this.state, supervisionItems });
    return row;
  }

  setSupervisionStatus(id: string, status: SupervisionItemStatus) {
    const me = this.state.viewAsUserId;
    const supervisionItems = this.state.supervisionItems.map((x) => {
      if (x.id !== id) return x;
      if (status === "wpisane") {
        return {
          ...x,
          status,
          writtenAt: new Date().toISOString().slice(0, 10),
          writtenByUserId: me,
        };
      }
      return { ...x, status };
    });
    this.commit({ ...this.state, supervisionItems });
  }

  resetCatalogPreset() {
    this.commit({ ...this.state, catalog: buildNadzorPodstawowyPreset() });
  }

  // --- Schedule ---

  listSchedule(projectId?: string): ScheduleBlock[] {
    if (!projectId) return this.state.scheduleBlocks;
    return this.state.scheduleBlocks.filter((b) => b.projectId === projectId);
  }

  crewConflicts() {
    return findCrewConflicts(this.state.scheduleBlocks);
  }

  upsertScheduleBlock(
    block: Omit<ScheduleBlock, "id"> & { id?: string },
  ): ScheduleBlock {
    const id = block.id ?? uid("sb");
    const row: ScheduleBlock = { ...block, id };
    const exists = this.state.scheduleBlocks.some((x) => x.id === id);
    const scheduleBlocks = exists
      ? this.state.scheduleBlocks.map((x) => (x.id === id ? row : x))
      : [...this.state.scheduleBlocks, row];
    this.commit({ ...this.state, scheduleBlocks });
    return row;
  }

  deleteScheduleBlock(id: string) {
    this.commit({
      ...this.state,
      scheduleBlocks: this.state.scheduleBlocks.filter((b) => b.id !== id),
    });
  }

  moveScheduleBlock(id: string, startDate: string, endDate: string) {
    this.commit({
      ...this.state,
      scheduleBlocks: this.state.scheduleBlocks.map((b) =>
        b.id === id ? { ...b, startDate, endDate } : b,
      ),
    });
  }

  copyScheduleBlock(id: string): ScheduleBlock | null {
    const src = this.state.scheduleBlocks.find((b) => b.id === id);
    if (!src) return null;
    return this.upsertScheduleBlock({
      ...src,
      id: undefined,
      title: `${src.title} (kopia)`,
      status: "planowane" as ScheduleBlockStatus,
    });
  }

  // --- Sandbox chat ---

  listMessages(filterProjectId?: string | null): PreviewChatMessage[] {
    let msgs = this.state.messages.slice();
    if (filterProjectId) {
      msgs = msgs.filter((m) =>
        m.projectRefs.some((r) => r.entityId === filterProjectId),
      );
    }
    return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  sendMessage(body: string, refs: ProjectRefEntity[]): PreviewChatMessage {
    for (const r of refs) {
      const p = this.getProjectIfVisible(r.entityId);
      if (!p) throw new Error("Nie możesz oznaczyć niedostępnego projektu.");
    }
    const msg: PreviewChatMessage = {
      id: uid("m"),
      authorUserId: this.state.viewAsUserId,
      body,
      createdAt: new Date().toISOString(),
      projectRefs: refs,
      mentionNames: [],
    };
    this.commit({ ...this.state, messages: [...this.state.messages, msg] });
    return msg;
  }

  userName(id: string): string {
    return this.state.users.find((u) => u.id === id)?.displayName ?? "Ktoś";
  }

  projectDisplay(id: string): string {
    const p = this.state.projects.find((x) => x.id === id);
    return p ? projectLabel(p) : "Projekt";
  }
}

function loadFromStorage(): ProjectsPreviewState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProjectsPreviewState;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(state: ProjectsPreviewState) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}

let singleton: ProjectsPreviewRepository | null = null;

export function getProjectsPreviewRepo(): ProjectsPreviewRepository {
  if (!singleton) singleton = new ProjectsPreviewRepository();
  return singleton;
}

export function resetProjectsPreviewRepoForTests(state?: ProjectsPreviewState) {
  singleton = new ProjectsPreviewRepository(state ?? buildDemoState());
  return singleton;
}
